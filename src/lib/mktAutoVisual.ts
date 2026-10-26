import { db } from './db';
import { audit } from './log';
import { assertSpace } from './spaces';
import { isAdmin } from './access';
import { badRequest, forbidden, notFound } from './errors';
import { tenantOf, type SessionUser } from './types';
import { contactLine, factsOf, otherBrandNames, otherBrands } from './mktQuality';
import { markedNoText, markedSkip, markedText, photoFlags, visionBackdrop, visionGraphic, visionOk, visionText } from './mktPhotos';

/**
 * #516 자동 제작 시안 = 우리 서버가 그림(외부 유료 생성 없음, 크레딧 0) — 대표 10/24 "승인 대기 시안이 안 보임".
 * 자료실 마케팅 실사 사진(그 브랜드 것 먼저, 다른 브랜드 사진은 빼고, 최근 30일에 쓴 사진은 뒤로) 위에
 * 첫 문장(훅)·제목을 카드뉴스 표지 틀(#499-5)로 — 피드·페이스북 1080×1350(4:5), 스토리 1080×1920(9:16, 위·아래 안전 영역).
 * 사진이 없으면 브랜드 색 바탕. 브랜드 키트 로고·글꼴을 씀. Higgsfield AI 이미지는 승인함 [AI 이미지로 다시](크레딧)로만.
 * 영상(릴스·쇼츠·영상)·스레드(글만 가능)는 그리지 않는다. 블로그(로컬 10/24 (c))는 대표 이미지(1080×1080)를 그리고 본문 사진 1장(실사)을 붙인다.
 */
const VIDEO_KINDS = ['reels', 'shorts', 'video'];
export const serverVisual = (c: { channel: string; kind?: string | null }) => (c.channel === 'instagram' || c.channel === 'facebook' || c.channel === 'blog') && !VIDEO_KINDS.includes(c.kind ?? '');
/** 요청 C §3-1: 자동 제작 블로그 = 표지 1장 + 본문 사진 3장(marketing.ts BLOG_AUTO_RULE) — 실사가 모자라면 도표형 카드로 채움 */
export const BLOG_AUTO_MEDIA = 4;

type Content = { id: string; tenant: string; brand_id: string | null; title: string; channel: string; kind: string | null; created_by: string | null; is_test?: boolean | null; current_version: number; card?: import('./mktFeedTemplates').FeedCard | null; auto?: boolean | null };

/** 세션 없이(정기 실행) 자료실에 저장할 때 쓰는 사람 — 만든 사람, 막혔으면 회사 대표 */
async function actorOf(c: Pick<Content, 'tenant' | 'created_by'>): Promise<SessionUser | null> {
  const [r] = await db()<any[]>`select id, email, name, role, status, timezone, is_demo, platform_admin, tenant from users
    where tenant = ${c.tenant} and status = 'active' and (id = ${c.created_by ?? '00000000-0000-0000-0000-000000000000'} or role = 'owner') order by (id = ${c.created_by ?? '00000000-0000-0000-0000-000000000000'}) desc, created_at limit 1`;
  return r ? ({ id: r.id, email: r.email, name: r.name, role: r.role, status: r.status, timezone: r.timezone, sessionId: '', isDemo: r.is_demo, platformAdmin: r.platform_admin, tenant: r.tenant } as SessionUser) : null;
}

const words = (s: string) => new Set((s.match(/[\p{L}\p{N}]{2,}/gu) ?? []).map((w) => w.toLowerCase()));
/** #516 후속(로컬 10/24 07:35 '바탕 그림에 이미 글자가 있어 새 제목과 겹침'): 글자가 든 그래픽은 바탕 사진으로 안 씀 — 규칙만(비전 판정은 안 함)
 *  이름·태그에 썸네일(thumb·pin·cover)·표지·카드뉴스·배너·포스터·릴스/쇼츠·목업·캡처·시안 · 폴더 '마케팅/자동 시안'·'마케팅/카드뉴스' · 이름이 문장(?·!·'~요'·'~니다') */
const GRAPHIC = /thumb|썸네일|(^|[^a-z])pin([^a-z]|$)|(^|[^a-z])cover|표지|카드\s*뉴스|card\s*news|배너|banner|포스터|poster|shorts|reels|쇼츠|릴스|목업|mockup|캡처|screenshot|스크린샷|시안/i;
const GRAPHIC_FOLDER = /^마케팅\/(자동 시안|카드뉴스)/;
const SENTENCE = /[?？!！]|(니다|세요|나요|까요|어요|아요|해요|에요|예요|습니까)\s*\.?$/;
/** #235 ⓒ 사진 AI 설명(vision)이 있으면 그 판정도 — 이름 규칙·AI 판정 중 하나라도 그래픽이면 뺌. 사람이 단 태그 '글자없음'이 먼저
 *  (로컬 10/25 11:15: '글자있음'은 바탕에서만 빼는 표시라 여기서는 보지 않음 — 본문까지 빼는 것은 '쓰지않음', bodyOk) */
export function textGraphic(r: { title: string; file_name?: string | null; folder: string; tags?: string[] | null; vision?: unknown }) {
  if (markedNoText(r.tags)) return false;
  const names = [r.title, r.file_name ?? ''].map((x) => x.replace(/\.[a-z0-9]{2,5}$/i, '').trim()).filter(Boolean);
  return GRAPHIC_FOLDER.test(r.folder ?? '') || names.some((x) => GRAPHIC.test(x) || SENTENCE.test(x)) || (r.tags ?? []).some((t) => GRAPHIC.test(t)) || (visionOk(r.vision) && visionGraphic(r.vision));
}
/** 블로그 본문·원고 사진 목록에 쓸 수 있는 사진 — 사람이 '쓰지 않음'으로 표시하지 않았고 글자 든 그래픽(홍보물·실사 아님·이름 규칙)이 아님 */
export const bodyOk = (r: Parameters<typeof textGraphic>[0]) => !markedSkip(r.tags) && !textGraphic(r);
/** 실사 원본 우선(로컬 요청: '실제 운영 현장 사진'·브랜드 사진 폴더) — 블로그 본문 사진 고르기에 씀 */
const REAL = /현장|실사|사진|photo/i;
/** #516 후속 2(로컬 10/24 08:15 '이름 규칙으로는 글자 그래픽이 안 걸러짐'): 시안 바탕은 브랜드 색이 기본 — 사진은 대표·로컬이 고른 것
 *  (자료실 '마케팅/시안 바탕…' 폴더 또는 태그 '글자없음') + #235 ⓒ(대표 #563) 사진 AI 설명이 '글자 없는 실사'로 본 사진(이름 규칙에도 안 걸리고 얼굴 알아볼 사람 없음). 태그 '글자있음'이면 뺌 */
export const BACKDROP_FOLDER = '마케팅/시안 바탕(글자 없는 사진)';
export const backdropOk = (r: { title?: string; file_name?: string | null; folder: string; tags?: string[] | null; vision?: unknown }) => !markedText(r.tags) && !markedSkip(r.tags)
  && ((r.folder ?? '').startsWith('마케팅/시안 바탕') || markedNoText(r.tags) || (visionOk(r.vision) && visionBackdrop(r.vision) && !textGraphic({ title: r.title ?? '', file_name: r.file_name, folder: r.folder, tags: r.tags, vision: r.vision })));
/** 쓸 사진 고르기: 글자 든 그래픽은 빼고 · 같은 브랜드(제목·폴더·태그·설명에 이름) +6 · 실사(현장·사진) +2 · 제목(주제) 낱말 +2씩(6까지)·본문 낱말 +1씩(4까지) · 누운 사람·뒷모습·어두운 사진은 바탕에서 뺌(171차) · 다른 브랜드 이름 −10 · 최근 30일 다른 게시에 쓴 사진 −4 · exclude = 이 글에 이미 써 본 사진 */
async function pickPhoto(c: Content, brand: string, others: string[], text: string, exclude: Set<string> = new Set(), mode: 'cover' | 'body' = 'cover') {
  return (await rankPhotos(c, brand, others, text, exclude, mode))[0]?.id ?? null;
}
/** #544 사진 순위(점수 높은 순, 같은 점수면 최근 사진) — 피드 틀의 사진 4분할은 앞의 4장 */
async function rankPhotos(c: Content, brand: string, others: string[], text: string, exclude: Set<string> = new Set(), mode: 'cover' | 'body' = 'cover') {
  const sql = db();
  const rows = await sql<{ id: string; title: string; file_name: string; description: string | null; folder: string; tags: string[]; vision: unknown }[]>`select id, coalesce(nullif(title, ''), file_name) as title, file_name, description, folder, tags, vision from library_files
    where tenant = ${c.tenant} and space = 'marketing' and deleted_at is null and upload_status = 'ready' and coalesce(security, 'internal') <> 'confidential'
      and mime_type in ('image/jpeg', 'image/png', 'image/webp') and coalesce(source, '') <> 'ai' order by created_at desc limit 200`;
  if (!rows.length) return [];
  const used = new Set((await sql<{ id: string }[]>`select distinct unnest(v.media_ids)::text as id from mkt_contents k join mkt_versions v on v.content_id = k.id and v.version = k.current_version
    where k.tenant = ${c.tenant} and k.id <> ${c.id} and k.status <> 'canceled' and coalesce(k.scheduled_at, k.created_at) > now() - interval '30 days'`).map((r) => r.id));
  // 171차(로컬 10/26 평가 ⓒ '다짐 스토리 표지 사진이 주제와 안 맞음'): 제목(주제) 낱말은 +2씩 6까지(앞부분이 같으면 — 러닝머신 ↔ 러닝머신으로), 본문 낱말은 +1씩 4까지
  //  → 같은 브랜드 사진끼리는 주제에 맞는 사진이 앞섬. 브랜드 이름 자체는 세지 않음(브랜드 점수와 겹침)
  const brandWords = words([brand, ...others].join(' '));
  const want = new Set([...words(text)].filter((w) => !brandWords.has(w)));
  const wantTitle = [...words(c.title.replace(/^\s*\[시험\]\s*/, ''))].filter((w) => !brandWords.has(w));
  const titleHit = (w: string) => wantTitle.some((t) => t === w || (t.length >= 2 && w.length >= 2 && (t.startsWith(w) || w.startsWith(t))));
  // #235 ⓒ 사진 AI 설명(한 줄·장면·태그·읽히는 글자)도 브랜드·낱말 맞추기에 — 낱말 점수는 제한(설명이 긴 사진이 브랜드 사진을 앞지르지 않게) · 흐린 사진 −3
  const has = (r: (typeof rows)[number], name: string) => !!name && `${r.title} ${r.folder} ${(r.tags ?? []).join(' ')} ${r.description ?? ''} ${visionText(r.vision)}`.toLowerCase().includes(name.toLowerCase());
  const out: { id: string; title: string; score: number; k: number; vision: unknown; description: string | null; hit: number; brand: boolean }[] = []; // hit = 180차 제목·본문 낱말이 맞은 수(0 = 글과 관련 없음) · brand = 181차 이 브랜드 이름이 사진에 있음
  for (const [k, r] of rows.entries()) {
    if (exclude.has(r.id) || (mode === 'cover' ? !backdropOk(r) : !bodyOk(r))) continue; // 바탕 = 고른 사진·AI 가 글자 없는 실사로 본 사진, 블로그 본문 = 글자 든 그래픽·'쓰지 않음'만 빼고
    const fl = photoFlags(r.vision); // 171차 ⓒ: 누운 사람·뒷모습·어두운 사진은 바탕(표지·장)에서 뺌, 블로그 본문에서는 뒤로
    if (mode === 'cover' && (fl.lying || fl.back || fl.dark)) continue;
    let score = has(r, brand) ? 6 : 0;
    if (mode === 'body') score -= (fl.lying ? 4 : 0) + (fl.back ? 2 : 0) + (fl.dark ? 3 : 0);
    if (others.some((o) => has(r, o))) score -= 10;
    else if (REAL.test(`${r.title} ${r.folder} ${(r.tags ?? []).join(' ')}`) || (visionOk(r.vision) && r.vision.kind === 'photo')) score += 2;
    let hitT = 0; let hitB = 0;
    for (const w of words(`${r.title} ${r.description ?? ''} ${(r.tags ?? []).join(' ')} ${visionText(r.vision)}`)) { if (titleHit(w)) hitT++; else if (want.has(w)) hitB++; }
    score += Math.min(6, hitT * 2) + Math.min(4, hitB);
    if (visionOk(r.vision) && r.vision.quality === 'poor') score -= 3;
    if (mode === 'body' && visionOk(r.vision) && r.vision.text === 'much') score -= 2; // 로컬 10/25: 안내판 글자가 많은 실사는 본문에 쓰되 뒤로
    if (used.has(r.id)) score -= 4;
    if (score > -5) out.push({ id: r.id, title: r.title, score, k, vision: r.vision, description: r.description, hit: hitT + hitB, brand: has(r, brand) });
  }
  return out.sort((a, b) => b.score - a.score || a.k - b.k); // 같은 점수면 최근 사진(목록 순서)
}

const cutAt = (s: string, n: number) => { const a = [...s]; if (a.length <= n) return s; const t = a.slice(0, n).join(''); const k = t.lastIndexOf(' '); return `${(k > n * 0.6 ? t.slice(0, k) : t).trim()}…`; };
/** 그림 글자: 큰 글 = 본문 첫 문장(훅, 해시태그·이모지 줄 빼고), 길면 제목 / 작은 글 = 제목(큰 글과 다를 때) */
export function headlineOf(title: string, body: string) {
  const clean = (s: string) => s.replace(/#[^\s#]+/g, '').replace(/\s+/g, ' ').trim();
  const t = clean(title.replace(/^\s*\[시험\]\s*/, ''));
  const first = clean(body.split('\n').map((l) => l.trim()).find((l) => clean(l).length >= 4 && !/^스티커 제안\s*[:：]/.test(l)) ?? ''); // 스토리 '스티커 제안:' 줄은 그림 글자로 안 씀
  const head = first && [...first].length <= 42 ? first : t || cutAt(first, 40);
  return { head: cutAt(head, 44), sub: head === t || !t ? '' : cutAt(t, 40) };
}

/** #235 ⓑ 블로그 본문 사진 후보(원고 AI 가 장면 순서로 골라 '[사진 P번호]' 줄로 넣음) — 본문 규칙(글자 든 그래픽·'쓰지 않음'·다른 브랜드 빼고, 이 브랜드·글과 맞는 사진 먼저) 순위 앞 n장.
 *  caption = 사진 AI 설명 한 줄(없으면 자료실 설명·이름) — 블로그 사진 아래 줄로도 씀 */
export type BlogPhoto = { id: string; title: string; caption: string; scene: string };
export async function blogPhotoCandidates(c: Content, text: string, n = 20): Promise<BlogPhoto[]> {
  const [b] = c.brand_id ? await db()<{ name: string }[]>`select name from mkt_brands where id = ${c.brand_id}` : [];
  const brand = (b?.name ?? '').replace(/^\s*\[시험\]\s*/, '').trim();
  const others = otherBrandNames(await otherBrands(c.tenant, c.brand_id, { site: false })).filter((x) => x !== brand);
  const one = (x: string) => x.replace(/\s+/g, ' ').trim();
  return (await rankPhotos(c, brand, others, text, new Set(), 'body')).slice(0, n).map((r) => {
    const v = visionOk(r.vision) ? r.vision : null;
    return { id: r.id, title: r.title, caption: cutAt(one(v?.caption || r.description || r.title.replace(/\.[a-z0-9]{2,5}$/i, '')), 60), scene: v ? cutAt(one(v.scene.split(/(?<=[.!?])\s/)[0] ?? ''), 80) : '' };
  });
}

/** bodyIds = #235 ⓑ 블로그 원고가 고른 본문 사진(장면 순서) — 그대로 붙이고 표지 바탕으로는 다시 쓰지 않음 */
type DrawOpts = { actor?: SessionUser | null; exclude?: Set<string>; brandOnly?: boolean; photoId?: string | null; photoIds?: string[] | null; template?: string | null; notTemplate?: string | null; bodyIds?: string[] | null };
/** 한 장 그려 자료실(마케팅/자동 시안)에 저장 → 파일 id. 블로그는 대표 이미지(정사각) + 본문 사진(그림에 쓴 것과 다른 실사, 없으면 null)
 *  #544 브랜드 키트 '피드 틀'을 고른 브랜드는 그 틀을 돌려 씀(최근 3개와 같은 틀·사진 금지) — template = 그 틀 그대로(글만 고친 수정본), notTemplate = 다른 틀로 다시 그리기 */
export async function drawAutoVisual(c: Content, body: string, opts: DrawOpts = {}) {
  const sql = db();
  const given = c.channel === 'blog' && opts.bodyIds?.length ? opts.bodyIds : null;
  if (given) opts = { ...opts, exclude: new Set([...(opts.exclude ?? []), ...given]) };
  const [b] = c.brand_id ? await sql<{ name: string; color: string | null; video: any; feed: any }[]>`select name, color, video, feed from mkt_brands where id = ${c.brand_id}` : [];
  const brand = (b?.name ?? '').replace(/^\s*\[시험\]\s*/, '').trim();
  const others = otherBrandNames(await otherBrands(c.tenant, c.brand_id, { site: false })).filter((n) => n !== brand); // 137차: 영문·다른 이름 포함
  const { head, sub } = headlineOf(c.title, body);
  const { libBytes } = await import('./mktVideo');
  const D = await import('./mktCarouselDraw'); const F = await import('./mktFeedTemplates');
  const [logo, font] = await Promise.all([libBytes(c.tenant, b?.video?.logoFileId, /^image\//).catch(() => null), libBytes(c.tenant, b?.video?.fontFileId, /font|\.(otf|ttf)$/i).catch(() => null)]);
  const fontData = font && /\.(otf|ttf)$/i.test(font.name) ? font.data : null;
  const story = c.kind === 'story'; const blog = c.channel === 'blog'; const H = story ? 1920 : blog ? 1080 : 1350;
  const kit = F.kitOf(b?.feed, await D.brandColorInfo(c.tenant, b), brand);
  let png: Buffer; let photoId: string | null = null; let photo: { title: string } | null = null; let template: import('./mktFeedTemplates').TemplateId | null = null; let photoIds: string[] = [];
  if (kit.templates.length) {
    const r = await drawTemplated(c, body, { kit, brand, others, head, sub, H, logo: logo?.data ?? null, font: fontData, opts });
    ({ png, template, photoIds } = r); photoId = photoIds[0] ?? null; photo = r.photoTitle ? { title: r.photoTitle } : null;
  } else {
    // photoId = 그 바탕 사진 그대로(#545 글만 고친 수정본 — 같은 사진에 새 첫 줄, null = 브랜드 색 바탕)
    photoId = opts.photoId !== undefined ? opts.photoId : opts.brandOnly ? null : await pickPhoto(c, brand, others, `${c.title} ${body}`, opts.exclude);
    const p = await libBytes(c.tenant, photoId, /^image\//).catch(() => null); photo = p;
    png = await D.drawSlide({ kind: 'cover', title: head, body: sub, rows: [], imagePlan: '', imageId: photoId }, 0, 1,
      { template: p ? 'box' : 'bold', color: kit.from ? kit.bg : null, brand, keyword: '', logo: logo?.data ?? null, font: fontData, height: H }, p?.data ?? null);
  }
  const jpg = await D.toJpeg(png);
  const actor = opts.actor ?? (await actorOf(c));
  if (!actor) throw badRequest('자료실에 저장할 사람이 없습니다(활성 계정 없음)');
  const { saveGeneratedFile } = await import('./library');
  const safe = c.title.replace(/^\s*\[시험\]\s*/, '').replace(/[\\/:*?"<>|\n]+/g, ' ').trim().slice(0, 50) || '자동 시안';
  const label = template ? F.FEED_TEMPLATES[template].label : null;
  const f = await saveGeneratedFile(actor, { fileName: `${safe}_${story ? '스토리' : blog ? '블로그 표지' : '피드'}.jpg`, mime: 'image/jpeg', data: jpg, title: `${safe} — 자동 시안`, folder: '마케팅/자동 시안',
    tags: ['자동 시안', ...(brand ? [brand] : [])], description: `서버 그리기(크레딧 0)${label ? ` · 틀: ${label}` : ''} · ${photo ? `사진: ${photo.title}` : '사진 없음 — 브랜드 색 바탕'}`, source: 'ai', space: 'marketing', meta: { contentId: c.id, photoId, kind: story ? 'story' : blog ? 'blog' : 'feed', ...(template ? { template } : {}) } });
  // 블로그 본문 사진: 원고가 고른 사진들(bodyIds) — 없으면 표지에 쓴 것과 다른 실사 1장(같은 규칙 — 글자 든 그래픽·다른 브랜드 빼고)
  const bodyIds = given ?? (blog ? [await pickPhoto(c, brand, others, `${c.title} ${body}`, new Set([...(opts.exclude ?? []), ...(photoId ? [photoId] : [])]), 'body')].filter((x): x is string => !!x) : []);
  const [bp] = bodyIds.length ? await sql<{ title: string }[]>`select coalesce(nullif(title, ''), file_name) as title from library_files where id = ${bodyIds[0]}` : [];
  return { fileId: f.id, photoId, photoTitle: photo?.title ?? null, bodyId: bodyIds[0] ?? null, bodyIds, bodyTitle: bp ? `${bp.title}${bodyIds.length > 1 ? ` 외 ${bodyIds.length - 1}장` : ''}` : null, template, templateLabel: label, photoIds };
}

/**
 * 요청 C §3-1(대표 10/25 22:20 #644, 결정 15-11): 피드 = 카드뉴스 3~5장(표지 → 문제 → 해결 → 근거 → 행동) · 스토리 = 3~5프레임(질문 → 답 → 행동).
 * 표지 뒤 장은 원고 AI 의 slides/frames 로, 없으면(예전 글·형식 깨짐) 본문 줄로 만든다. 모두 서버가 브랜드 색 바탕(행동 장은 검정)으로 그림 — 크레딧 0
 */
export type CardPage = { role: 'problem' | 'solution' | 'proof' | 'cta' | 'frame'; title: string; body: string; photoId?: string | null; rel?: 'weak'; pool?: number }; // photoId = 171차 그 장에 깐 실사(없으면 색 바탕) · rel 'weak' = 180차 글과 낱말이 안 맞는 사진(관련 약함) · pool = 고를 때 쓸 수 있던 실사 후보 수
/** 표지 포함 장 수 */
export const PAGES_MIN = 3, PAGES_MAX = 5;
const PAGE_ROLES = ['problem', 'solution', 'proof', 'cta'];
const oneLine = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const HASHTAG_LINE = /^(?:#[^\s#]+\s*)+$/;
/** 원고 AI 가 준 slides(피드: role·title·body) / frames(스토리: title·body) → 장 목록. 표지(cover) 역할은 뺌(표지는 첫 줄·제목으로 따로 그림) · 제목 24자 · 본문 3줄×36자 */
export function pagesFrom(raw: unknown, story: boolean): CardPage[] {
  if (!Array.isArray(raw)) return [];
  const out: CardPage[] = [];
  for (const [k, x] of raw.entries()) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const r = oneLine(o.role).toLowerCase();
    if (r === 'cover' || (story && k === 0 && raw.length >= 2)) continue; // 피드는 role cover · 스토리는 첫 프레임이 표지(본문 첫 줄로 따로 그림)
    const lines = String(o.body ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    const title = cutAt(oneLine(o.title) || lines.shift() || '', 24);
    if (!title) continue;
    out.push({ role: story ? 'frame' : PAGE_ROLES.includes(r) ? (r as CardPage['role']) : 'solution', title, body: lines.slice(0, 3).map((l) => cutAt(l, 36)).join('\n') });
    if (out.length >= PAGES_MAX - 1) break;
  }
  return out;
}
/** 그릴 장(표지 제외): AI 장이 있으면 그것(행동 장은 맨 뒤) · 표지 포함 3장이 안 되면 본문 줄 → 행동 장(연락처) 순서로 채움 */
export function pagesOf(kind: string | null | undefined, pages: CardPage[] | null | undefined, body: string, contact = ''): CardPage[] {
  const story = kind === 'story';
  const given = (pages ?? []).slice(0, PAGES_MAX - 1);
  const cta = given.filter((p) => p.role === 'cta').slice(0, 1); const rest = given.filter((p) => p.role !== 'cta');
  if (rest.length + cta.length >= PAGES_MIN - 1) return [...rest, ...cta];
  const used = new Set(given.flatMap((p) => [p.title, ...p.body.split('\n')]));
  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l && !HASHTAG_LINE.test(l) && !/^스티커 제안\s*[:：]/.test(l) && !(contact && l.includes(contact)) && !used.has(l)).map((l) => l.replace(/#[^\s#]+/g, '').trim()).filter(Boolean);
  if (!story) lines.shift(); // 피드는 첫 줄(훅)이 표지
  const fill: CardPage[] = [];
  for (let k = 0; k < lines.length && rest.length + fill.length + cta.length < PAGES_MIN - 1; k += 2) fill.push({ role: story ? 'frame' : 'solution', title: cutAt(lines[k], 24), body: lines[k + 1] ? cutAt(lines[k + 1], 36) : '' });
  const out = [...rest, ...fill, ...cta];
  if (out.length < PAGES_MIN - 1 && !cta.length) out.push({ role: 'cta', title: story ? '더 알고 싶다면' : '궁금한 점은 편하게 물어보세요', body: contact || '프로필 링크에서 자세히 볼 수 있습니다' });
  while (out.length < PAGES_MIN - 1) out.push({ role: story ? 'frame' : 'solution', title: cutAt(lines[0] ?? body.split('\n').map((l) => l.trim()).find(Boolean) ?? '자세한 내용은 본문에', 24), body: '' });
  return out;
}
/** 브랜드 사실 카드의 연락처 줄(행동 장에 씀) */
async function contactOf(c: Pick<Content, 'brand_id'>) {
  const [b] = c.brand_id ? await db()<{ facts: unknown }[]>`select facts from mkt_brands where id = ${c.brand_id}` : [];
  return contactLine(factsOf(b?.facts));
}
async function brandDraw(c: Content) {
  const [b] = c.brand_id ? await db()<{ name: string; color: string | null; video: any; feed: any }[]>`select name, color, video, feed from mkt_brands where id = ${c.brand_id}` : [];
  const brand = (b?.name ?? '').replace(/^\s*\[시험\]\s*/, '').trim();
  const { libBytes } = await import('./mktVideo');
  const D = await import('./mktCarouselDraw'); const F = await import('./mktFeedTemplates');
  const [logo, font] = await Promise.all([libBytes(c.tenant, b?.video?.logoFileId, /^image\//).catch(() => null), libBytes(c.tenant, b?.video?.fontFileId, /font|\.(otf|ttf)$/i).catch(() => null)]);
  const kit = F.kitOf(b?.feed, await D.brandColorInfo(c.tenant, b), brand);
  return { brand, logo: logo?.data ?? null, font: font && /\.(otf|ttf)$/i.test(font.name) ? font.data : null, color: kit.from ? kit.bg : null, D };
}
const safeTitle = (c: Pick<Content, 'title'>) => c.title.replace(/^\s*\[시험\]\s*/, '').replace(/[\\/:*?"<>|\n]+/g, ' ').trim().slice(0, 50) || '자동 시안';
/** 171차(로컬 10/26 평가 ⓑ '본문 장이 전부 브랜드색 단색+글자'): 실사를 깔 장 — 행동 장은 빼고, 색 장과 번갈아 두 번째 장부터(장이 하나면 그 장)
 *  172차(로컬 10/26 ⑥ 레퍼런스 — 사례형 글은 사진 장이 절반 넘음): 본문 장의 절반(올림)까지 — 2장이면 1장, 3장이면 2장(둘째·셋째), 4장이면 2장(둘째·넷째). 사진이 모자라면 있는 만큼 */
export function photoSlots(pages: CardPage[], story = false): number[] {
  // 181차(로컬 10/26 14:00 ⓐ): 스토리 마지막 프레임은 행동 프레임(원고 규칙 = 문의·저장·프로필) — 카드뉴스 cta 장처럼 사진을 안 깖
  const idx = pages.map((p, k) => (p.role === 'cta' || (story && k === pages.length - 1) ? -1 : k)).filter((k) => k >= 0);
  if (idx.length <= 1) return idx;
  const odd = idx.filter((_, j) => j % 2 === 1); const even = idx.filter((_, j) => j % 2 === 0).reverse(); // 표지 바로 다음 장은 되도록 색 장으로
  return [...odd, ...even].slice(0, Math.ceil(idx.length / 2)).sort((a, b) => a - b);
}
/** 장 노트 — 실사를 깐 장 수 · 180차(로컬 10/26 13:25 ①): 고를 때 쓸 수 있던 후보 수(표지·가까운 글 사진 제외 뒤)와 글과 낱말이 안 맞는 '관련 약함' 장 수도 — 실사가 적은 게 사진 풀 부족인지 바로 보이게 */
export const photoNote = (pages: CardPage[] | null | undefined) => {
  const ps = pages ?? []; const k = ps.filter((p) => p.photoId).length; const weak = ps.filter((p) => p.photoId && p.rel === 'weak').length;
  const pools = ps.map((p) => p.pool).filter((n): n is number => typeof n === 'number');
  if (!k && !pools.length) return '';
  return `(실사 ${k}장${pools.length ? ` · 후보 ${Math.max(...pools)}장` : ''}${weak ? ` · 관련 약함 ${weak}장` : ''})`;
};
/** 표지 뒤 장들을 그려 자료실(마케팅/자동 시안)에 저장 → 파일 id(표지 다음 순서). 피드 1080×1350 · 스토리 1080×1920(위·아래 안전 영역 — 아래 답장 칸은 비움)
 *  171차 ⓑ: photoSlots 장에는 그 장 글과 맞는 실사(바탕 규칙 — 글자 없는 실사, 누운 사람·뒷모습·어두움 제외)를 깔고 글은 흰색(아래 그늘)·제목은 브랜드 색 상자.
 *  표지 사진(opts.exclude)·같은 브랜드 가까운 글(nearPosts)의 표지·장 사진은 안 씀. 쓴 사진은 page.photoId 에 적어 quality.pages 로 저장됨(다음 글에서 빼는 데 씀) */
export async function drawPages(c: Content, pages: CardPage[], opts: { actor?: SessionUser | null; exclude?: Set<string> } = {}): Promise<string[]> {
  if (!pages.length) return [];
  const { brand, logo, font, color, D } = await brandDraw(c);
  const story = c.kind === 'story'; const H = story ? 1920 : 1350;
  const actor = opts.actor ?? (await actorOf(c));
  if (!actor) throw badRequest('자료실에 저장할 사람이 없습니다(활성 계정 없음)');
  const { saveGeneratedFile } = await import('./library'); const { libBytes } = await import('./mktVideo');
  for (const p of pages) { delete p.photoId; delete p.rel; delete p.pool; } // 다시 그릴 때 예전 장의 사진 표시는 지우고 새로 고름
  const slots = photoSlots(pages, c.kind === 'story');
  if (slots.length) {
    const others = otherBrandNames(await otherBrands(c.tenant, c.brand_id, { site: false })).filter((n) => n !== brand);
    const exclude = new Set([...(opts.exclude ?? []), ...(await nearPosts(c)).flatMap((r) => r.ps)]);
    // 180차(로컬 10/26 13:25 ①: 하이링크 스토리 5번째 장에 글('흐름은 프로필에서')과 관련 없는 GX룸 사진 · 다짐 피드 실사 1장이 사진 풀 부족 탓인지 노트로는 알 수 없음):
    //  장마다 후보 순위를 먼저 매기고 ① 글과 낱말이 맞는 사진(hit>0)이 있는 장부터 — 가장 잘 맞는 장이 먼저 가져감(순서대로 집으면 앞 장이 뒤 장의 '얼굴 등록' 사진을 가져감)
    //  ② 남은 장은 브랜드 실사 아무거나 깔되 rel 'weak'(관련 약함) 표시 · pool = 고를 때 쓸 수 있던 후보 수(표지·가까운 글 사진 제외 뒤) → 노트 '후보 m장'. 쓸 사진이 더 없으면 나머지 장은 색 바탕
    //  181차(로컬 10/26 14:00 ⓑ: 브랜드 이름 없는 GX룸 사진이 다짐 피드·하이링크 스토리 양쪽에 쓰임): ②(아무거나)는 이 브랜드 이름이 있는 사진만 — 브랜드 미지정 사진은 글과 낱말이 맞을 때(①)만 쓰고, 후보 수도 그 둘만 셈
    const ranked = new Map<number, Awaited<ReturnType<typeof rankPhotos>>>();
    for (const k of slots) ranked.set(k, await rankPhotos({ ...c, title: pages[k].title }, brand, others, `${pages[k].title} ${pages[k].body} ${c.title}`, exclude));
    const usable = (r: { id: string; hit: number; brand: boolean }, fit: boolean) => !exclude.has(r.id) && (fit ? r.hit > 0 : r.brand);
    const pool = Math.max(0, ...[...ranked.values()].map((r) => r.filter((x) => x.brand || x.hit > 0).length));
    for (const k of slots) pages[k].pool = pool;
    const best = (k: number) => ranked.get(k)?.find((r) => usable(r, true))?.hit ?? 0;
    const take = (k: number, fit: boolean) => {
      const top = ranked.get(k)?.find((r) => usable(r, fit));
      if (!top) return;
      pages[k].photoId = top.id; if (!fit) pages[k].rel = 'weak'; exclude.add(top.id);
    };
    for (const k of [...slots].sort((a, b) => best(b) - best(a) || a - b)) if (best(k) > 0) take(k, true);
    for (const k of slots) if (!pages[k].photoId) take(k, false);
  }
  const safe = safeTitle(c); const n = pages.length + 1; const ids: string[] = [];
  for (const [k, p] of pages.entries()) {
    const photo = p.photoId ? await libBytes(c.tenant, p.photoId, /^image\//).catch(() => null) : null;
    if (p.photoId && !photo) delete p.photoId; // 파일을 못 읽으면 색 바탕
    const png = await D.drawSlide({ kind: p.role === 'cta' ? 'cta' : 'body', title: p.title, body: p.body, rows: [], imagePlan: '', imageId: p.photoId ?? null }, k + 1, n, { template: 'bold', color, brand, keyword: '', logo, font, height: H }, photo?.data ?? null);
    const f = await saveGeneratedFile(actor, { fileName: `${safe}_${story ? '스토리' : '피드'} ${k + 2}of${n}.jpg`, mime: 'image/jpeg', data: await D.toJpeg(png), title: `${safe} — ${story ? '프레임' : '카드'} ${k + 2}/${n}`, folder: '마케팅/자동 시안',
      tags: ['자동 시안', ...(brand ? [brand] : [])], description: `서버 그리기(크레딧 0) · ${story ? '스토리 프레임' : '카드뉴스'} ${k + 2}/${n}${p.role === 'cta' ? ' · 행동 장' : ''}${photo ? ` · 사진: ${photo.title}` : ''}`, source: 'ai', space: 'marketing', meta: { contentId: c.id, page: k + 2, of: n, role: p.role, kind: story ? 'story' : 'feed', photoId: p.photoId ?? null } });
    ids.push(f.id);
  }
  return ids;
}
/** 요청 C §3-1 블로그: 본문 실사가 3장이 안 되면 모자란 만큼 브랜드 색 '도표형 카드'(소제목 + 첫 문장 → 인용구 → 문장, 1080×1080)로 채움 */
export async function drawInfoCards(c: Content, body: string, need: number, opts: { actor?: SessionUser | null } = {}): Promise<string[]> {
  if (need <= 0) return [];
  const T = await import('./mktText');
  const blocks: { title: string; body: string }[] = []; let cur: { title: string; body: string } | null = null;
  const lines = body.split('\n').map((l) => l.trim()).filter((l) => l && !T.PHOTO_LINE.test(l));
  for (const l of lines) {
    if (T.HEAD_LINE.test(l)) { cur = { title: cutAt(l.replace(/^(?:■|##|\[소제목\])\s*/, '').trim(), 24), body: '' }; if (cur.title) blocks.push(cur); continue; }
    if (cur && !cur.body && !T.QUOTE_LINE.test(l)) cur.body = cutAt(l, 60);
  }
  if (blocks.length < need) blocks.push(...lines.filter((l) => T.QUOTE_LINE.test(l)).map((l) => ({ title: cutAt(l.replace(/^[“"「『]|[”"」』]$/g, ''), 30), body: '' })));
  if (blocks.length < need) blocks.push(...lines.filter((l) => !T.HEAD_LINE.test(l) && !T.QUOTE_LINE.test(l) && [...l].length >= 8).map((l) => ({ title: cutAt(l, 30), body: '' })));
  const pick = blocks.slice(0, need);
  while (pick.length < need) pick.push({ title: cutAt(c.title.replace(/^\s*\[시험\]\s*/, ''), 24), body: '' });
  const { brand, logo, font, color, D } = await brandDraw(c);
  const actor = opts.actor ?? (await actorOf(c));
  if (!actor) throw badRequest('자료실에 저장할 사람이 없습니다(활성 계정 없음)');
  const { saveGeneratedFile } = await import('./library');
  const safe = safeTitle(c); const ids: string[] = [];
  for (const [k, p] of pick.entries()) {
    const png = await D.drawSlide({ kind: 'body', title: p.title, body: p.body, rows: [], imagePlan: '', imageId: null }, 0, 1, { template: 'bold', color, brand, keyword: '', logo, font, height: 1080 }, null);
    const f = await saveGeneratedFile(actor, { fileName: `${safe}_블로그 카드 ${k + 1}.jpg`, mime: 'image/jpeg', data: await D.toJpeg(png), title: `${safe} — 본문 카드 ${k + 1}`, folder: '마케팅/자동 시안',
      tags: ['자동 시안', ...(brand ? [brand] : [])], description: '서버 그리기(크레딧 0) · 블로그 본문 도표형 카드(실사가 모자라 채움)', source: 'ai', space: 'marketing', meta: { contentId: c.id, kind: 'blog_card', page: k + 1 } });
    ids.push(f.id);
  }
  return ids;
}
/** 표지 뒤에 붙일 장(자동 제작 글만): 피드·스토리 = 카드뉴스 장(원고의 pages, 없으면 본문으로) · 블로그 = 실사가 3장이 안 되면 도표형 카드 — 사람이 쓴 글은 그대로 */
async function pagesAfterCover(c: Content & { quality?: any }, body: string, have: number, opts: { actor?: SessionUser | null; exclude?: Set<string> } = {}): Promise<{ ids: string[]; note: string; pages: CardPage[] | null }> {
  if (!c.auto) return { ids: [], note: '', pages: null };
  if (c.kind === 'feed' || c.kind === 'story') { const pages = pagesOf(c.kind, c.quality?.pages ?? null, body, await contactOf(c)); const ids = await drawPages(c, pages, opts); return { ids, note: ` · ${c.kind === 'story' ? '프레임' : '카드'} ${ids.length + 1}장${photoNote(pages)}`, pages }; }
  if (c.channel === 'blog' && have < BLOG_AUTO_MEDIA) { const ids = await drawInfoCards(c, body, BLOG_AUTO_MEDIA - have, opts); return { ids, note: ids.length ? ` · 도표형 카드 ${ids.length}장` : '', pages: null }; }
  return { ids: [], note: '', pages: null };
}

/** #544 같은 브랜드에서 게시 시각이 가까운 5개 글의 틀(t)·사진(ps = 표지 photoId·photoIds + 171차 장 사진 pages[].photoId) — 연속 같은 표지·같은 사진 금지에 씀 */
async function nearPosts(c: Content): Promise<{ t: string | null; ps: string[] }[]> {
  if (!c.brand_id) return [];
  const sql = db();
  const [me] = await sql<{ at: Date }[]>`select coalesce(scheduled_at, created_at, now()) as at from mkt_contents where id = ${c.id}`;
  const at = me?.at ?? new Date();
  const rows = await sql<{ t: string | null; p: string | null; ps: string[] | null; pp: string[] | null }[]>`select quality->'visual'->>'template' as t, quality->'visual'->>'photoId' as p,
      array(select jsonb_array_elements_text(case when jsonb_typeof(quality->'visual'->'photoIds') = 'array' then quality->'visual'->'photoIds' else '[]'::jsonb end)) as ps,
      array(select x->>'photoId' from jsonb_array_elements(case when jsonb_typeof(quality->'pages') = 'array' then quality->'pages' else '[]'::jsonb end) x where x->>'photoId' is not null) as pp
    from mkt_contents where tenant = ${c.tenant} and brand_id = ${c.brand_id} and id <> ${c.id} and status <> 'canceled' and quality->'visual'->>'by' = 'server'
    order by abs(extract(epoch from (coalesce(scheduled_at, created_at) - ${at}::timestamptz))) limit 5`;
  return rows.map((r) => ({ t: r.t, ps: [r.p, ...(r.ps ?? []), ...(r.pp ?? [])].filter((x): x is string => !!x) }));
}
/** #544 피드 틀로 그리기: 같은 브랜드에서 게시 시각이 가까운 5개 글의 틀·사진은 빼고(요청 C §3-2 연속 같은 표지 금지) → 칸(AI card·글)·사진·화면 캡처로 쓸 수 있는 틀 중 덜 쓴 것 */
async function drawTemplated(c: Content, body: string, a: { kit: import('./mktFeedTemplates').Kit; brand: string; others: string[]; head: string; sub: string; H: number; logo: Buffer | null; font: Buffer | null; opts: DrawOpts }) {
  const sql = db(); const F = await import('./mktFeedTemplates'); const { libBytes, videoAssets } = await import('./mktVideo');
  const [me] = await sql<{ card: any }[]>`select quality->'card' as card from mkt_contents where id = ${c.id}`;
  const near = await nearPosts(c);
  const usage = Object.fromEntries((c.brand_id ? await sql<{ t: string; n: number }[]>`select t, count(*)::int as n from (select quality->'visual'->>'template' as t from mkt_contents
    where tenant = ${c.tenant} and brand_id = ${c.brand_id} and id <> ${c.id} and quality->'visual'->>'template' is not null order by coalesce(scheduled_at, created_at) desc limit 15) x group by t` : []).map((r) => [r.t, r.n]));
  // 사진: 가까운 3개 글에 쓴 사진·이 글에 써 본 사진은 빼고(글만 고친 수정본은 쓰던 사진 그대로)
  const keep = a.opts.photoIds?.length ? a.opts.photoIds : a.opts.photoId ? [a.opts.photoId] : null;
  const exclude = new Set([...(a.opts.exclude ?? []), ...near.flatMap((r) => r.ps)]);
  const ranked = keep ? (await sql<{ id: string; title: string }[]>`select id::text, coalesce(nullif(title, ''), file_name) as title from library_files where id = any(${keep}::uuid[]) and tenant = ${c.tenant} and deleted_at is null`)
      .sort((x, y) => keep.indexOf(x.id) - keep.indexOf(y.id))
    : a.opts.photoId === null ? [] : await rankPhotos(c, a.brand, a.others, `${c.title} ${body}`, exclude);
  const has = (r: { title: string; folder: string; tags?: string[] | null; description?: string | null }, n: string) => !!n && `${r.title} ${r.folder} ${(r.tags ?? []).join(' ')} ${r.description ?? ''}`.toLowerCase().includes(n.toLowerCase());
  const screens = a.kit.templates.includes('phone') ? (await videoAssets(c.tenant, '영상 화면 캡처')).filter((r) => !a.others.some((o) => has(r, o))).sort((x, y) => Number(has(y, a.brand)) - Number(has(x, a.brand))) : [];
  const hints = F.hintsOf({ head: a.head, sub: a.sub, title: c.title, body, card: c.card ?? me?.card ?? null, kit: a.kit });
  const pool = a.kit.templates.filter((t) => F.eligible(t, hints, { photo: ranked.length > 0, photos: ranked.length, screen: screens.length > 0 }));
  const template = F.chooseTemplate(pool, { near: near.map((r) => r.t), usage, seed: `${c.id}:${c.current_version}`, prefer: a.opts.template, avoid: a.opts.notTemplate }) ?? 'title'; // 쓸 수 있는 틀이 없으면 제목형(키트 색)
  const need = F.FEED_TEMPLATES[template].need as string | null;
  const pick = need === 'photo' ? ranked.slice(0, 1) : need === 'photos4' ? ranked.slice(0, 4) : [];
  const files = (await Promise.all(pick.map(async (p) => ({ p, f: await libBytes(c.tenant, p.id, /^image\//).catch(() => null) })))).filter((x) => x.f);
  const screen = need === 'screen' && screens[0] ? await libBytes(c.tenant, screens[0].id, /^image\//).catch(() => null) : null;
  const set = F.EVENT_SETS[F.hash(c.id) % F.EVENT_SETS.length];
  const png = await F.renderFeed({ t: template, kit: a.kit, brand: a.brand, H: a.H, h: hints, photo: files[0]?.f?.data ?? null, photos: files.map((x) => ({ data: x.f!.data, label: F.labelOf(x.p.title) })), screen: screen?.data ?? null, logo: a.logo, font: a.font, set });
  return { png, template, photoIds: files.map((x) => x.p.id), photoTitle: files[0]?.p.title ?? null };
}

/**
 * #544(대표 10/24 '브랜드별 레퍼런스 업체와 비교해 개선한 뒤 승인 다시'): 브랜드 키트 '피드 틀'을 하나 이상 고르기 전에는
 * 정기·밤사이 자동 제작 시안을 승인함에 올리지 않고 초안으로 보관한다. 사람이 직접 누른 제작([지금 만들기]·[다시 만들기])과 [승인 요청]은 예외.
 */
export const templateReady = (brand: { feed?: { templates?: unknown } | null } | null | undefined) => Array.isArray(brand?.feed?.templates) && brand.feed.templates.length > 0;
export const HOLD_NOTE = '브랜드 템플릿 준비 전 — 자동 시안은 승인함에 올리지 않고 초안으로 보관합니다(대표 10/24)';
/** 시안이 없어서 단 문제 줄(#516) — 시안을 붙이면 지운다 */
export const VISUAL_ISSUE = /^(시안 이미지 없음|영상 시안 제작 중)/;
/** 시안 붙여 새 버전(같은 글). 시안이 없어서만 막혀 있던 글(수정 요청 상태)은 승인 대기로, 열린 이미지 제작 요청은 '서버 그리기로 대체'
 *  replace = 서버가 그린 시안만 붙어 있을 때 새로 그린 것으로 바꿈(다시 그리기). rv 2 = 글자 든 그래픽을 빼는 규칙으로 그림 · tried = 이 글에 써 본 바탕 사진 */
async function attachVisual(c: Content, fileId: string, note: string, actorId: string | null, photoId: string | null = null, replace = false, extra: string[] = [], more: { template?: string | null; photoIds?: string[]; pages?: CardPage[] | null } = {}) {
  const sql = db(); const M = await import('./marketing');
  return sql.begin(async (tx) => {
    const [cur] = await tx<any[]>`select id, current_version, status, quality from mkt_contents where id = ${c.id} for update`;
    if (!cur || cur.current_version !== c.current_version || ['published', 'canceled', 'approved'].includes(cur.status)) return null; // 그사이 바뀐 콘텐츠는 건너뜀
    const [prev] = await tx<{ body: string; media_ids: string[] }[]>`select body, media_ids from mkt_versions where content_id = ${c.id} and version = ${cur.current_version}`;
    const q = cur.quality ?? {};
    if (replace ? !(prev?.media_ids?.length && q.visual?.by === 'server' && String(prev.media_ids[0]) === q.visual.fileId) : prev?.media_ids?.length) return null;
    const v = cur.current_version + 1;
    const tried = [...new Set([...(replace ? ((q.visual?.tried ?? []) as string[]) : []), ...(replace && q.visual?.photoId ? [q.visual.photoId as string] : []), ...(photoId ? [photoId] : [])])].slice(-20);
    const prevTail = (prev?.media_ids ?? []).slice(1).map(String);
    const media = [fileId, ...(replace && prevTail.length ? prevTail : extra)]; // 다시 그리기: 블로그 본문 사진·카드뉴스 장은 그대로 — 표지 1장뿐이던 예전 글은 요청 C 장(extra)을 함께 붙임
    // 요청 C §3-3: 사진 수 규칙(피드 3~5장·스토리 3~5프레임·블로그 표지+3장)에 못 미치면 승인함에 못 올림 — 채워지면 그 줄을 지움
    const rule = M.mediaRule(c.channel, c.kind, media.length, !!c.auto);
    const issues = [...((q.issues ?? []) as string[]).filter((x) => !VISUAL_ISSUE.test(x) && !M.MEDIA_RULES.includes(x)), ...(rule ? [rule] : [])];
    const onlyVisual = q.passed === false && (q.issues ?? []).length > 0 && !issues.length;
    const status = rule && ['pending', 'changes'].includes(cur.status) ? 'changes' : cur.status === 'changes' && onlyVisual ? 'pending' : cur.status;
    const quality = { ...q, issues, ...(onlyVisual ? { passed: true } : rule ? { passed: false } : {}), ...(q.report ? { report: { ...q.report, v } } : {}), ...(more.pages?.length ? { pages: more.pages } : {}), visual: { by: 'server', fileId, at: new Date().toISOString(), photoId, rv: 3, tried, ...(media.length > 1 ? { bodyIds: media.slice(1) } : {}), ...(more.template ? { template: more.template } : {}), ...((more.photoIds?.length ?? 0) > 1 ? { photoIds: more.photoIds } : {}) } };
    await tx`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, ${v}, ${prev?.body ?? ''}, ${media}, ${note}, ${actorId})`;
    await tx`update mkt_contents set current_version = ${v}, status = ${status}, quality = ${tx.json(quality as never)}, reminded_at = null, updated_at = now() where id = ${c.id}`;
    await tx`update mkt_production_requests set status = 'canceled', reason = '서버 그리기로 시안을 붙임', decided_at = now() where content_id = ${c.id} and kind = 'image' and status in ('open', 'needs_approval')`;
    await tx`insert into mkt_credit_ledger (tenant, content_id, version, kind, credits, note, title) values (${c.tenant}, ${c.id}, ${v}, 'generate_image', 0, ${replace ? '시안 서버 다시 그리기 — 크레딧 0' : '시안 서버 그리기 — 크레딧 0'}, ${c.title})`;
    return { version: v, status: status as string };
  });
}

/** 정기 실행: 자동 제작분 중 시안 없이 승인 대기인 것에 시안을 그려 붙이고 재승인 요청(사람이 수정 요청한 것은 건드리지 않음)
 *  정기 실행 한 번(60초)에 다른 일도 있으므로 한 번에 4건·20초까지 — 남은 것은 다음 실행(15분)에 */
export async function fillMissingVisuals(tenant: string, limit = 4, budgetMs = 20000) {
  const sql = db(); const t0 = Date.now();
  const rows = await sql<(Content & { status: string; quality: any })[]>`select c.id, c.tenant, c.brand_id, c.title, c.channel, c.kind, c.created_by, c.is_test, c.current_version, c.status, c.quality, c.auto from mkt_contents c
    join mkt_versions v on v.content_id = c.id and v.version = c.current_version
    where c.tenant = ${tenant} and c.auto and c.status in ('pending', 'changes') and cardinality(v.media_ids) = 0 and c.channel in ('instagram', 'facebook', 'blog')
      and coalesce(c.kind, '') not in ('reels', 'shorts', 'video') and (c.scheduled_at is null or c.scheduled_at > now() - interval '1 day')
      and not exists (select 1 from mkt_decisions d where d.content_id = c.id and d.version = c.current_version and d.decision in ('changes', 'hold'))
    order by c.scheduled_at nulls last limit ${limit}`;
  const out: { id: string; version?: number; error?: string }[] = [];
  const M = await import('./mktAuto');
  for (const c of rows) {
    if (Date.now() - t0 > budgetMs) break;
    try {
      const [v] = await sql<{ body: string }[]>`select body from mkt_versions where content_id = ${c.id} and version = ${c.current_version}`;
      const d = await drawAutoVisual(c, v?.body ?? '', { bodyIds: c.quality?.bodyPlan ?? null }); // #235 ⓑ 원고가 고른 블로그 사진(그릴 때 실패해 못 붙였던 것)
      const after = await pagesAfterCover(c, v?.body ?? '', 1 + d.bodyIds.length, { exclude: new Set([...(d.photoId ? [d.photoId] : []), ...d.photoIds]) }); // 요청 C: 카드뉴스 장·스토리 프레임·블로그 도표형 카드
      const r = await attachVisual(c, d.fileId, `시안 자동 그리기(서버·크레딧 0)${d.templateLabel ? ` — 틀: ${d.templateLabel}` : ''}${d.photoTitle ? ` — 사진: ${d.photoTitle}` : ' — 브랜드 색 바탕'}${d.bodyTitle ? ` · 본문 사진: ${d.bodyTitle}` : c.channel === 'blog' && !after.ids.length ? ' · 본문 사진 없음(실사를 붙여 주세요)' : ''}${after.note}`, c.created_by, d.photoId, false, [...d.bodyIds, ...after.ids], { template: d.template, photoIds: d.photoIds, pages: after.pages });
      if (!r) continue;
      out.push({ id: c.id, version: r.version });
      if (r.status === 'pending') await M.mktNotify(sql, c, null, { approval: true, type: 'review_requested', title: `시안을 붙여 다시 올렸습니다(v${r.version}): ${c.title}`, body: '시안 없이 올라갔던 자동 제작 글에 서버가 그린 이미지를 붙였습니다 — 승인해 주세요',
        link: `/s/marketing/approvals?c=${c.id}`, entityType: 'mkt_content', entityId: c.id, dedupeKey: `mktvis:${c.id}:${r.version}` });
    } catch (e: any) { out.push({ id: c.id, error: String(e?.message ?? e).slice(0, 200) }); }
  }
  return out;
}

/** #516 후속(로컬 10/24 07:35 — 6건이 예전 그래픽 위에 그려져 글자가 겹침): 새 규칙(rv 2) 전에 그린 승인 전 서버 시안을 한 번씩 점검.
 *  쓴 바탕 사진이 글자 든 그래픽이면 새 규칙으로 다시 그려 새 버전(무료)·승인자 알림, 실사였으면 그대로 두고 표시만. 사람이 수정 요청·보류한 버전은 건드리지 않음 */
export async function redrawTextVisuals(tenant: string, limit = 8, budgetMs = 15000) {
  const sql = db(); const t0 = Date.now();
  const rows = await sql<(Content & { status: string; quality: any })[]>`select c.id, c.tenant, c.brand_id, c.title, c.channel, c.kind, c.created_by, c.is_test, c.current_version, c.status, c.quality, c.auto from mkt_contents c
    join mkt_versions v on v.content_id = c.id and v.version = c.current_version
    where c.tenant = ${tenant} and c.status in ('pending', 'changes') and c.quality->'visual'->>'by' = 'server' and coalesce(c.quality->'visual'->>'rv', '1')::int < 3
      and cardinality(v.media_ids) >= 1 and v.media_ids[1]::text = c.quality->'visual'->>'fileId'
      and (c.scheduled_at is null or c.scheduled_at > now() - interval '1 day')
      and not exists (select 1 from mkt_decisions d where d.content_id = c.id and d.version = c.current_version and d.decision in ('changes', 'hold'))
    order by c.scheduled_at nulls last limit ${limit}`;
  const out: { id: string; version?: number; kept?: boolean; error?: string }[] = [];
  const M = await import('./mktAuto');
  for (const c of rows) {
    if (Date.now() - t0 > budgetMs) break;
    try {
      const [f] = c.quality.visual.photoId !== undefined ? [{ photo: (c.quality.visual.photoId as string | null) }] : await sql<{ photo: string | null }[]>`select meta->>'photoId' as photo from library_files where id = ${c.quality.visual.fileId}`;
      const photoId = f?.photo ?? null;
      const [p] = photoId ? await sql<{ title: string; file_name: string; folder: string; tags: string[]; vision: unknown }[]>`select coalesce(nullif(title, ''), file_name) as title, file_name, folder, tags, vision from library_files where id = ${photoId}` : [];
      if (!p || backdropOk(p)) { // 브랜드 색 바탕·고른 사진 = 괜찮음 → 표시만
        await sql`update mkt_contents set quality = jsonb_set(quality, '{visual}', (quality->'visual') || ${sql.json({ rv: 3, ...(photoId ? { photoId } : {}) } as never)}::jsonb) where id = ${c.id}`;
        out.push({ id: c.id, kept: true }); continue;
      }
      const [v] = await sql<{ body: string; media_ids: string[] }[]>`select body, media_ids from mkt_versions where content_id = ${c.id} and version = ${c.current_version}`;
      const d = await drawAutoVisual(c, v?.body ?? '', { exclude: new Set([photoId!, ...((c.quality.visual.tried ?? []) as string[])]) });
      const after = (v?.media_ids?.length ?? 0) <= 1 ? await pagesAfterCover(c, v?.body ?? '', 1, { exclude: new Set([...(d.photoId ? [d.photoId] : []), ...d.photoIds]) }) : { ids: [] as string[], note: '', pages: null }; // 요청 C: 표지 1장뿐이던 예전 글은 장도 함께
      const q = { ...c.quality, visual: { ...c.quality.visual, photoId } };
      await sql`update mkt_contents set quality = ${sql.json(q as never)} where id = ${c.id} and current_version = ${c.current_version}`;
      const r = await attachVisual(c, d.fileId, `시안 다시 그리기(바탕 = 브랜드 색 또는 고른 사진·서버·크레딧 0)${d.templateLabel ? ` — 틀: ${d.templateLabel}` : ''}${d.photoTitle ? ` — 사진: ${d.photoTitle}` : ' — 브랜드 색 바탕'}${after.note}`, c.created_by, d.photoId, true, after.ids, { template: d.template, photoIds: d.photoIds, pages: after.pages });
      if (!r) continue;
      out.push({ id: c.id, version: r.version });
      // 로컬 08:15 (d): 다시 그린 알림은 같은 글에 한 번만
      if (r.status === 'pending') await M.mktNotify(sql, c, null, { approval: true, type: 'review_requested', title: `시안을 다시 그렸습니다(v${r.version}): ${c.title}`, body: '바탕 그림의 글자와 겹치던 시안을 브랜드 색 바탕(또는 고른 사진)으로 새로 그렸습니다 — 승인해 주세요',
        link: `/s/marketing/approvals?c=${c.id}`, entityType: 'mkt_content', entityId: c.id, dedupeKey: `mktvisr:${c.id}` });
    } catch (e: any) { out.push({ id: c.id, error: String(e?.message ?? e).slice(0, 200) }); }
  }
  return out;
}

/** #544 브랜드 키트 [피드 틀 미리보기]: 저장 전 값(feed)으로 틀마다 한 장씩 — 이 브랜드의 최근 글(없으면 소개)로 그림. 사진·화면이 없으면 회색 자리(안내 줄 같이)
 *  관리자만(키트를 고칠 수 있는 사람) · 저장·자료실 기록 없음 */
export async function feedPreview(u: SessionUser, id: string, i: { feed?: import('./mktFeedTemplates').FeedStored; all?: boolean }) {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('브랜드 키트는 관리자만 고칠 수 있습니다');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('브랜드를 찾을 수 없습니다');
  const sql = db(); const t = tenantOf(u); const F = await import('./mktFeedTemplates'); const D = await import('./mktCarouselDraw'); const { libBytes, videoAssets } = await import('./mktVideo');
  const [b] = await sql<any[]>`select id, name, color, video, feed, intro from mkt_brands where id = ${id} and tenant = ${t}`;
  if (!b) throw notFound('브랜드를 찾을 수 없습니다');
  const feed = i.feed ? F.normalizeFeed(i.feed) : b.feed;
  const brand = String(b.name).replace(/^\s*\[시험\]\s*/, '').trim();
  const others = otherBrandNames(await otherBrands(t, id, { site: false })).filter((n) => n !== brand);
  const color = await D.brandColorInfo(t, { ...b, feed });
  const kit = F.kitOf(feed, color, brand);
  const [last] = await sql<{ title: string; body: string; card: any }[]>`select c.title, v.body, c.quality->'card' as card from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version
    where c.tenant = ${t} and c.brand_id = ${id} and c.channel in ('instagram', 'facebook') and c.status <> 'canceled' and length(v.body) > 10 order by c.updated_at desc limit 1`;
  const title = (last?.title ?? `${brand} 이번 주 소식`).replace(/^\s*\[시험\]\s*/, ''); const body = last?.body ?? String(b.intro || `${brand}의 이번 주 소식을 알려 드립니다`);
  const { head, sub } = headlineOf(title, body);
  const real = F.hintsOf({ head, sub, title, body, card: last?.card, kit });
  const h = { ...real, points: real.points.length >= 3 ? real.points : ['핵심 내용 하나', '핵심 내용 둘', '핵심 내용 셋'], left: real.left || '예전 방식', right: real.right || '새 방식',
    prices: real.prices.length >= 2 ? real.prices : [{ label: '1개월', value: '금액' }, { label: '3개월', value: '금액' }, { label: '6개월', value: '금액' }] };
  const fake = { id: '00000000-0000-0000-0000-000000000000', tenant: t, brand_id: id, title, channel: 'instagram', kind: 'feed', created_by: null, current_version: 0 };
  const ranked = (await rankPhotos(fake, brand, others, `${title} ${body}`)).slice(0, 4);
  const files = (await Promise.all(ranked.map(async (p) => ({ p, f: await libBytes(t, p.id, /^image\//).catch(() => null) })))).filter((x) => x.f);
  const has = (r: { title: string; folder: string; tags?: string[] | null; description?: string | null }, n: string) => !!n && `${r.title} ${r.folder} ${(r.tags ?? []).join(' ')} ${r.description ?? ''}`.toLowerCase().includes(n.toLowerCase());
  const caps = (await videoAssets(t, '영상 화면 캡처')).filter((r) => !others.some((o) => has(r, o))).sort((x, y) => Number(has(y, brand)) - Number(has(x, brand)));
  const screen = caps[0] ? await libBytes(t, caps[0].id, /^image\//).catch(() => null) : null;
  const sharp = (await import('sharp')).default;
  const gray = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#9CA3AF' } }).jpeg().toBuffer(); // 사진·화면 자리(예시)
  const photos = files.length >= 4 ? files.map((x) => ({ data: x.f!.data, label: F.labelOf(x.p.title) })) : [...files.map((x) => ({ data: x.f!.data, label: F.labelOf(x.p.title) })), ...Array.from({ length: 4 - files.length }, () => ({ data: gray, label: '사진 자리' }))];
  const [lg, ft] = await Promise.all([libBytes(t, b.video?.logoFileId, /^image\//).catch(() => null), libBytes(t, b.video?.fontFileId, /font|\.(otf|ttf)$/i).catch(() => null)]);
  const list = i.all || !kit.templates.length ? F.TEMPLATE_IDS : kit.templates;
  const images = [];
  for (const [k, tp] of list.entries()) {
    const need = F.FEED_TEMPLATES[tp].need as string | null;
    const note = need === 'photo' && !files.length ? "회색 = 사진 자리 — 자료실 '마케팅/시안 바탕(글자 없는 사진)'에 사진을 올리면 이 틀을 씁니다"
      : need === 'photos4' && files.length < 4 ? `사진 ${files.length}장 — 시안 바탕 사진이 4장 이상일 때 이 틀을 씁니다` : need === 'screen' && !screen ? "회색 = 화면 자리 — 자료실 '영상 화면 캡처' 폴더에 화면 캡처를 올리면 이 틀을 씁니다"
        : need === 'points' && real.points.length < 3 ? '예시 글 — 글에 핵심이 3개 이상일 때 이 틀을 씁니다' : need === 'compare' && !(real.left && real.right) ? '예시 글 — 글이 두 가지를 견줄 때 이 틀을 씁니다'
          : need === 'prices' && real.prices.length < 2 ? '예시 금액 — 브랜드 키트 재료(주력 상품)에 금액이 2개 이상 있을 때 이 틀을 씁니다' : null;
    const png = await F.renderFeed({ t: tp, kit, brand, H: 1350, h, photo: photos[0].data, photos, screen: screen?.data ?? gray, logo: lg?.data ?? null, font: ft && /\.(otf|ttf)$/i.test(ft.name) ? ft.data : null, set: F.EVENT_SETS[k % F.EVENT_SETS.length] });
    const jpg = await sharp(png).resize(540).jpeg({ quality: 82 }).toBuffer();
    images.push({ template: tp, label: F.FEED_TEMPLATES[tp].label, desc: F.FEED_TEMPLATES[tp].desc, note, src: `data:image/jpeg;base64,${jpg.toString('base64')}` });
  }
  return { color, sample: { title, fromContent: !!last }, images };
}

/** 승인함 [지금 만들기]: 마케팅 공간 사람 — 그 자리에서 그려 붙이고 재승인 대기
 *  redraw = [다시 그리기(무료)]: 서버가 그린 시안만 붙어 있을 때 이 글에 써 본 사진을 빼고 다시 그려 새 버전(쓸 사진이 없으면 브랜드 색 바탕) */
export async function makeVisualNow(u: SessionUser, id: string, opts: { redraw?: boolean } = {}) {
  await assertSpace(u, 'marketing');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('콘텐츠를 찾을 수 없습니다');
  const sql = db();
  const [c] = await sql<(Content & { status: string; quality: any })[]>`select id, tenant, brand_id, title, channel, kind, created_by, is_test, current_version, status, quality, auto from mkt_contents where id = ${id} and tenant = ${tenantOf(u)}`;
  if (!c) throw notFound('콘텐츠를 찾을 수 없습니다');
  if (!serverVisual(c)) throw badRequest(c.channel === 'threads' ? '스레드는 글만으로 올릴 수 있습니다' : '영상 시안은 서버가 그리지 않습니다 — 제작 요청 카드(제작의뢰실)로 만들어 주세요');
  if (['published', 'canceled'].includes(c.status)) throw badRequest('게시했거나 취소한 콘텐츠입니다');
  const [v] = await sql<{ body: string; media_ids: string[] }[]>`select body, media_ids from mkt_versions where content_id = ${id} and version = ${c.current_version}`;
  const vis = c.quality?.visual;
  if (opts.redraw) {
    if (c.status === 'approved') throw badRequest('승인한 콘텐츠입니다 — [게시 전 수정 요청]으로 고쳐 주세요');
    if (!(v?.media_ids?.length && vis?.by === 'server' && String(v.media_ids[0]) === vis.fileId)) throw badRequest('서버가 그린 시안만 다시 그릴 수 있습니다 — 직접 붙인 시안은 수정본으로 바꿔 주세요');
  } else if (v?.media_ids?.length) throw badRequest('이미 시안이 있습니다');
  let exclude = new Set<string>();
  if (opts.redraw) { // 이 글에 써 본 바탕 사진은 빼고(예전 그림은 자료실 meta 에 사진 id)
    const [f] = vis?.photoId ? [{ photo: vis.photoId as string }] : await sql<{ photo: string | null }[]>`select meta->>'photoId' as photo from library_files where id = ${vis.fileId}`;
    exclude = new Set([...((vis.tried ?? []) as string[]), ...(f?.photo ? [f.photo] : [])]);
    if (f?.photo && !vis.photoId) await sql`update mkt_contents set quality = jsonb_set(quality, '{visual}', (quality->'visual') || ${sql.json({ photoId: f.photo } as never)}::jsonb) where id = ${id}`;
  }
  // 로컬 08:15 (c): [브랜드 색으로 다시 그리기] · #544 피드 틀이 있는 브랜드는 [다른 틀로 다시 그리기](지금 틀은 빼고)
  // #235 ⓑ 블로그: 다시 그리기는 붙어 있는 본문 사진을 표지 바탕으로 다시 쓰지 않음 · 처음 그리기는 원고가 고른 사진(bodyPlan)을 붙임
  const bodyIds = opts.redraw ? (v?.media_ids ?? []).slice(1).map(String) : (c.quality?.bodyPlan ?? null);
  const d = await drawAutoVisual(c, v?.body ?? '', { actor: u, exclude, brandOnly: !!opts.redraw, notTemplate: opts.redraw ? vis?.template ?? null : null, bodyIds });
  // 요청 C: 처음 그릴 때 카드뉴스 장·도표형 카드도 함께 · 다시 그리기는 표지만(장은 그대로) — 표지 1장뿐이던 예전 글은 다시 그릴 때 장도 붙임
  const after = opts.redraw && (v?.media_ids?.length ?? 0) > 1 ? { ids: [] as string[], note: '', pages: null } : await pagesAfterCover(c, v?.body ?? '', opts.redraw ? 1 : 1 + d.bodyIds.length, { actor: u });
  const r = await attachVisual(c, d.fileId, `${opts.redraw ? '시안 다시 그리기' : '시안 그리기'}(서버·크레딧 0) — ${u.name}${d.templateLabel ? ` · 틀: ${d.templateLabel}` : ''}${d.photoTitle ? ` · 사진: ${d.photoTitle}` : ' · 브랜드 색 바탕'}${d.bodyTitle && !opts.redraw ? ` · 본문 사진: ${d.bodyTitle}` : ''}${after.note}`, u.id, d.photoId, !!opts.redraw, opts.redraw ? after.ids : [...d.bodyIds, ...after.ids], { template: d.template, photoIds: d.photoIds, pages: after.pages });
  if (!r) throw badRequest('그사이 콘텐츠가 바뀌었습니다 — 새로 고쳐 다시');
  await audit(sql, u.id, opts.redraw ? 'mkt.visual_redraw' : 'mkt.visual_now', 'mkt_content', id, { version: r.version, photoId: d.photoId }).catch(() => {});
  return { version: r.version, status: r.status, fileId: d.fileId, photo: d.photoTitle, template: d.templateLabel };
}
