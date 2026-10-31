import { db } from './db';
import { audit } from './log';
import { assertSpace } from './spaces';
import { isAdmin } from './access';
import { badRequest, forbidden, notFound } from './errors';
import { tenantOf, type SessionUser } from './types';
import { brandAliases, contactLine, factsOf, otherBrandNames, otherBrands } from './mktQuality';
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
export async function actorOf(c: Pick<Content, 'tenant' | 'created_by'>): Promise<SessionUser | null> {
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
export function textGraphic(r: { title: string; file_name?: string | null; folder: string; tags?: string[] | null; vision?: unknown; source?: string | null }) {
  if (markedNoText(r.tags)) return false;
  if (r.source === 'video_frame') return visionOk(r.vision) && visionGraphic(r.vision); // 188차: 영상 장면 사진은 영상 이름·태그(릴스·쇼츠…)가 아니라 AI 설명으로만 판정
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
/** 269차 #807 ①(대표 10/29 '바탕 사진에 이미 글이 있으면 그 위에 글을 얹지 말 것'): 사진 AI 설명이 글자를 봤으면(적게라도)·홍보물·실사 아님 → '시안 바탕' 폴더에 있어도 바탕으로 안 씀.
 *  사람이 단 태그 '글자없음'만 그 판정보다 먼저(사람이 보고 고른 것) */
const visionSawText = (v: unknown) => visionOk(v) && (v.text !== 'none' || v.promo || v.kind !== 'photo');
export const backdropOk = (r: { title?: string; file_name?: string | null; folder: string; tags?: string[] | null; vision?: unknown; source?: string | null }) => !markedText(r.tags) && !markedSkip(r.tags)
  && (markedNoText(r.tags) || ((r.folder ?? '').startsWith('마케팅/시안 바탕') && !visionSawText(r.vision)) || (visionOk(r.vision) && visionBackdrop(r.vision) && !textGraphic({ title: r.title ?? '', file_name: r.file_name, folder: r.folder, tags: r.tags, vision: r.vision, source: r.source })));
/** 쓸 사진 고르기: 글자 든 그래픽은 빼고 · 같은 브랜드(제목·폴더·태그·설명에 이름) +6 · 실사(현장·사진) +2 · 제목(주제) 낱말 +2씩(6까지)·본문 낱말 +1씩(4까지) · 누운 사람·뒷모습·어두운 사진은 바탕에서 뺌(171차) · 다른 브랜드 이름 −10 · 최근 30일 다른 게시에 쓴 사진 −4 · exclude = 이 글에 이미 써 본 사진 */
async function pickPhoto(c: Content, brand: string, others: string[], text: string, exclude: Set<string> = new Set(), mode: 'cover' | 'body' = 'cover') {
  return (await rankPhotos(c, brand, others, text, exclude, mode))[0] ?? null;
}
type PoolRow = { id: string; title: string; file_name: string; description: string | null; folder: string; tags: string[]; vision: unknown; space: string; source: string | null;
  /** 288차: 영상 장면 사진의 원본 영상 이름·폴더·태그(장면 사진은 폴더가 '마케팅/영상 장면'이라 브랜드 폴더를 원본에서 봄) */ parent?: string | null };
/**
 * 288차 #814-2(대표 10/31 "브랜드 사진 폴더 밖 사진은 못 쓰게 · 워크인은 앱 화면 녹화·캡처만"): 브랜드 키트 '시안 사진'(video.photoSource)
 * · brand(기본) = 브랜드가 둘 이상인 회사는 이 브랜드 이름(다른 표기 포함)이 폴더·파일 이름·태그·설명·AI 설명(영상 장면은 원본 영상)에 든 사진만 — 이름 없는 사진·다른 브랜드 사진은 안 씀
 * · screen = 실사는 안 씀 — 표지·카드 장은 브랜드 색·휴대폰/노트북 틀, 블로그 본문은 이 브랜드 앱 화면 캡처(자료실 '영상 화면 캡처'·AI 가 화면으로 본 사진)
 * · any = 예전처럼 이름 없는 사진도 씀(다른 브랜드 이름이 든 사진은 그래도 크게 뒤로)
 */
export type PhotoSource = 'brand' | 'screen' | 'scenes' | 'any';
export const PHOTO_SOURCES: PhotoSource[] = ['brand', 'screen', 'scenes', 'any'];
/** 293차 #834(대표 10/31 '하이링크는 플랫폼인데 왜 현장사진이 — 들어가더라도 입장하는 장면이나 컴퓨터로 업무보는 장면 정도'): 'scenes' = 앱 화면 캡처 + 이 장면의 실사만
 *  — AI 사진 설명(한 줄·장면·태그·읽힌 글자)이 출입·입장·얼굴 인식 단말 또는 컴퓨터·휴대폰·태블릿으로 업무·앱을 쓰는 장면일 때 */
const ALLOWED_SCENE = /(출입|입장|들어가|들어서|게이트|출입문|개찰|얼굴\s*인식|안면\s*인식|키오스크|단말기|태블릿|컴퓨터|노트북|모니터|데스크톱|휴대폰|스마트폰|핸드폰|앱\s*화면|키보드|타이핑|업무를\s*보)/;
export const sceneOk = (r: { vision?: unknown }) => visionOk(r.vision) && ALLOWED_SCENE.test(visionText(r.vision));
export type PhotoRule = { own: string[]; src: PhotoSource; strict: boolean };
export async function photoRule(tenant: string, brandId: string | null | undefined): Promise<PhotoRule> {
  if (!brandId) return { own: [], src: 'any', strict: false };
  const rows = await db()<{ id: string; name: string; facts: unknown; feed: unknown; video: any }[]>`select id, name, facts, feed, video from mkt_brands where tenant = ${tenant}`;
  const me = rows.find((r) => r.id === brandId);
  const src: PhotoSource = PHOTO_SOURCES.includes(me?.video?.photoSource) ? me!.video.photoSource : 'brand';
  const own = me ? brandAliases(me, { site: false }) : [];
  return { own, src, strict: rows.length >= 2 && src !== 'any' && own.length > 0 };
}
/** 앱 화면 캡처 — 자료실 '영상 화면 캡처' 폴더(하위·상위 폴더 이름 포함) 또는 AI 가 화면 캡처로 본 사진 */
export const isCapture = (r: { folder?: string | null; vision?: unknown }) => /(^|\/)영상 화면 캡처(\/|$)/.test(r.folder ?? '') || (visionOk(r.vision) && r.vision.kind === 'screen');
/** 사진 쪽 글(이름·폴더·태그·설명·AI 설명·원본 영상)에 이름이 있는지 */
export const photoHas = (r: { title: string; folder: string; tags?: string[] | null; description?: string | null; vision?: unknown; parent?: string | null }, name: string) =>
  !!name && `${r.title} ${r.folder} ${(r.tags ?? []).join(' ')} ${r.description ?? ''} ${visionText(r.vision)} ${r.parent ?? ''}`.toLowerCase().includes(name.toLowerCase());
/** 188차: 사진 후보(자료실 전체 — mktPhotos.poolCond, 마케팅 공간 먼저·최근 순 400장) + 최근 30일 다른 글에 쓴 사진(표지·4분할·장 사진·붙은 미디어) — 한 글을 그리는 동안 한 번만 읽음 */
/** gen = 회사 설정 '사진이 모자라면 실사 참고로 생성'(282차 #818 ② — 켠 회사만 관련 없는 사진 대신 빈 칸 → 생성) */
export type Pool = { rows: PoolRow[]; used: Set<string>; gen?: boolean; rule?: PhotoRule };
async function loadPool(c: Pick<Content, 'tenant' | 'id' | 'brand_id'>): Promise<Pool> {
  const sql = db(); const { poolCond } = await import('./mktPhotos');
  const rows = await sql<PoolRow[]>`select id, coalesce(nullif(title, ''), file_name) as title, file_name, description, folder, tags, vision, space, source,
      case when source = 'video_frame' then (select concat_ws(' ', coalesce(nullif(pv.title, ''), pv.file_name), pv.folder, array_to_string(pv.tags, ' ')) from library_files pv where pv.id::text = library_files.meta->'video'->>'id' and pv.tenant = library_files.tenant) end as parent
    from library_files where ${poolCond(sql, c.tenant)} order by (space = 'marketing') desc, created_at desc limit 400`;
  const used = new Set((await sql<{ id: string }[]>`select distinct u.x as id from mkt_contents k join mkt_versions v on v.content_id = k.id and v.version = k.current_version
    cross join lateral unnest(coalesce(v.media_ids::text[], '{}') || array[k.quality->'visual'->>'photoId']
      || array(select jsonb_array_elements_text(case when jsonb_typeof(k.quality->'visual'->'photoIds') = 'array' then k.quality->'visual'->'photoIds' else '[]'::jsonb end))
      || array(select pg->>'photoId' from jsonb_array_elements(case when jsonb_typeof(k.quality->'pages') = 'array' then k.quality->'pages' else '[]'::jsonb end) pg)) as u(x)
    where k.tenant = ${c.tenant} and k.id <> ${c.id} and k.status <> 'canceled' and coalesce(k.scheduled_at, k.created_at) > now() - interval '30 days' and u.x is not null`).map((r) => r.id));
  const [st] = await sql<{ photo_gen: boolean | null; auto_pause: boolean | null }[]>`select photo_gen, auto_pause from mkt_settings where tenant = ${c.tenant}`.catch(() => []);
  return { rows, used, gen: !!st?.photo_gen && !st?.auto_pause, rule: await photoRule(c.tenant, c.brand_id) };
}
export type VisualContent = Content;
/** 189차 실사 참고 생성의 참고 사진 후보 — 같은 브랜드 실사(바탕 규칙 통과 · AI 설명이 실사·홍보물 아님·얼굴 안 보임·화질 괜찮음 · 생성 사진 제외), 글과 맞는 순.
 *  가까운 글에 쓴 사진도 참고로는 씀(결과는 새 사진). 브랜드 없는 글이면 브랜드 이름 조건 없음 */
export async function refPhotos(c: Content, text: string, pool?: Pool): Promise<{ id: string; title: string; caption: string }[]> {
  const [b] = c.brand_id ? await db()<{ name: string }[]>`select name from mkt_brands where id = ${c.brand_id}` : [];
  const brand = (b?.name ?? '').replace(/^\s*\[시험\]\s*/, '').trim();
  const others = otherBrandNames(await otherBrands(c.tenant, c.brand_id, { site: false })).filter((n) => n !== brand);
  const p = pool ?? (await loadPool(c));
  const byId = new Map(p.rows.map((r) => [r.id, r]));
  return (await rankPhotos(c, brand, others, text, new Set(), 'cover', { ...p, gen: false })).filter((r) => { // 참고 사진은 문구 관련성 거르기 없이(같은 브랜드 실사 결만 참고)
    const row = byId.get(r.id); const v = row?.vision as { kind?: string; faces?: boolean; promo?: boolean; quality?: string } | undefined;
    return !!row && row.source !== 'ai_ref' && visionOk(row.vision) && v?.kind === 'photo' && !v.faces && !v.promo && v.quality !== 'poor' && (r.brand || !brand);
  }).map((r) => ({ id: r.id, title: r.title, caption: String((byId.get(r.id)!.vision as { caption?: string }).caption ?? '') }));
}
export const photoPool = (c: Pick<Content, 'tenant' | 'id' | 'brand_id'>) => loadPool(c);
/** #544 사진 순위(점수 높은 순, 같은 점수면 최근 사진) — 피드 틀의 사진 4분할은 앞의 4장 · pool = 미리 읽은 후보(장마다 다시 읽지 않게) */
async function rankPhotos(c: Content, brand: string, others: string[], text: string, exclude: Set<string> = new Set(), mode: 'cover' | 'body' = 'cover', pool?: Pool) {
  const { outsideOk, blurryPhoto } = await import('./mktPhotos');
  const { rows, used, gen, rule } = pool ?? (await loadPool(c));
  if (!rows.length) return [];
  const own = rule?.own.length ? rule.own : brand ? [brand] : []; // 288차: 이 브랜드 이름 + 다른 표기(DAGYM 등)
  // 171차(로컬 10/26 평가 ⓒ '다짐 스토리 표지 사진이 주제와 안 맞음'): 제목(주제) 낱말은 +2씩 6까지(앞부분이 같으면 — 러닝머신 ↔ 러닝머신으로), 본문 낱말은 +1씩 4까지
  //  → 같은 브랜드 사진끼리는 주제에 맞는 사진이 앞섬. 브랜드 이름 자체는 세지 않음(브랜드 점수와 겹침)
  const brandWords = words([brand, ...others].join(' '));
  const want = new Set([...words(text)].filter((w) => !brandWords.has(w)));
  const wantTitle = [...words(c.title.replace(/^\s*\[시험\]\s*/, ''))].filter((w) => !brandWords.has(w));
  const titleHit = (w: string) => wantTitle.some((t) => t === w || (t.length >= 2 && w.length >= 2 && (t.startsWith(w) || w.startsWith(t))));
  // #235 ⓒ 사진 AI 설명(한 줄·장면·태그·읽히는 글자)도 브랜드·낱말 맞추기에 — 낱말 점수는 제한(설명이 긴 사진이 브랜드 사진을 앞지르지 않게) · 흐린 사진 −3
  const has = photoHas;
  const mine = (r: (typeof rows)[number]) => own.some((n) => has(r, n));
  const out: { id: string; title: string; score: number; k: number; vision: unknown; description: string | null; hit: number; brand: boolean; scene: boolean; gen: boolean }[] = []; // gen = 189차 실사 참고 생성 사진(source ai_ref) · hit = 180차 제목·본문 낱말이 맞은 수(0 = 글과 관련 없음) · brand = 181차 이 브랜드 이름이 사진에 있음 · scene = 188차 영상 장면 사진
  for (const [k, r] of rows.entries()) {
    if (exclude.has(r.id)) continue;
    // 바탕 = 고른 사진·AI 가 글자 없는 실사로 본 사진, 블로그 본문 = 글자 든 그래픽·'쓰지 않음'만 빼고 · 288차 '앱 화면 캡처만' 브랜드 = 바탕은 사진 없이, 본문은 화면 캡처만
    if (rule?.src === 'screen' ? mode === 'cover' || !isCapture(r) || markedSkip(r.tags) : mode === 'cover' ? !backdropOk(r) : !bodyOk(r)) {
      if (!(rule?.src === 'scenes' && mode === 'body' && isCapture(r) && !markedSkip(r.tags))) continue; // 293차 앱 화면 + 허용 장면: 화면 캡처는 블로그 본문에
    }
    if (rule?.src === 'scenes' && !isCapture(r) && !sceneOk(r)) continue; // 실사는 출입·업무 장면만
    if (rule?.strict && !mine(r)) continue; // 288차: 브랜드가 둘 이상이면 이 브랜드 이름이 든 사진만
    if (r.space !== 'marketing' && !outsideOk(r.vision)) continue; // 188차: 마케팅 공간 밖 사진은 AI 설명이 실사·홍보물 아님·얼굴 없음·화질 괜찮음일 때만
    const fl = photoFlags(r.vision); // 171차 ⓒ: 누운 사람·뒷모습·어두운 사진은 바탕(표지·장)에서 뺌, 블로그 본문에서는 뒤로
    if (mode === 'cover' && (fl.lying || fl.back || fl.dark)) continue;
    let score = mine(r) ? 6 : 0;
    if (mode === 'body') score -= (fl.lying ? 4 : 0) + (fl.back ? 2 : 0) + (fl.dark ? 3 : 0);
    if (others.some((o) => has(r, o))) score -= 10;
    else if (REAL.test(`${r.title} ${r.folder} ${(r.tags ?? []).join(' ')}`) || (visionOk(r.vision) && r.vision.kind === 'photo')) score += 2;
    let hitT = 0; let hitB = 0;
    for (const w of words(`${r.title} ${r.description ?? ''} ${(r.tags ?? []).join(' ')} ${visionText(r.vision)}`)) { if (brandWords.has(w)) continue; if (titleHit(w)) hitT++; else if (want.has(w)) hitB++; } // 188차: 사진 쪽 브랜드 이름도 안 셈('카드브랜드' 사진이 '카드 찍고…' 장과 앞글자로 맞던 것)
    score += Math.min(6, hitT * 2) + Math.min(4, hitB);
    if (blurryPhoto(r.vision)) continue; // 282차 #818(대표 "흔들리거나 초점이 안맞음에도 그대로"): 흔들림·초점 나감·화질 나쁨은 아예 안 씀(예전 −3점)
    if (mode === 'body' && visionOk(r.vision) && r.vision.text === 'much') score -= 2; // 로컬 10/25: 안내판 글자가 많은 실사는 본문에 쓰되 뒤로
    if (used.has(r.id)) score -= 4;
    if (r.source === 'ai_ref') score -= 3; // 189차: 실사 참고로 생성한 사진은 실사가 다 쓰였을 때만(같은 점수면 실사가 먼저)
    if (score > -5) out.push({ id: r.id, title: r.title, score, k, vision: r.vision, description: r.description, hit: hitT + hitB, brand: mine(r), scene: r.source === 'video_frame', gen: r.source === 'ai_ref' });
  }
  // 282차 #818 ②(대표 "사진이 문구와 전혀 관련이 없거나 … 실사를 바탕으로 다시 제작하거나 새로 만들어서"): 사진 생성을 켠 회사는 제목·본문 낱말이 사진 이름·설명·태그에
  //  하나도 안 맞는 사진(브랜드만 같음)은 안 씀 → 빈 칸은 실사 참고 생성이 채움. 끈 회사는 예전처럼(#685 '모든 장 실사' — 관련 높은 사진이 앞)
  return (gen ? out.filter((o) => o.hit > 0 || o.gen) : out).sort((a, b) => b.score - a.score || a.k - b.k); // 같은 점수면 최근 사진(목록 순서)
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
/** 286차 #818 ④(대표 "사람 얼굴은 되도록 모자이크 필요"): 블로그 본문은 원본 파일을 그대로 붙이므로 — AI 설명이 얼굴 자리를 알려 준 사진은
 *  얼굴을 모자이크한 사본(자료실 '마케팅/자동 시안', source mosaic, meta.of = 원본 · 같은 원본이면 다시 씀)을 붙임. 원본은 그대로, 사본은 사진 고르기·설명에서 빠짐 */
async function faceSafeIds(tenant: string, ids: string[], actor: SessionUser): Promise<string[]> {
  if (!ids.length) return ids;
  const sql = db(); const P = await import('./mktPhotos');
  const rows = await sql<{ id: string; title: string; file_name: string; storage_key: string | null; vision: unknown }[]>`select id::text, coalesce(nullif(title, ''), file_name) as title, file_name, storage_key, vision
    from library_files where id = any(${ids}::uuid[]) and tenant = ${tenant}`;
  const out: string[] = [];
  for (const id of ids) {
    const r = rows.find((x) => x.id === id); const faces = r ? P.facesToHide(r.vision) : [];
    if (!r?.storage_key || !faces.length) { out.push(id); continue; }
    const [have] = await sql<{ id: string }[]>`select id::text from library_files where tenant = ${tenant} and source = 'mosaic' and meta->>'of' = ${id} and deleted_at is null and upload_status = 'ready' limit 1`;
    if (have) { out.push(have.id); continue; }
    try {
      const data = await P.mosaicFaces(await (await import('./storage')).getObject(r.storage_key), faces);
      const { saveGeneratedFile } = await import('./library');
      const f = await saveGeneratedFile(actor, { fileName: `${r.file_name.replace(/\.[a-z0-9]{2,5}$/i, '')}_얼굴가림.jpg`, mime: 'image/jpeg', data, title: `${r.title} — 얼굴 가림`, folder: '마케팅/자동 시안',
        tags: ['얼굴 가림', '자동 시안'], description: '얼굴 자리를 모자이크한 사본(원본은 그대로)', source: 'mosaic', space: 'marketing', meta: { of: id } } as never);
      out.push(f.id);
    } catch { out.push(id); } // 사본을 못 만들면 예전처럼 원본(실패로 글을 막지 않음)
  }
  return out;
}
export async function blogPhotoCandidates(c: Content, text: string, n = 20): Promise<BlogPhoto[]> {
  const [b] = c.brand_id ? await db()<{ name: string }[]>`select name from mkt_brands where id = ${c.brand_id}` : [];
  const brand = (b?.name ?? '').replace(/^\s*\[시험\]\s*/, '').trim();
  const others = otherBrandNames(await otherBrands(c.tenant, c.brand_id, { site: false })).filter((x) => x !== brand);
  const one = (x: string) => x.replace(/\s+/g, ' ').trim();
  const near = await nearUsed(c).catch(() => new Set<string>()); // 188차: 가까운 글(같은 브랜드 12개·다른 브랜드 앞뒤 2일)에 쓴 사진은 후보에서 뺌
  return (await rankPhotos(c, brand, others, text, near, 'body')).slice(0, n).map((r) => {
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
  // 188차(대표 #695 '겹치지 않게'): 같은 브랜드에서 게시 시각이 가까운 12개 글 + 다른 브랜드 앞뒤 2일 글에 쓴 사진은 표지·본문 사진으로 안 씀
  const near = await nearUsed(c);
  const { enhancePhoto, fixText } = await import('./mktPhotoFix');
  let png: Buffer; let photoId: string | null = null; let photo: { title: string } | null = null; let template: import('./mktFeedTemplates').TemplateId | null = null; let photoIds: string[] = [];
  let photoFix: string[] = []; let scene = false; let gen = false; // 188차 #621 시안 기록: 표지 사진에 한 보정 · 영상 장면 사진인지 · 189차 실사 참고 생성 사진인지
  if (kit.templates.length) {
    const r = await drawTemplated(c, body, { kit, brand, others, head, sub, H, logo: logo?.data ?? null, font: fontData, opts, near });
    ({ png, template, photoIds, photoFix, scene, gen } = r); photoId = photoIds[0] ?? null; photo = r.photoTitle ? { title: r.photoTitle } : null;
  } else {
    // photoId = 그 바탕 사진 그대로(#545 글만 고친 수정본 — 같은 사진에 새 첫 줄, null = 브랜드 색 바탕)
    const top = opts.photoId !== undefined || opts.brandOnly ? null : await pickPhoto(c, brand, others, `${c.title} ${body}`, new Set([...(opts.exclude ?? []), ...near]));
    photoId = opts.photoId !== undefined ? opts.photoId : top?.id ?? null;
    const p = await libBytes(c.tenant, photoId, /^image\//).catch(() => null); photo = p;
    const fx = p ? await enhancePhoto(p.data, { w: 1080, h: H }) : null; // 188차: 중요 부분 기준 자르기 + 밝기·대비·확대(한 것만 기록)
    const src = !top && photoId ? await sourceOf(photoId) : null;
    photoFix = fx?.fixes ?? []; scene = top ? top.scene : src === 'video_frame'; gen = top ? top.gen : src === 'ai_ref';
    png = await D.drawSlide({ kind: 'cover', title: head, body: sub, rows: [], imagePlan: '', imageId: photoId }, 0, 1,
      { template: p ? 'box' : 'bold', color: kit.from ? kit.bg : null, brand, keyword: '', logo: logo?.data ?? null, font: fontData, height: H }, fx?.data ?? null);
  }
  const jpg = await D.toJpeg(png);
  const actor = opts.actor ?? (await actorOf(c));
  if (!actor) throw badRequest('자료실에 저장할 사람이 없습니다(활성 계정 없음)');
  const { saveGeneratedFile } = await import('./library');
  const safe = c.title.replace(/^\s*\[시험\]\s*/, '').replace(/[\\/:*?"<>|\n]+/g, ' ').trim().slice(0, 50) || '자동 시안';
  const label = template ? F.FEED_TEMPLATES[template].label : null;
  const f = await saveGeneratedFile(actor, { fileName: `${safe}_${story ? '스토리' : blog ? '블로그 표지' : '피드'}.jpg`, mime: 'image/jpeg', data: jpg, title: `${safe} — 자동 시안`, folder: '마케팅/자동 시안',
    tags: ['자동 시안', ...(brand ? [brand] : [])], description: `서버 그리기(크레딧 0)${label ? ` · 틀: ${label}` : ''} · ${photo ? `사진: ${photo.title}${scene ? '(영상 장면)' : ''}${gen ? '(AI 생성·실사 참고)' : ''}${photoFix.length ? `(보정: ${fixText(photoFix)})` : ''}` : '사진 없음 — 브랜드 색 바탕'}`, source: 'ai', space: 'marketing', meta: { contentId: c.id, photoId, kind: story ? 'story' : blog ? 'blog' : 'feed', ...(template ? { template } : {}), ...(photoFix.length ? { fix: photoFix } : {}) } });
  // 블로그 본문 사진: 원고가 고른 사진들(bodyIds) — 없으면 표지에 쓴 것과 다른 실사 1장(같은 규칙 — 글자 든 그래픽·다른 브랜드·가까운 글에 쓴 사진 빼고)
  const picked = given ?? (blog ? [(await pickPhoto(c, brand, others, `${c.title} ${body}`, new Set([...(opts.exclude ?? []), ...near, ...(photoId ? [photoId] : [])]), 'body'))?.id].filter((x): x is string => !!x) : []);
  const bodyIds = await faceSafeIds(c.tenant, picked, actor); // 286차 #818 ④: 얼굴 자리를 아는 본문 사진은 모자이크한 사본으로
  const [bp] = bodyIds.length ? await sql<{ title: string }[]>`select coalesce(nullif(title, ''), file_name) as title from library_files where id = ${bodyIds[0]}` : [];
  return { fileId: f.id, photoId, photoTitle: photo?.title ?? null, bodyId: bodyIds[0] ?? null, bodyIds, bodyTitle: bp ? `${bp.title}${bodyIds.length > 1 ? ` 외 ${bodyIds.length - 1}장` : ''}` : null, template, templateLabel: label, photoIds, photoFix, scene, gen };
}
/**
 * 188차 #621(대표 10/25 '시안 기록에 어떤 사진·왜·보정 내용'): 콘텐츠 상세의 '사진 기록' — 표지·카드뉴스 장·블로그 본문마다 쓴 사진(자료실 이름·폴더·공간)·고른 까닭·보정.
 * quality.visual(표지 photoId·photoIds·fix·scene·bodyIds) + quality.pages(장 photoId·rel·fix·scene)에서 만들고, 사진 이름은 자료실에서(지워진 사진도 이름은 보임). 서버가 그린 시안이 아니면 null
 */
export type PhotoRecordRow = { where: string; id: string | null; title: string | null; folder: string | null; space: string | null; scene: boolean; gen: boolean; why: string; fix: string[] };
export async function photoRecord(tenant: string, q: any): Promise<PhotoRecordRow[] | null> {
  const vis = q?.visual;
  if (!vis || vis.by !== 'server') return null;
  const pages: CardPage[] = Array.isArray(q.pages) ? q.pages : [];
  const coverIds: string[] = Array.isArray(vis.photoIds) && vis.photoIds.length ? vis.photoIds : vis.photoId ? [vis.photoId] : [];
  const bodyIds: string[] = Array.isArray(vis.bodyIds) ? vis.bodyIds.map(String) : [];
  const refs = [vis.ref, ...pages.map((p) => p.ref)].filter((x): x is string => typeof x === 'string'); // 189차 생성 사진의 참고 실사
  const ids = [...new Set([...coverIds, ...pages.map((p) => p.photoId).filter((x): x is string => !!x), ...bodyIds, ...refs])].filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const info = new Map((ids.length ? await db()<{ id: string; title: string; folder: string; space: string; source: string | null }[]>`select id::text, coalesce(nullif(title, ''), file_name) as title, folder, space, source
    from library_files where id = any(${ids}::uuid[]) and tenant = ${tenant}` : []).map((r) => [r.id, r]));
  const row = (where: string, id: string | null, why: string, fix: string[] = [], scene = false): PhotoRecordRow => {
    const f = id ? info.get(id) : undefined;
    return { where, id, title: f?.title ?? null, folder: f?.folder ?? null, space: f?.space ?? null, scene: scene || f?.source === 'video_frame', gen: f?.source === 'ai_ref', why, fix };
  };
  const genWhy = (ref?: string | null) => `실사가 모자라 생성 — 참고 실사: ${(ref && info.get(ref)?.title) || '같은 브랜드 사진'}`;
  const out: PhotoRecordRow[] = [];
  if (!coverIds.length) out.push(row('표지', null, vis.template ? '사진 없는 틀(브랜드 색)' : '맞는 바탕 사진이 없어 브랜드 색 바탕'));
  coverIds.forEach((id, k) => out.push(row(coverIds.length > 1 ? `표지 사진 ${k + 1}` : '표지', id, k === 0 && vis.gen && vis.ref ? genWhy(vis.ref) : info.get(id)?.source === 'ai_ref' ? '실사가 다 쓰여 전에 생성한 사진(실사 참고)' : '표지 바탕(글자 없는 실사 · 제목 낱말·브랜드가 맞는 사진부터)', k === 0 ? (vis.fix ?? []) : [], k === 0 && !!vis.scene)));
  pages.forEach((p, k) => out.push(p.photoId ? row(`${k + 2}장`, p.photoId, p.gen && p.ref ? genWhy(p.ref) : info.get(p.photoId)?.source === 'ai_ref' ? '실사가 다 쓰여 전에 생성한 사진(실사 참고)' : p.rel === 'weak' ? '관련 약함 — 글과 낱말이 맞는 사진이 없어 브랜드 사진으로 채움' : '그 장 글과 낱말이 맞는 사진', p.fix ?? [], !!p.scene)
    : row(`${k + 2}장`, null, p.role === 'cta' ? '행동 장 — 글자만(연락처·저장 권유)' : '쓸 실사가 남지 않아 브랜드 색 바탕')));
  bodyIds.forEach((id, k) => { const f = info.get(id); if (f && f.source !== 'ai') out.push(row(`본문 사진 ${k + 1}`, id, '블로그 본문 — 원고가 장면 순서로 고른 실사')); });
  return out;
}
/** 사진 한 장의 출처(영상 장면 사진인지) */
async function sourceOf(id: string) {
  const [r] = await db()<{ source: string | null }[]>`select source from library_files where id = ${id}`;
  return r?.source ?? null;
}
/** 188차 #621 시안 기록: quality.visual 에 덧붙일 표지 사진 보정·영상 장면 표시 */
export const coverMark = (d: { photoFix?: string[]; scene?: boolean; gen?: boolean }) => ({ ...(d.photoFix?.length ? { fix: d.photoFix } : {}), ...(d.scene ? { scene: true } : {}), ...(d.gen ? { gen: true } : {}) });

/**
 * 요청 C §3-1(대표 10/25 22:20 #644, 결정 15-11): 피드 = 카드뉴스 3~5장(표지 → 문제 → 해결 → 근거 → 행동) · 스토리 = 3~5프레임(질문 → 답 → 행동).
 * 표지 뒤 장은 원고 AI 의 slides/frames 로, 없으면(예전 글·형식 깨짐) 본문 줄로 만든다. 모두 서버가 브랜드 색 바탕(행동 장은 검정)으로 그림 — 크레딧 0
 */
export type CardPage = { role: 'problem' | 'solution' | 'proof' | 'cta' | 'frame'; title: string; body: string; photoId?: string | null; rel?: 'weak'; pool?: number; fix?: string[]; scene?: boolean; gen?: boolean; ref?: string | null }; // photoId = 171차 그 장에 깐 실사(없으면 색 바탕) · rel 'weak' = 180차 글과 낱말이 안 맞는 사진(관련 약함) · pool = 고를 때 쓸 수 있던 실사 후보 수 · fix = 188차 보정(밝기·대비·확대·선명) · scene = 188차 영상 장면 사진
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
/** 171차(로컬 10/26 평가 ⓑ '본문 장이 전부 브랜드색 단색+글자'): 실사를 깔 장 — 172차 절반까지 →
 *  188차(대표 #695 '되도록 모든 화면에 실사'): 행동 장(카드뉴스 cta·스토리 마지막 행동 프레임 — 글자만 장)을 뺀 모든 장. 사진이 모자라면 있는 만큼(나머지는 색 바탕) */
export function photoSlots(pages: CardPage[], story = false): number[] {
  // 181차(로컬 10/26 14:00 ⓐ): 스토리 마지막 프레임은 행동 프레임(원고 규칙 = 문의·저장·프로필) — 카드뉴스 cta 장처럼 사진을 안 깖
  return pages.map((p, k) => (p.role === 'cta' || (story && k === pages.length - 1) ? -1 : k)).filter((k) => k >= 0);
}
/** 장 노트 — 실사를 깐 장 수 · 180차(로컬 10/26 13:25 ①): 고를 때 쓸 수 있던 후보 수(표지·가까운 글 사진 제외 뒤)와 글과 낱말이 안 맞는 '관련 약함' 장 수도 — 실사가 적은 게 사진 풀 부족인지 바로 보이게 */
export const photoNote = (pages: CardPage[] | null | undefined) => {
  const ps = pages ?? []; const k = ps.filter((p) => p.photoId && !p.gen).length; const weak = ps.filter((p) => p.photoId && !p.gen && p.rel === 'weak').length;
  const gens = ps.filter((p) => p.photoId && p.gen).length; // 189차: 실사 참고로 생성한 사진 장은 실사와 따로 셈
  const pools = ps.map((p) => p.pool).filter((n): n is number => typeof n === 'number');
  // 188차: 영상 장면 사진·보정(밝기·대비·확대) 장 수도 — 0 이면 안 붙임
  const scenes = ps.filter((p) => p.photoId && p.scene).length; const fixed = ps.filter((p) => p.photoId && p.fix?.length).length;
  if (!k && !gens && !pools.length) return '';
  return `(실사 ${k}장${gens ? ` · 생성 ${gens}장` : ''}${pools.length ? ` · 후보 ${Math.max(...pools)}장` : ''}${weak ? ` · 관련 약함 ${weak}장` : ''}${scenes ? ` · 영상 장면 ${scenes}장` : ''}${fixed ? ` · 보정 ${fixed}장` : ''})`;
};
/** 표지 뒤 장들을 그려 자료실(마케팅/자동 시안)에 저장 → 파일 id(표지 다음 순서). 피드 1080×1350 · 스토리 1080×1920(위·아래 안전 영역 — 아래 답장 칸은 비움)
 *  171차 ⓑ: photoSlots 장에는 그 장 글과 맞는 실사(바탕 규칙 — 글자 없는 실사, 누운 사람·뒷모습·어두움 제외)를 깔고 글은 흰색(아래 그늘)·제목은 브랜드 색 상자.
 *  표지 사진(opts.exclude)·같은 브랜드 가까운 글(nearPosts)의 표지·장 사진은 안 씀. 쓴 사진은 page.photoId 에 적어 quality.pages 로 저장됨(다음 글에서 빼는 데 씀) */
export async function drawPages(c: Content, pages: CardPage[], opts: { actor?: SessionUser | null; exclude?: Set<string>; keep?: boolean; refill?: boolean } = {}): Promise<string[]> {
  if (!pages.length) return [];
  const { brand, logo, font, color, D } = await brandDraw(c);
  const story = c.kind === 'story'; const H = story ? 1920 : 1350;
  const actor = opts.actor ?? (await actorOf(c));
  if (!actor) throw badRequest('자료실에 저장할 사람이 없습니다(활성 계정 없음)');
  const { saveGeneratedFile } = await import('./library'); const { libBytes } = await import('./mktVideo');
  for (const p of pages) { delete p.fix; if (!opts.keep && !opts.refill) { delete p.photoId; delete p.rel; delete p.pool; delete p.scene; delete p.gen; delete p.ref; } } // 다시 그릴 때 예전 장의 사진 표시는 지우고 새로 고름 — keep(189차 생성 사진 채우기)은 장마다 정해 둔 사진 그대로
  // 287차 refill = 사진이 남은 장은 그대로 두고 사진을 뺀 장(흔들린 사진)만 새로 고름 — 남은 장 사진은 다시 안 씀
  const slots = photoSlots(pages, c.kind === 'story').filter((k) => !opts.refill || !pages[k].photoId);
  const { enhancePhoto, fixText } = await import('./mktPhotoFix');
  if (slots.length && !opts.keep) {
    const others = otherBrandNames(await otherBrands(c.tenant, c.brand_id, { site: false })).filter((n) => n !== brand);
    const exclude = new Set([...(opts.exclude ?? []), ...(await nearUsed(c)), ...(opts.refill ? pages.map((p) => p.photoId).filter((x): x is string => !!x) : [])]); // 188차: 같은 브랜드 가까운 12개 글 + 다른 브랜드 앞뒤 2일 글의 사진 빼기
    const cand = await loadPool(c);
    // 180차(로컬 10/26 13:25 ①: 하이링크 스토리 5번째 장에 글('흐름은 프로필에서')과 관련 없는 GX룸 사진 · 다짐 피드 실사 1장이 사진 풀 부족 탓인지 노트로는 알 수 없음):
    //  장마다 후보 순위를 먼저 매기고 ① 글과 낱말이 맞는 사진(hit>0)이 있는 장부터 — 가장 잘 맞는 장이 먼저 가져감(순서대로 집으면 앞 장이 뒤 장의 '얼굴 등록' 사진을 가져감)
    //  ② 남은 장은 브랜드 실사 아무거나 깔되 rel 'weak'(관련 약함) 표시 · pool = 고를 때 쓸 수 있던 후보 수(표지·가까운 글 사진 제외 뒤) → 노트 '후보 m장'. 쓸 사진이 더 없으면 나머지 장은 색 바탕
    //  181차(로컬 10/26 14:00 ⓑ: 브랜드 이름 없는 GX룸 사진이 다짐 피드·하이링크 스토리 양쪽에 쓰임): ②(아무거나)는 이 브랜드 이름이 있는 사진만 — 브랜드 미지정 사진은 글과 낱말이 맞을 때(①)만 쓰고, 후보 수도 그 둘만 셈
    const ranked = new Map<number, Awaited<ReturnType<typeof rankPhotos>>>();
    for (const k of slots) ranked.set(k, await rankPhotos({ ...c, title: pages[k].title }, brand, others, `${pages[k].title} ${pages[k].body} ${c.title}`, exclude, 'cover', cand));
    const usable = (r: { id: string; hit: number; brand: boolean }, fit: boolean) => !exclude.has(r.id) && (fit ? r.hit > 0 : r.brand);
    const pool = Math.max(0, ...[...ranked.values()].map((r) => r.filter((x) => x.brand || x.hit > 0).length));
    for (const k of slots) pages[k].pool = pool;
    const best = (k: number) => ranked.get(k)?.find((r) => usable(r, true))?.hit ?? 0;
    const take = (k: number, fit: boolean) => {
      const top = ranked.get(k)?.find((r) => usable(r, fit));
      if (!top) return;
      pages[k].photoId = top.id; if (!fit) pages[k].rel = 'weak'; if (top.scene) pages[k].scene = true; if (top.gen) pages[k].gen = true; exclude.add(top.id);
    };
    for (const k of [...slots].sort((a, b) => best(b) - best(a) || a - b)) if (best(k) > 0) take(k, true);
    for (const k of slots) if (!pages[k].photoId) take(k, false);
  }
  const safe = safeTitle(c); const n = pages.length + 1; const ids: string[] = [];
  for (const [k, p] of pages.entries()) {
    const photo = p.photoId ? await libBytes(c.tenant, p.photoId, /^image\//).catch(() => null) : null;
    if (p.photoId && !photo) { delete p.photoId; delete p.rel; delete p.scene; delete p.gen; delete p.ref; } // 파일을 못 읽으면 색 바탕
    const fx = photo ? await enhancePhoto(photo.data, { w: 1080, h: H }) : null; // 188차: 중요 부분 기준 자르기 + 밝기·대비·확대(한 것만 p.fix)
    if (fx?.fixes.length) p.fix = fx.fixes;
    const png = await D.drawSlide({ kind: p.role === 'cta' ? 'cta' : 'body', title: p.title, body: p.body, rows: [], imagePlan: '', imageId: p.photoId ?? null }, k + 1, n, { template: 'bold', color, brand, keyword: '', logo, font, height: H }, fx?.data ?? null);
    const f = await saveGeneratedFile(actor, { fileName: `${safe}_${story ? '스토리' : '피드'} ${k + 2}of${n}.jpg`, mime: 'image/jpeg', data: await D.toJpeg(png), title: `${safe} — ${story ? '프레임' : '카드'} ${k + 2}/${n}`, folder: '마케팅/자동 시안',
      tags: ['자동 시안', ...(brand ? [brand] : [])], description: `서버 그리기(크레딧 0) · ${story ? '스토리 프레임' : '카드뉴스'} ${k + 2}/${n}${p.role === 'cta' ? ' · 행동 장' : ''}${photo ? ` · 사진: ${photo.title}${p.scene ? '(영상 장면)' : ''}${p.gen ? '(AI 생성·실사 참고)' : ''}${p.fix?.length ? `(보정: ${fixText(p.fix)})` : ''}` : ''}`, source: 'ai', space: 'marketing', meta: { contentId: c.id, page: k + 2, of: n, role: p.role, kind: story ? 'story' : 'feed', photoId: p.photoId ?? null, ...(p.fix?.length ? { fix: p.fix } : {}) } });
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
/**
 * 188차(대표 #695 '겹치지 않게'): 이 글과 겹치면 안 되는 사진 — 같은 브랜드에서 게시 시각이 가까운 12개 글 + 다른 브랜드 글 중 게시 시각이 앞뒤 2일 안인 글이 쓴 사진
 * (표지·4분할·카드뉴스 장 사진 + 붙은 미디어 = 블로그 본문 사진·사람이 붙인 사진). 취소·휴지통 글은 뺌. 12개는 시안·사진이 붙은 글만 셈(빈 정기 칸·릴스 대기 글이 자리를 차지하지 않게), 브랜드 없는 글끼리도 한 묶음. 예전엔 같은 브랜드 서버 시안 5개 글만 봄(nearPosts — 틀 돌리기에는 그대로 씀)
 */
export async function nearUsed(c: Pick<Content, 'id' | 'tenant' | 'brand_id'>): Promise<Set<string>> {
  const sql = db();
  const [me] = await sql<{ at: Date }[]>`select coalesce(scheduled_at, created_at, now()) as at from mkt_contents where id = ${c.id}`;
  const at = me?.at ?? new Date();
  const rows = await sql<{ ids: string[] | null }[]>`select array(select u.x from unnest(coalesce(v.media_ids::text[], '{}') || array[k.quality->'visual'->>'photoId']
        || array(select jsonb_array_elements_text(case when jsonb_typeof(k.quality->'visual'->'photoIds') = 'array' then k.quality->'visual'->'photoIds' else '[]'::jsonb end))
        || array(select pg->>'photoId' from jsonb_array_elements(case when jsonb_typeof(k.quality->'pages') = 'array' then k.quality->'pages' else '[]'::jsonb end) pg)) as u(x) where u.x is not null) as ids
    from mkt_contents k left join mkt_versions v on v.content_id = k.id and v.version = k.current_version
    where k.id in ((select m.id from mkt_contents m join mkt_versions mv on mv.content_id = m.id and mv.version = m.current_version
        where m.tenant = ${c.tenant} and m.brand_id is not distinct from ${c.brand_id} and m.id <> ${c.id} and m.status <> 'canceled' and cardinality(mv.media_ids) > 0
        order by abs(extract(epoch from (coalesce(m.scheduled_at, m.created_at) - ${at}::timestamptz))) limit 12)
      union (select id from mkt_contents where tenant = ${c.tenant} and id <> ${c.id} and status <> 'canceled' and brand_id is distinct from ${c.brand_id}
        and abs(extract(epoch from (coalesce(scheduled_at, created_at) - ${at}::timestamptz))) <= 172800))`;
  return new Set(rows.flatMap((r) => r.ids ?? []));
}
/** #262(대표 10/25 ④ 노트북 목업 틀): 자료실 '영상 화면 캡처'를 읽어 세로(휴대폰 틀)·가로(노트북 틀) 캡처로 나눔 — 다른 브랜드 이름이 든 캡처는 빼고 이 브랜드 이름이 든 것 먼저, 최근 8장까지(가로·세로는 파일을 열어야 앎) */
type Shot = { id: string; title: string; data: Buffer };
async function screenShots(tenant: string, brand: string, others: string[], rule?: PhotoRule): Promise<{ any: Shot[]; tall: Shot[]; wide: Shot[] }> {
  const { libBytes, videoAssets } = await import('./mktVideo');
  const has = (r: { title: string; folder: string; tags?: string[] | null; description?: string | null }, n: string) => !!n && `${r.title} ${r.folder} ${(r.tags ?? []).join(' ')} ${r.description ?? ''}`.toLowerCase().includes(n.toLowerCase());
  const mine = (r: Parameters<typeof has>[0]) => (rule?.own.length ? rule.own : [brand]).some((n) => has(r, n));
  const rows = (await videoAssets(tenant, '영상 화면 캡처')).filter((r) => !others.some((o) => has(r, o)) && (!rule?.strict || mine(r))).sort((x, y) => Number(mine(y)) - Number(mine(x))).slice(0, 8); // 288차: 브랜드가 둘 이상이면 이 브랜드 이름이 든 캡처만
  const sharp = (await import('sharp')).default;
  const out = { any: [] as Shot[], tall: [] as Shot[], wide: [] as Shot[] };
  for (const r of rows) {
    const f = await libBytes(tenant, r.id, /^image\//).catch(() => null); if (!f) continue;
    const m = await sharp(f.data).metadata().catch(() => null); const [w, hh] = (m?.orientation ?? 1) >= 5 ? [m?.height ?? 0, m?.width ?? 0] : [m?.width ?? 0, m?.height ?? 0];
    const sh: Shot = { id: r.id, title: r.title, data: f.data };
    out.any.push(sh); if (w && hh && w / hh >= 1.2) out.wide.push(sh); else if (w && hh && w / hh <= 0.8) out.tall.push(sh);
  }
  return out;
}
/** #544 피드 틀로 그리기: 같은 브랜드에서 게시 시각이 가까운 5개 글의 틀·사진은 빼고(요청 C §3-2 연속 같은 표지 금지) → 칸(AI card·글)·사진·화면 캡처로 쓸 수 있는 틀 중 덜 쓴 것 */
async function drawTemplated(c: Content, body: string, a: { kit: import('./mktFeedTemplates').Kit; brand: string; others: string[]; head: string; sub: string; H: number; logo: Buffer | null; font: Buffer | null; opts: DrawOpts; near: Set<string> }) {
  const sql = db(); const F = await import('./mktFeedTemplates'); const { libBytes } = await import('./mktVideo');
  const [me] = await sql<{ card: any }[]>`select quality->'card' as card from mkt_contents where id = ${c.id}`;
  const near = await nearPosts(c);
  const usage = Object.fromEntries((c.brand_id ? await sql<{ t: string; n: number }[]>`select t, count(*)::int as n from (select quality->'visual'->>'template' as t from mkt_contents
    where tenant = ${c.tenant} and brand_id = ${c.brand_id} and id <> ${c.id} and quality->'visual'->>'template' is not null order by coalesce(scheduled_at, created_at) desc limit 15) x group by t` : []).map((r) => [r.t, r.n]));
  // 사진: 가까운 3개 글에 쓴 사진·이 글에 써 본 사진은 빼고(글만 고친 수정본은 쓰던 사진 그대로)
  const keep = a.opts.photoIds?.length ? a.opts.photoIds : a.opts.photoId ? [a.opts.photoId] : null;
  const exclude = new Set([...(a.opts.exclude ?? []), ...near.flatMap((r) => r.ps), ...a.near]); // 188차: 가까운 글(같은 브랜드 12개·다른 브랜드 앞뒤 2일) 사진도
  const ranked: { id: string; title: string; scene?: boolean; gen?: boolean }[] = keep ? (await sql<{ id: string; title: string; scene: boolean; gen: boolean }[]>`select id::text, coalesce(nullif(title, ''), file_name) as title, coalesce(source, '') = 'video_frame' as scene, coalesce(source, '') = 'ai_ref' as gen from library_files where id = any(${keep}::uuid[]) and tenant = ${c.tenant} and deleted_at is null`)
      .sort((x, y) => keep.indexOf(x.id) - keep.indexOf(y.id))
    : a.opts.photoId === null ? [] : await rankPhotos(c, a.brand, a.others, `${c.title} ${body}`, exclude);
  // #262(대표 10/25 ④ 노트북 목업 틀): 화면 캡처를 세로(휴대폰 틀)·가로(노트북 틀)로 나눠 읽음 — 그 틀을 골랐을 때만
  const shots = a.kit.templates.includes('phone') || a.kit.templates.includes('laptop') ? await screenShots(c.tenant, a.brand, a.others, await photoRule(c.tenant, c.brand_id)) : { any: [], tall: [], wide: [] };
  const hints = F.hintsOf({ head: a.head, sub: a.sub, title: c.title, body, card: c.card ?? me?.card ?? null, kit: a.kit });
  const pool = a.kit.templates.filter((t) => F.eligible(t, hints, { photo: ranked.length > 0, photos: ranked.length, screen: shots.any.length > 0, screenWide: shots.wide.length > 0 }));
  const template = F.chooseTemplate(pool, { near: near.map((r) => r.t), usage, seed: `${c.id}:${c.current_version}`, prefer: a.opts.template, avoid: a.opts.notTemplate }) ?? 'title'; // 쓸 수 있는 틀이 없으면 제목형(키트 색)
  const need = F.FEED_TEMPLATES[template].need as string | null;
  const pick = need === 'photo' ? ranked.slice(0, 1) : need === 'photos4' ? ranked.slice(0, 4) : [];
  // 188차: 사진 틀은 칸(1080×H) 크기로 중요 부분 기준 자르기 + 보정, 4분할은 색만 보정(칸이 작아 자르기는 틀이 함)
  const { enhancePhoto } = await import('./mktPhotoFix');
  const files = (await Promise.all(pick.map(async (p) => {
    const raw = await libBytes(c.tenant, p.id, /^image\//).catch(() => null);
    const fx = raw ? await enhancePhoto(raw.data, need === 'photo' ? { w: 1080, h: a.H } : undefined) : null;
    return { p, f: raw && fx ? { ...raw, data: fx.data } : null, fixes: fx?.fixes ?? [] };
  }))).filter((x) => x.f);
  const screen = need === 'screen' ? shots.tall[0] ?? shots.any[0] ?? null : null; // 휴대폰 틀은 세로 캡처 먼저
  const screenWide = need === 'screen_wide' ? shots.wide[0] ?? null : null;
  const set = F.EVENT_SETS[F.hash(c.id) % F.EVENT_SETS.length];
  const png = await F.renderFeed({ t: template, kit: a.kit, brand: a.brand, H: a.H, h: hints, photo: files[0]?.f?.data ?? null, photos: files.map((x) => ({ data: x.f!.data, label: F.labelOf(x.p.title) })), screen: screen?.data ?? null, screenWide: screenWide?.data ?? null, logo: a.logo, font: a.font, set });
  return { png, template, photoIds: files.map((x) => x.p.id), photoTitle: files[0]?.p.title ?? null, photoFix: [...new Set(files.flatMap((x) => x.fixes))], scene: files.some((x) => !!x.p.scene), gen: files.some((x) => !!x.p.gen) };
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
/** 287차: tail = 다시 그리기에서도 뒤쪽(블로그 본문 사진·장)을 extra 로 바꿈 · keep = 표지는 그대로(표지 기록 유지, 뒤쪽만 바꾼 새 버전) · body = 바뀐 원고('[사진 n]' 줄) */
async function attachVisual(c: Content, fileId: string, note: string, actorId: string | null, photoId: string | null = null, replace = false, extra: string[] = [], more: { template?: string | null; photoIds?: string[]; pages?: CardPage[] | null; photoFix?: string[]; scene?: boolean; gen?: boolean; tail?: boolean; keep?: boolean; body?: string } = {}) {
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
    const media = [fileId, ...(replace && prevTail.length && !more.tail ? prevTail : extra)]; // 다시 그리기: 블로그 본문 사진·카드뉴스 장은 그대로 — 표지 1장뿐이던 예전 글은 요청 C 장(extra)을 함께 붙임
    // 요청 C §3-3: 사진 수 규칙(피드 3~5장·스토리 3~5프레임·블로그 표지+3장)에 못 미치면 승인함에 못 올림 — 채워지면 그 줄을 지움
    const rule = M.mediaRule(c.channel, c.kind, media.length, !!c.auto);
    const issues = [...((q.issues ?? []) as string[]).filter((x) => !VISUAL_ISSUE.test(x) && !M.MEDIA_RULES.includes(x)), ...(rule ? [rule] : [])];
    const onlyVisual = q.passed === false && (q.issues ?? []).length > 0 && !issues.length;
    const status = rule && ['pending', 'changes'].includes(cur.status) ? 'changes' : cur.status === 'changes' && onlyVisual ? 'pending' : cur.status;
    const kept: Record<string, unknown> = { ...(q.visual ?? {}) }; delete kept.bodyIds;
    const visual = more.keep ? { ...kept, at: new Date().toISOString(), rv: 5, ...(media.length > 1 ? { bodyIds: media.slice(1) } : {}) }
      : { by: 'server', fileId, at: new Date().toISOString(), photoId, rv: 3, tried, ...(media.length > 1 ? { bodyIds: media.slice(1) } : {}), ...(more.template ? { template: more.template } : {}), ...((more.photoIds?.length ?? 0) > 1 ? { photoIds: more.photoIds } : {}), ...coverMark(more) };
    const quality = { ...q, issues, ...(onlyVisual ? { passed: true } : rule ? { passed: false } : {}), ...(q.report ? { report: { ...q.report, v } } : {}), ...(more.pages?.length ? { pages: more.pages } : {}), visual };
    await tx`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, ${v}, ${more.body ?? prev?.body ?? ''}, ${media}, ${note}, ${actorId})`;
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
      const r = await attachVisual(c, d.fileId, `시안 자동 그리기(서버·크레딧 0)${d.templateLabel ? ` — 틀: ${d.templateLabel}` : ''}${d.photoTitle ? ` — 사진: ${d.photoTitle}` : ' — 브랜드 색 바탕'}${d.bodyTitle ? ` · 본문 사진: ${d.bodyTitle}` : c.channel === 'blog' && !after.ids.length ? ' · 본문 사진 없음(실사를 붙여 주세요)' : ''}${after.note}`, c.created_by, d.photoId, false, [...d.bodyIds, ...after.ids], { template: d.template, photoIds: d.photoIds, pages: after.pages, photoFix: d.photoFix, scene: d.scene, gen: d.gen });
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
/**
 * 287차 #818(대표 "승인 대기 게시물들의 사진이 … 흔들리거나 초점이 안맞음에도 그대로"): 사진 중 흔들림·초점 나감인 것(넘겨준 id 그대로 돌려줌).
 * 얼굴 가림 사본은 원본 설명으로 봄 · 서버가 그린 그림(source ai — 도표형 카드 등)은 안 봄 · 선명도를 아직 안 잰 사진은 여기서 재서 원본 설명에 남김
 * (예전엔 정기 실행 mktSharp 를 기다렸음 — 마케팅 사진 범위 밖 사진은 영영 안 재질 수 있어 그 자리에서 잼, AI 호출 없음)
 */
/** 바꿀 까닭 — blur 흔들림·초점 · brand 브랜드 규칙 밖 · dup 같은 글 안 중복·가까운 글과 겹침 · topic 그 자리 글과 낱말이 하나도 안 맞음(289차 수정 요청 '문구와 사진 불일치') */
type Reason = 'blur' | 'brand' | 'dup' | 'topic';
type Bad = Map<string, Reason>;
/** 289차: 사진 쪽 글(이름·설명·태그·AI 설명·원본 영상)과 그 자리 글이 낱말 하나라도 맞는지 — 앞부분이 같으면 맞음('러닝머신이' ↔ '러닝머신'), 브랜드 이름은 안 셈 */
function topicHit(photo: string, text: string, skip: Set<string>) {
  const want = [...words(text)].filter((w) => !skip.has(w));
  return [...words(photo)].some((w) => !skip.has(w) && want.some((t) => t === w || (t.length >= 2 && w.length >= 2 && (t.startsWith(w) || w.startsWith(t)))));
}
/** 288차 #814-2(로컬 14:30: 워크인 블로그 본문에 다짐 현장 사진 — 온도조절기·조명 스위치): 흔들림에 더해 브랜드 키트 '시안 사진' 규칙 밖 사진(브랜드 이름 없는 사진·'앱 화면 캡처만'인데 실사)도 'brand' 로 */
async function badPhotosOf(tenant: string, ids: (string | null | undefined)[], rule: PhotoRule, o: { topic?: Map<string, string> } = {}): Promise<Bad> {
  const want = [...new Set(ids.filter((x): x is string => !!x && /^[0-9a-f-]{36}$/i.test(x)))];
  if (!want.length) return new Map();
  const sql = db(); const P = await import('./mktPhotos');
  const rows = await sql<{ id: string; vid: string; key: string | null; vision: any; title: string; folder: string; tags: string[] | null; description: string | null; parent: string | null }[]>`select f.id::text, coalesce(o.id, f.id)::text as vid,
      coalesce(o.storage_key, f.storage_key) as key, coalesce(o.vision, f.vision) as vision, coalesce(nullif(coalesce(o.title, f.title), ''), coalesce(o.file_name, f.file_name)) as title,
      coalesce(o.folder, f.folder) as folder, coalesce(o.tags, f.tags) as tags, coalesce(o.description, f.description) as description,
      case when coalesce(o.source, f.source) = 'video_frame' then (select concat_ws(' ', coalesce(nullif(pv.title, ''), pv.file_name), pv.folder, array_to_string(pv.tags, ' ')) from library_files pv
        where pv.id::text = coalesce(o.meta, f.meta)->'video'->>'id' and pv.tenant = f.tenant) end as parent
    from library_files f left join library_files o on f.source = 'mosaic' and o.tenant = f.tenant and o.id::text = f.meta->>'of'
    where f.tenant = ${tenant} and f.id = any(${want}::uuid[]) and f.source is distinct from 'ai'`;
  const out: Bad = new Map();
  for (const r of rows) {
    if (rule.src === 'screen' ? !isCapture(r) : (rule.strict && !rule.own.some((n) => photoHas(r, n))) || (rule.src === 'scenes' && !isCapture(r) && !sceneOk(r))) { out.set(r.id, 'brand'); continue; }
    let v = r.vision;
    if (visionOk(v) && typeof v.sharp !== 'number' && r.key) {
      let st: { max: number; med: number } | null = null;
      try { st = await P.sharpnessStats(await (await import('./storage')).getObject(r.key)); } catch { st = null; }
      const add = { sharp: st?.max ?? -1, sharpMed: st?.med ?? -1 };
      await sql`update library_files set vision = vision || ${sql.json(add as never)}::jsonb where id = ${r.vid}`;
      v = { ...v, ...add };
    }
    if (P.blurryPhoto(v)) out.set(r.id, 'blur');
    else if (o.topic?.has(r.id) && !topicHit(`${r.title} ${r.description ?? ''} ${(r.tags ?? []).join(' ')} ${visionText(v)} ${r.parent ?? ''}`, o.topic.get(r.id)!, words(rule.own.join(' ')))) out.set(r.id, 'topic');
  }
  return out;
}
/**
 * 287차: 뒤쪽 사진 중 흔들린 것만 바꿈(글 내용은 그대로) — null = 바꿀 것 없음
 * · 블로그 본문: 그 '[사진 n]' 줄 앞뒤 글과 맞는 다른 실사(얼굴 가림 사본 규칙 그대로)로 바꾸고 줄 설명도 새 사진 설명으로. 맞는 사진이 없으면 그 줄·사진을 빼고 번호를 당김(자동 글은 도표형 카드로 채움)
 * · 카드뉴스 장·스토리 프레임: 흔들린 장만 사진을 다시 고르고(남은 장 사진은 그대로) 장을 새로 그림. 장 수가 다르면(사람이 바꾼 장) 손대지 않음
 */
export type TailFix = { ids: string[]; body?: string; pages: CardPage[] | null; why: Partial<Record<Reason, number>> };
const tally = (rs: (Reason | undefined)[]) => rs.reduce<Partial<Record<Reason, number>>>((a, r) => (r ? { ...a, [r]: (a[r] ?? 0) + 1 } : a), {});
/** 바꾼 까닭 한 줄 — '흔들린·초점 나간 본문 사진 1장 · 브랜드 밖 본문 사진 2장' */
export const tailWhy = (why: Partial<Record<Reason, number>>, where: string) => [why.blur ? `흔들린·초점 나간 ${where} 사진 ${why.blur}장` : '', why.brand ? `브랜드 밖 ${where} 사진 ${why.brand}장` : '',
  why.dup ? `겹치는 ${where} 사진 ${why.dup}장` : '', why.topic ? `글과 안 맞는 ${where} 사진 ${why.topic}장` : ''].filter(Boolean).join(' · ');
async function freshTail(c: Content & { quality?: any }, v: { body: string; media_ids: string[] }, bad: Bad, exclude: Set<string>): Promise<TailFix | null> {
  const tail = (v.media_ids ?? []).slice(1).map(String);
  if (c.channel === 'blog') {
    if (!tail.some((id) => bad.has(id))) return null;
    const sql = db(); const { PHOTO_LINE } = await import('./mktText');
    const [b] = c.brand_id ? await sql<{ name: string }[]>`select name from mkt_brands where id = ${c.brand_id}` : [];
    const brand = (b?.name ?? '').replace(/^\s*\[시험\]\s*/, '').trim();
    const others = otherBrandNames(await otherBrands(c.tenant, c.brand_id, { site: false })).filter((x) => x !== brand);
    const orig = (await sql<{ of: string }[]>`select meta->>'of' as of from library_files where id = any(${tail}::uuid[]) and source = 'mosaic'`).map((r) => r.of);
    const used = new Set([...exclude, ...tail, ...orig, ...(await nearUsed(c).catch(() => new Set<string>()))]);
    const lines = v.body.split('\n');
    const lineOf = (n: number) => lines.findIndex((l) => { const m = l.trim().match(PHOTO_LINE); return !!m && !m[1] && Number(m[2]) === n; });
    const actor = await actorOf(c);
    const ids: string[] = []; const drop = new Set<number>();
    for (const [k, id] of tail.entries()) {
      if (!bad.has(id)) { ids.push(id); continue; }
      const li = lineOf(k + 1); // 본문 사진 k번째 = '[사진 k+1]' 줄(원고가 고른 순서) — 줄이 없던 예전 글은 글 전체로 고름
      const around = li >= 0 ? lines.slice(Math.max(0, li - 3), li + 4).join(' ') : v.body;
      const top = actor ? (await rankPhotos(c, brand, others, `${c.title} ${around}`, used, 'body'))[0] : undefined;
      if (!top || !actor) { if (li >= 0) drop.add(li); continue; }
      used.add(top.id);
      ids.push((await faceSafeIds(c.tenant, [top.id], actor))[0]);
      if (li >= 0) lines[li] = `[사진 ${k + 1}] ${cutAt((visionOk(top.vision) ? top.vision.caption : '') || top.description || top.title.replace(/\.[a-z0-9]{2,5}$/i, ''), 60).replace(/\s+/g, ' ')}`.trim();
    }
    let no = 0;
    const body = lines.flatMap((l, i) => {
      if (drop.has(i)) return [];
      if (!drop.size) return [l];
      const m = l.trim().match(PHOTO_LINE); return m && !m[1] ? [`[사진 ${++no}] ${m[3] ?? ''}`.trim()] : [l];
    }).join('\n').replace(/\n{3,}/g, '\n\n');
    const fill = ids.length < tail.length ? await pagesAfterCover(c, body, 1 + ids.length, { exclude: used }) : { ids: [] as string[] };
    return { ids: [...ids, ...fill.ids], body: body === v.body ? undefined : body, pages: null, why: tally(tail.map((id) => bad.get(id))) };
  }
  if (c.kind !== 'feed' && c.kind !== 'story') return null;
  const pages: CardPage[] = Array.isArray(c.quality?.pages) ? structuredClone(c.quality.pages) : [];
  const hit = pages.filter((p) => p.photoId && bad.has(p.photoId));
  if (!hit.length || tail.length !== pages.length) return null;
  const why = tally(hit.map((p) => bad.get(p.photoId!)));
  for (const p of hit) { delete p.photoId; delete p.rel; delete p.scene; delete p.gen; delete p.ref; }
  const ids = await drawPages(c, pages, { exclude, refill: true });
  return { ids, pages, why };
}
/** 사진 자리마다 그 자리 글 — 블로그 본문 사진 k번째 = '[사진 k+1]' 줄 앞뒤 3줄(줄이 없으면 제목+글), 카드 장 = 그 장 제목·글 */
async function slotTexts(c: Content & { quality?: any }, body: string, tail: string[], pages: CardPage[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (c.channel === 'blog') {
    const { PHOTO_LINE } = await import('./mktText'); const lines = body.split('\n');
    tail.forEach((id, k) => { const li = lines.findIndex((l) => { const x = l.trim().match(PHOTO_LINE); return !!x && !x[1] && Number(x[2]) === k + 1; }); m.set(id, li >= 0 ? lines.slice(Math.max(0, li - 3), li + 4).join(' ') : `${c.title} ${body}`); });
  } else for (const p of pages) if (p.photoId) m.set(p.photoId, `${p.title} ${p.body}`);
  return m;
}
/**
 * 289차 #814-2(대표 수정 요청 '다른 브랜드 사진·흔들림·중복·문구와 사진 불일치'): 수정본에서 뒤쪽 사진(블로그 본문·카드 장)도 같이 바꿈 —
 * 흔들림·브랜드 규칙 밖·같은 글 안 중복·가까운 글과 겹침, topic 이면 그 자리 글과 낱말이 안 맞는 사진까지. exclude = 표지에 쓴 사진. null = 바꿀 것 없음
 */
export async function fixTail(c: Content & { quality?: any }, v: { body: string; media_ids: string[] }, exclude: Set<string>, o: { topic?: boolean } = {}): Promise<TailFix | null> {
  const rule = await photoRule(c.tenant, c.brand_id);
  const pages: CardPage[] = Array.isArray(c.quality?.pages) ? c.quality.pages : [];
  const tail = (v.media_ids ?? []).slice(1).map(String);
  const ids = c.channel === 'blog' ? tail : pages.map((p) => p.photoId ?? null);
  const bad = await badPhotosOf(c.tenant, ids, rule, o.topic ? { topic: await slotTexts(c, v.body, tail, pages) } : {});
  const near = await nearUsed(c).catch(() => new Set<string>()); const seen = new Set(exclude);
  const real = new Set((await db()<{ id: string }[]>`select id::text from library_files where id = any(${ids.filter((x): x is string => !!x)}::uuid[]) and source is distinct from 'ai'`).map((r) => r.id)); // 서버가 그린 도표형 카드는 겹침을 안 셈
  for (const id of ids) { if (!id || bad.has(id) || !real.has(id)) continue; if (seen.has(id) || near.has(id)) bad.set(id, 'dup'); else seen.add(id); }
  return bad.size ? freshTail(c, v, bad, exclude) : null;
}
export type PhotoAudit = { total: number; blur: number; brand: number; dup: number; topic: number; faces: number; plain: boolean };
/** 289차 수정본 확인용 — 이 버전에 쓴 사진(표지·4분할 칸·블로그 본문·카드 장)을 흔들림·브랜드 밖·겹침·글과 안 맞음·얼굴 위치 모름(못 가림)·표지 사진 없음으로 셈(AI 호출 없음) */
export async function photoAudit(c: Content & { quality?: any }, media: string[], visual: any, pages: CardPage[] | null, body: string): Promise<PhotoAudit> {
  const rule = await photoRule(c.tenant, c.brand_id);
  const cover = [...new Set([visual?.photoId, ...(Array.isArray(visual?.photoIds) ? visual.photoIds : [])].filter((x): x is string => typeof x === 'string'))];
  const tail = media.slice(1).map(String); const ps = pages ?? [];
  const slots = c.channel === 'blog' ? tail : ps.map((p) => p.photoId).filter((x): x is string => !!x);
  const topic = await slotTexts(c, body, tail, ps); for (const id of cover) topic.set(id, `${c.title} ${body.slice(0, 400)}`);
  const all = [...cover, ...slots];
  const sql = db();
  const real = await sql<{ id: string; noboxes: boolean }[]>`select f.id::text, (coalesce(o.vision, f.vision)->>'faces' = 'true' and not (coalesce(o.vision, f.vision) ? 'faceBoxes') and f.source is distinct from 'mosaic') as noboxes
    from library_files f left join library_files o on f.source = 'mosaic' and o.tenant = f.tenant and o.id::text = f.meta->>'of' where f.tenant = ${c.tenant} and f.id = any(${all}::uuid[]) and f.source is distinct from 'ai'`;
  const ok = new Set(real.map((r) => r.id)); const list = all.filter((x) => ok.has(x));
  const bad = await badPhotosOf(c.tenant, list, rule, { topic });
  const near = await nearUsed(c).catch(() => new Set<string>()); const seen = new Set<string>(); let dup = 0;
  for (const id of list) { if (seen.has(id) || near.has(id)) dup++; seen.add(id); }
  const n = (r: Reason) => [...bad.values()].filter((x) => x === r).length;
  const template = typeof visual?.template === 'string' ? visual.template : '';
  return { total: new Set(list).size, blur: n('blur'), brand: n('brand'), dup, topic: n('topic'), faces: real.filter((r) => r.noboxes).length, plain: !cover.length && !['phone', 'laptop'].includes(template) };
}

export async function redrawTextVisuals(tenant: string, limit = 8, budgetMs = 15000) {
  const sql = db(); const t0 = Date.now();
  // rv 7 = 288차 브랜드 사진 규칙까지 검사를 끝낸 표시(6 = 287차 뒤쪽 사진 흔들림, 5 = 286차 표지만)
  const rows = await sql<(Content & { status: string; quality: any })[]>`select c.id, c.tenant, c.brand_id, c.title, c.channel, c.kind, c.created_by, c.is_test, c.current_version, c.status, c.quality, c.auto from mkt_contents c
    join mkt_versions v on v.content_id = c.id and v.version = c.current_version
    where c.tenant = ${tenant} and c.status in ('pending', 'changes') and c.quality->'visual'->>'by' = 'server' and coalesce(c.quality->'visual'->>'rv', '1')::int < 7
      and cardinality(v.media_ids) >= 1 and v.media_ids[1]::text = c.quality->'visual'->>'fileId'
      and (c.scheduled_at is null or c.scheduled_at > now() - interval '1 day')
      and not exists (select 1 from mkt_decisions d where d.content_id = c.id and d.version = c.current_version and d.decision in ('changes', 'hold'))
    order by c.scheduled_at nulls last limit ${limit}`;
  const out: { id: string; version?: number; kept?: boolean; error?: string }[] = [];
  const M = await import('./mktAuto');
  for (const c of rows) {
    if (Date.now() - t0 > budgetMs) break;
    try {
      const vis = c.quality.visual;
      const [f] = vis.photoId !== undefined ? [{ photo: (vis.photoId as string | null) }] : await sql<{ photo: string | null }[]>`select meta->>'photoId' as photo from library_files where id = ${vis.fileId}`;
      const photoId = f?.photo ?? null;
      const [p] = photoId ? await sql<{ title: string; file_name: string; folder: string; tags: string[]; vision: unknown }[]>`select coalesce(nullif(title, ''), file_name) as title, file_name, folder, tags, vision from library_files where id = ${photoId}` : [];
      // 282차 #818 ⑤: 바탕 사진(4분할 틀이면 네 칸 모두)이 흔들림·초점 나감이면 승인 대기 시안도 한 번 다시 그림(서버·크레딧 0)
      // 288차: 브랜드 키트 '시안 사진' 규칙 밖 바탕 사진(브랜드 이름 없음·'앱 화면 캡처만'인데 실사)도 다시 그림
      const quad = Array.isArray(vis.photoIds) ? (vis.photoIds as string[]).filter((x) => x !== photoId) : [];
      const rule = await photoRule(c.tenant, c.brand_id);
      const coverBad = [...(await badPhotosOf(c.tenant, [p ? photoId : null, ...quad], rule)).values()];
      const blur = coverBad.includes('blur'); const offBrand = coverBad.includes('brand');
      const [v] = await sql<{ body: string; media_ids: string[] }[]>`select body, media_ids from mkt_versions where content_id = ${c.id} and version = ${c.current_version}`;
      const tried = (vis.tried ?? []) as string[];
      const d = (!p || backdropOk(p)) && !coverBad.length ? null : await drawAutoVisual(c, v?.body ?? '', { exclude: new Set([...(photoId ? [photoId] : []), ...quad, ...tried]) });
      // 287차: 뒤쪽 사진(블로그 본문 사진·카드뉴스 장 사진) — 표지에 새로 쓴 사진은 장에 다시 안 씀
      const bad = v ? await badPhotosOf(c.tenant, c.channel === 'blog' ? (v.media_ids ?? []).slice(1).map(String) : ((c.quality.pages ?? []) as CardPage[]).map((x) => x.photoId), rule) : new Map() as Bad;
      const tail = bad.size && v ? await freshTail(c, v, bad, new Set([...(photoId ? [photoId] : []), ...quad, ...(d?.photoId ? [d.photoId] : []), ...(d?.photoIds ?? [])])) : null;
      if (!d && !tail) { // 브랜드 색 바탕·고른 사진·뒤쪽 사진 모두 괜찮음 → 표시만
        await sql`update mkt_contents set quality = jsonb_set(quality, '{visual}', (quality->'visual') || ${sql.json({ rv: 7, ...(photoId ? { photoId } : {}) } as never)}::jsonb) where id = ${c.id}`;
        if (Number(vis.rv ?? 1) < 3) out.push({ id: c.id, kept: true }); // 흔들림·브랜드 검사만 더한 것(3~6 → 7)은 따로 알리지 않음
        continue;
      }
      const where = c.channel === 'blog' ? '본문' : c.kind === 'story' ? '프레임' : '카드';
      const shook = tail ? ` · ${tailWhy(tail.why, where)} 바꿈` : '';
      let r: Awaited<ReturnType<typeof attachVisual>>;
      if (!d) r = await attachVisual(c, vis.fileId, `시안 사진 바꾸기(서버·크레딧 0) — 표지는 그대로${shook}`, c.created_by, photoId, true, tail!.ids, { pages: tail!.pages, tail: true, keep: true, body: tail!.body });
      else {
        const after = tail ? { ids: tail.ids, note: shook, pages: tail.pages } : (v?.media_ids?.length ?? 0) <= 1 ? await pagesAfterCover(c, v?.body ?? '', 1, { exclude: new Set([...(d.photoId ? [d.photoId] : []), ...d.photoIds]) }) : { ids: [] as string[], note: '', pages: null }; // 요청 C: 표지 1장뿐이던 예전 글은 장도 함께
        const q = { ...c.quality, visual: { ...vis, photoId } };
        await sql`update mkt_contents set quality = ${sql.json(q as never)} where id = ${c.id} and current_version = ${c.current_version}`;
        r = await attachVisual(c, d.fileId, `시안 다시 그리기(${blur ? '흔들린·초점 나간 바탕 사진 바꿈 · ' : ''}${offBrand ? '브랜드 밖 바탕 사진 바꿈 · ' : ''}바탕 = 브랜드 색 또는 고른 사진·서버·크레딧 0)${d.templateLabel ? ` — 틀: ${d.templateLabel}` : ''}${d.photoTitle ? ` — 사진: ${d.photoTitle}` : ' — 브랜드 색 바탕'}${after.note}`, c.created_by, d.photoId, true, after.ids, { template: d.template, photoIds: d.photoIds, pages: after.pages, photoFix: d.photoFix, scene: d.scene, gen: d.gen, tail: !!tail, body: tail?.body });
      }
      if (!r) continue;
      out.push({ id: c.id, version: r.version });
      // 로컬 08:15 (d): 다시 그린 알림은 같은 글에 한 번만
      if (r.status === 'pending') await M.mktNotify(sql, c, null, { approval: true, type: 'review_requested', title: `시안을 다시 그렸습니다(v${r.version}): ${c.title}`,
        body: blur || offBrand || tail ? `${blur || offBrand ? '바탕' : where} 사진이 ${(blur || tail?.why.blur) && (offBrand || tail?.why.brand) ? '흔들렸거나 이 브랜드 사진이 아니어서' : blur || tail?.why.blur ? '흔들렸거나 초점이 맞지 않아' : '이 브랜드 사진이 아니어서'} 다른 사진(또는 브랜드 색 바탕)으로 바꿨습니다 — 승인해 주세요` : '바탕 그림의 글자와 겹치던 시안을 브랜드 색 바탕(또는 고른 사진)으로 새로 그렸습니다 — 승인해 주세요',
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
  const sql = db(); const t = tenantOf(u); const F = await import('./mktFeedTemplates'); const D = await import('./mktCarouselDraw'); const { libBytes } = await import('./mktVideo');
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
  const shots = await screenShots(t, brand, others, await photoRule(t, id)); const screen = shots.tall[0] ?? shots.any[0] ?? null; const screenWide = shots.wide[0] ?? null; // #262 세로 = 휴대폰 틀 · 가로 = 노트북 틀
  const sharp = (await import('sharp')).default;
  const gray = await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#9CA3AF' } }).jpeg().toBuffer(); // 사진·화면 자리(예시)
  const grayWide = await sharp({ create: { width: 1366, height: 854, channels: 3, background: '#9CA3AF' } }).jpeg().toBuffer(); // #262 노트북 화면 자리(예시)
  const photos = files.length >= 4 ? files.map((x) => ({ data: x.f!.data, label: F.labelOf(x.p.title) })) : [...files.map((x) => ({ data: x.f!.data, label: F.labelOf(x.p.title) })), ...Array.from({ length: 4 - files.length }, () => ({ data: gray, label: '사진 자리' }))];
  const [lg, ft] = await Promise.all([libBytes(t, b.video?.logoFileId, /^image\//).catch(() => null), libBytes(t, b.video?.fontFileId, /font|\.(otf|ttf)$/i).catch(() => null)]);
  const list = i.all || !kit.templates.length ? F.TEMPLATE_IDS : kit.templates;
  const images = [];
  for (const [k, tp] of list.entries()) {
    const need = F.FEED_TEMPLATES[tp].need as string | null;
    const note = need === 'photo' && !files.length ? "회색 = 사진 자리 — 자료실 '마케팅/시안 바탕(글자 없는 사진)'에 사진을 올리면 이 틀을 씁니다"
      : need === 'photos4' && files.length < 4 ? `사진 ${files.length}장 — 시안 바탕 사진이 4장 이상일 때 이 틀을 씁니다` : need === 'screen' && !screen ? "회색 = 화면 자리 — 자료실 '영상 화면 캡처' 폴더에 화면 캡처를 올리면 이 틀을 씁니다" : need === 'screen_wide' && !screenWide ? "회색 = 화면 자리 — 자료실 '영상 화면 캡처' 폴더에 PC(가로) 화면 캡처를 올리면 이 틀을 씁니다"
        : need === 'points' && real.points.length < 3 ? '예시 글 — 글에 핵심이 3개 이상일 때 이 틀을 씁니다' : need === 'compare' && !(real.left && real.right) ? '예시 글 — 글이 두 가지를 견줄 때 이 틀을 씁니다'
          : need === 'prices' && real.prices.length < 2 ? '예시 금액 — 브랜드 키트 재료(주력 상품)에 금액이 2개 이상 있을 때 이 틀을 씁니다' : null;
    const png = await F.renderFeed({ t: tp, kit, brand, H: 1350, h, photo: photos[0].data, photos, screen: screen?.data ?? gray, screenWide: screenWide?.data ?? grayWide, logo: lg?.data ?? null, font: ft && /\.(otf|ttf)$/i.test(ft.name) ? ft.data : null, set: F.EVENT_SETS[k % F.EVENT_SETS.length] });
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
  const after = opts.redraw && (v?.media_ids?.length ?? 0) > 1 ? { ids: [] as string[], note: '', pages: null } : await pagesAfterCover(c, v?.body ?? '', opts.redraw ? 1 : 1 + d.bodyIds.length, { actor: u, exclude: new Set([...(d.photoId ? [d.photoId] : []), ...d.photoIds]) }); // 188차: 장에 표지 사진을 다시 쓰지 않게
  const r = await attachVisual(c, d.fileId, `${opts.redraw ? '시안 다시 그리기' : '시안 그리기'}(서버·크레딧 0) — ${u.name}${d.templateLabel ? ` · 틀: ${d.templateLabel}` : ''}${d.photoTitle ? ` · 사진: ${d.photoTitle}` : ' · 브랜드 색 바탕'}${d.bodyTitle && !opts.redraw ? ` · 본문 사진: ${d.bodyTitle}` : ''}${after.note}`, u.id, d.photoId, !!opts.redraw, opts.redraw ? after.ids : [...d.bodyIds, ...after.ids], { template: d.template, photoIds: d.photoIds, pages: after.pages, photoFix: d.photoFix, scene: d.scene, gen: d.gen });
  if (!r) throw badRequest('그사이 콘텐츠가 바뀌었습니다 — 새로 고쳐 다시');
  await audit(sql, u.id, opts.redraw ? 'mkt.visual_redraw' : 'mkt.visual_now', 'mkt_content', id, { version: r.version, photoId: d.photoId }).catch(() => {});
  return { version: r.version, status: r.status, fileId: d.fileId, photo: d.photoTitle, template: d.templateLabel };
}
