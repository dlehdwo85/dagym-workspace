import { db } from './db';
import { audit } from './log';
import { assertSpace } from './spaces';
import { badRequest, notFound } from './errors';
import { tenantOf, type SessionUser } from './types';

/**
 * #516 자동 제작 시안 = 우리 서버가 그림(외부 유료 생성 없음, 크레딧 0) — 대표 10/24 "승인 대기 시안이 안 보임".
 * 자료실 마케팅 실사 사진(그 브랜드 것 먼저, 다른 브랜드 사진은 빼고, 최근 30일에 쓴 사진은 뒤로) 위에
 * 첫 문장(훅)·제목을 카드뉴스 표지 틀(#499-5)로 — 피드·페이스북 1080×1350(4:5), 스토리 1080×1920(9:16, 위·아래 안전 영역).
 * 사진이 없으면 브랜드 색 바탕. 브랜드 키트 로고·글꼴을 씀. Higgsfield AI 이미지는 승인함 [AI 이미지로 다시](크레딧)로만.
 * 영상(릴스·쇼츠·영상)·블로그(표지+본문 실사)·스레드(글만 가능)는 그리지 않는다.
 */
const VIDEO_KINDS = ['reels', 'shorts', 'video'];
export const serverVisual = (c: { channel: string; kind?: string | null }) => (c.channel === 'instagram' || c.channel === 'facebook') && !VIDEO_KINDS.includes(c.kind ?? '');

type Content = { id: string; tenant: string; brand_id: string | null; title: string; channel: string; kind: string | null; created_by: string | null; is_test?: boolean | null; current_version: number };

/** 세션 없이(정기 실행) 자료실에 저장할 때 쓰는 사람 — 만든 사람, 막혔으면 회사 대표 */
async function actorOf(c: Pick<Content, 'tenant' | 'created_by'>): Promise<SessionUser | null> {
  const [r] = await db()<any[]>`select id, email, name, role, status, timezone, is_demo, platform_admin, tenant from users
    where tenant = ${c.tenant} and status = 'active' and (id = ${c.created_by ?? '00000000-0000-0000-0000-000000000000'} or role = 'owner') order by (id = ${c.created_by ?? '00000000-0000-0000-0000-000000000000'}) desc, created_at limit 1`;
  return r ? ({ id: r.id, email: r.email, name: r.name, role: r.role, status: r.status, timezone: r.timezone, sessionId: '', isDemo: r.is_demo, platformAdmin: r.platform_admin, tenant: r.tenant } as SessionUser) : null;
}

const words = (s: string) => new Set((s.match(/[\p{L}\p{N}]{2,}/gu) ?? []).map((w) => w.toLowerCase()));
/** 쓸 사진 고르기: 같은 브랜드(제목·폴더·태그·설명에 이름) +6 · 글과 겹치는 낱말 +1씩 · 다른 브랜드 이름 −10 · 최근 30일 다른 게시에 쓴 사진 −4 */
async function pickPhoto(c: Content, brand: string, others: string[], text: string) {
  const sql = db();
  const rows = await sql<{ id: string; title: string; description: string | null; folder: string; tags: string[] }[]>`select id, coalesce(nullif(title, ''), file_name) as title, description, folder, tags from library_files
    where tenant = ${c.tenant} and space = 'marketing' and deleted_at is null and upload_status = 'ready' and coalesce(security, 'internal') <> 'confidential'
      and mime_type in ('image/jpeg', 'image/png', 'image/webp') and coalesce(source, '') <> 'ai' order by created_at desc limit 200`;
  if (!rows.length) return null;
  const used = new Set((await sql<{ id: string }[]>`select distinct unnest(v.media_ids)::text as id from mkt_contents k join mkt_versions v on v.content_id = k.id and v.version = k.current_version
    where k.tenant = ${c.tenant} and k.id <> ${c.id} and k.status <> 'canceled' and coalesce(k.scheduled_at, k.created_at) > now() - interval '30 days'`).map((r) => r.id));
  const want = words(text);
  const has = (r: (typeof rows)[number], name: string) => !!name && `${r.title} ${r.folder} ${(r.tags ?? []).join(' ')} ${r.description ?? ''}`.toLowerCase().includes(name.toLowerCase());
  let best: { id: string; score: number } | null = null;
  for (const r of rows) {
    let score = has(r, brand) ? 6 : 0;
    if (others.some((o) => has(r, o))) score -= 10;
    for (const w of words(`${r.title} ${r.description ?? ''} ${(r.tags ?? []).join(' ')}`)) if (want.has(w)) score += 1;
    if (used.has(r.id)) score -= 4;
    if (!best || score > best.score) best = { id: r.id, score }; // 같은 점수면 최근 사진(목록 순서)
  }
  return best && best.score > -5 ? best.id : null;
}

const cutAt = (s: string, n: number) => { const a = [...s]; if (a.length <= n) return s; const t = a.slice(0, n).join(''); const k = t.lastIndexOf(' '); return `${(k > n * 0.6 ? t.slice(0, k) : t).trim()}…`; };
/** 그림 글자: 큰 글 = 본문 첫 문장(훅, 해시태그·이모지 줄 빼고), 길면 제목 / 작은 글 = 제목(큰 글과 다를 때) */
export function headlineOf(title: string, body: string) {
  const clean = (s: string) => s.replace(/#[^\s#]+/g, '').replace(/\s+/g, ' ').trim();
  const t = clean(title.replace(/^\s*\[시험\]\s*/, ''));
  const first = clean(body.split('\n').map((l) => l.trim()).find((l) => clean(l).length >= 4) ?? '');
  const head = first && [...first].length <= 42 ? first : t || cutAt(first, 40);
  return { head: cutAt(head, 44), sub: head === t || !t ? '' : cutAt(t, 40) };
}

/** 한 장 그려 자료실(마케팅/자동 시안)에 저장 → 파일 id */
export async function drawAutoVisual(c: Content, body: string, opts: { actor?: SessionUser | null } = {}) {
  const sql = db();
  const [b] = c.brand_id ? await sql<{ name: string; color: string | null; video: any }[]>`select name, color, video from mkt_brands where id = ${c.brand_id}` : [];
  const brand = (b?.name ?? '').replace(/^\s*\[시험\]\s*/, '').trim();
  const others = c.brand_id ? (await sql<{ name: string }[]>`select name from mkt_brands where tenant = ${c.tenant} and id <> ${c.brand_id}`).map((x) => x.name.replace(/^\s*\[시험\]\s*/, '').trim()).filter((n) => n && n !== brand) : [];
  const { head, sub } = headlineOf(c.title, body);
  const photoId = await pickPhoto(c, brand, others, `${c.title} ${body}`);
  const { libBytes } = await import('./mktVideo');
  const [photo, logo, font] = await Promise.all([libBytes(c.tenant, photoId, /^image\//).catch(() => null), libBytes(c.tenant, b?.video?.logoFileId, /^image\//).catch(() => null),
    libBytes(c.tenant, b?.video?.fontFileId, /font|\.(otf|ttf)$/i).catch(() => null)]);
  const D = await import('./mktCarouselDraw');
  const story = c.kind === 'story';
  const png = await D.drawSlide({ kind: 'cover', title: head, body: sub, rows: [], imagePlan: '', imageId: photoId }, 0, 1,
    { template: photo ? 'box' : 'bold', color: b?.color ?? null, brand, keyword: '', logo: logo?.data ?? null, font: font && /\.(otf|ttf)$/i.test(font.name) ? font.data : null, height: story ? 1920 : 1350 }, photo?.data ?? null);
  const jpg = await D.toJpeg(png);
  const actor = opts.actor ?? (await actorOf(c));
  if (!actor) throw badRequest('자료실에 저장할 사람이 없습니다(활성 계정 없음)');
  const { saveGeneratedFile } = await import('./library');
  const safe = c.title.replace(/^\s*\[시험\]\s*/, '').replace(/[\\/:*?"<>|\n]+/g, ' ').trim().slice(0, 50) || '자동 시안';
  const f = await saveGeneratedFile(actor, { fileName: `${safe}_${story ? '스토리' : '피드'}.jpg`, mime: 'image/jpeg', data: jpg, title: `${safe} — 자동 시안`, folder: '마케팅/자동 시안',
    tags: ['자동 시안', ...(brand ? [brand] : [])], description: `서버 그리기(크레딧 0) · ${photo ? `사진: ${photo.title}` : '사진 없음 — 브랜드 색 바탕'}`, source: 'ai', space: 'marketing', meta: { contentId: c.id, photoId, kind: story ? 'story' : 'feed' } });
  return { fileId: f.id, photoId, photoTitle: photo?.title ?? null };
}

/** 시안이 없어서 단 문제 줄(#516) — 시안을 붙이면 지운다 */
export const VISUAL_ISSUE = /^(시안 이미지 없음|영상 시안 제작 중)/;
/** 시안 붙여 새 버전(같은 글). 시안이 없어서만 막혀 있던 글(수정 요청 상태)은 승인 대기로, 열린 이미지 제작 요청은 '서버 그리기로 대체' */
async function attachVisual(c: Content, fileId: string, note: string, actorId: string | null) {
  const sql = db();
  return sql.begin(async (tx) => {
    const [cur] = await tx<any[]>`select id, current_version, status, quality from mkt_contents where id = ${c.id} for update`;
    if (!cur || cur.current_version !== c.current_version || ['published', 'canceled', 'approved'].includes(cur.status)) return null; // 그사이 바뀐 콘텐츠는 건너뜀
    const [prev] = await tx<{ body: string; media_ids: string[] }[]>`select body, media_ids from mkt_versions where content_id = ${c.id} and version = ${cur.current_version}`;
    if (prev?.media_ids?.length) return null;
    const v = cur.current_version + 1;
    const q = cur.quality ?? {};
    const issues = ((q.issues ?? []) as string[]).filter((x) => !VISUAL_ISSUE.test(x));
    const onlyVisual = q.passed === false && (q.issues ?? []).length > 0 && !issues.length;
    const status = cur.status === 'changes' && onlyVisual ? 'pending' : cur.status;
    const quality = { ...q, issues, ...(onlyVisual ? { passed: true } : {}), ...(q.report ? { report: { ...q.report, v } } : {}), visual: { by: 'server', fileId, at: new Date().toISOString() } };
    await tx`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, ${v}, ${prev?.body ?? ''}, ${[fileId]}, ${note}, ${actorId})`;
    await tx`update mkt_contents set current_version = ${v}, status = ${status}, quality = ${tx.json(quality as never)}, reminded_at = null, updated_at = now() where id = ${c.id}`;
    await tx`update mkt_production_requests set status = 'canceled', reason = '서버 그리기로 시안을 붙임', decided_at = now() where content_id = ${c.id} and kind = 'image' and status in ('open', 'needs_approval')`;
    await tx`insert into mkt_credit_ledger (tenant, content_id, version, kind, credits, note, title) values (${c.tenant}, ${c.id}, ${v}, 'generate_image', 0, '시안 서버 그리기 — 크레딧 0', ${c.title})`;
    return { version: v, status: status as string };
  });
}

/** 정기 실행: 자동 제작분 중 시안 없이 승인 대기인 것에 시안을 그려 붙이고 재승인 요청(사람이 수정 요청한 것은 건드리지 않음)
 *  정기 실행 한 번(60초)에 다른 일도 있으므로 한 번에 4건·20초까지 — 남은 것은 다음 실행(15분)에 */
export async function fillMissingVisuals(tenant: string, limit = 4, budgetMs = 20000) {
  const sql = db(); const t0 = Date.now();
  const rows = await sql<(Content & { status: string })[]>`select c.id, c.tenant, c.brand_id, c.title, c.channel, c.kind, c.created_by, c.is_test, c.current_version, c.status from mkt_contents c
    join mkt_versions v on v.content_id = c.id and v.version = c.current_version
    where c.tenant = ${tenant} and c.auto and c.status in ('pending', 'changes') and cardinality(v.media_ids) = 0 and c.channel in ('instagram', 'facebook')
      and coalesce(c.kind, '') not in ('reels', 'shorts', 'video') and (c.scheduled_at is null or c.scheduled_at > now() - interval '1 day')
      and not exists (select 1 from mkt_decisions d where d.content_id = c.id and d.version = c.current_version and d.decision in ('changes', 'hold'))
    order by c.scheduled_at nulls last limit ${limit}`;
  const out: { id: string; version?: number; error?: string }[] = [];
  const M = await import('./mktAuto');
  for (const c of rows) {
    if (Date.now() - t0 > budgetMs) break;
    try {
      const [v] = await sql<{ body: string }[]>`select body from mkt_versions where content_id = ${c.id} and version = ${c.current_version}`;
      const d = await drawAutoVisual(c, v?.body ?? '');
      const r = await attachVisual(c, d.fileId, `시안 자동 그리기(서버·크레딧 0)${d.photoTitle ? ` — 사진: ${d.photoTitle}` : ' — 브랜드 색 바탕'}`, c.created_by);
      if (!r) continue;
      out.push({ id: c.id, version: r.version });
      if (r.status === 'pending') await M.mktNotify(sql, c, null, { approval: true, type: 'review_requested', title: `시안을 붙여 다시 올렸습니다(v${r.version}): ${c.title}`, body: '시안 없이 올라갔던 자동 제작 글에 서버가 그린 이미지를 붙였습니다 — 승인해 주세요',
        link: `/s/marketing/approvals?c=${c.id}`, entityType: 'mkt_content', entityId: c.id, dedupeKey: `mktvis:${c.id}:${r.version}` });
    } catch (e: any) { out.push({ id: c.id, error: String(e?.message ?? e).slice(0, 200) }); }
  }
  return out;
}

/** 승인함 [지금 만들기]: 마케팅 공간 사람 — 그 자리에서 그려 붙이고 재승인 대기 */
export async function makeVisualNow(u: SessionUser, id: string) {
  await assertSpace(u, 'marketing');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('콘텐츠를 찾을 수 없습니다');
  const sql = db();
  const [c] = await sql<(Content & { status: string })[]>`select id, tenant, brand_id, title, channel, kind, created_by, is_test, current_version, status from mkt_contents where id = ${id} and tenant = ${tenantOf(u)}`;
  if (!c) throw notFound('콘텐츠를 찾을 수 없습니다');
  if (!serverVisual(c)) throw badRequest(c.channel === 'blog' ? '블로그는 표지·본문 실사 사진을 붙여 주세요' : '영상 시안은 서버가 그리지 않습니다 — 제작 요청 카드(제작의뢰실)로 만들어 주세요');
  if (['published', 'canceled'].includes(c.status)) throw badRequest('게시했거나 취소한 콘텐츠입니다');
  const [v] = await sql<{ body: string; media_ids: string[] }[]>`select body, media_ids from mkt_versions where content_id = ${id} and version = ${c.current_version}`;
  if (v?.media_ids?.length) throw badRequest('이미 시안이 있습니다');
  const d = await drawAutoVisual(c, v?.body ?? '', { actor: u });
  const r = await attachVisual(c, d.fileId, `시안 그리기(서버·크레딧 0) — ${u.name}${d.photoTitle ? ` · 사진: ${d.photoTitle}` : ' · 브랜드 색 바탕'}`, u.id);
  if (!r) throw badRequest('그사이 콘텐츠가 바뀌었습니다 — 새로 고쳐 다시');
  await audit(sql, u.id, 'mkt.visual_now', 'mkt_content', id, { version: r.version, photoId: d.photoId }).catch(() => {});
  return { version: r.version, status: r.status, fileId: d.fileId, photo: d.photoTitle };
}
