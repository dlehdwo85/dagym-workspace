import { z } from 'zod';
import { db } from './db';
import { zUuid } from './api';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { badRequest, forbidden, notFound } from './errors';
import { tenantOf, type SessionUser } from './types';
import { KIND_SPEC } from './mktStudio';
import type { V2Scene } from './mktVideo';

/**
 * 271차 #811(대표 10/29 '마케팅 AI 영상 제작 비용 최소화'): 실제 사진 슬라이드쇼 영상 — 이 글에 맞는 자료실 실사(글자 든 그래픽·다른 브랜드 빼고)
 * 또는 고른 사진 3~8장을 장면마다 천천히 움직여(compose isStill) 자막·끝 화면·배경음으로 합성. 생성 비용 0(크레딧 원장 없음). 릴스 = 쇼츠 같은 영상으로 씀
 */
export const slideshowInput = z.object({ contentId: zUuid, photoIds: z.array(zUuid).min(3).max(8).optional() });
const SCENE_SEC = 2.6;
const MAX = 6;
const VIDEO_KINDS = ['reels', 'shorts', 'video'];
/** 글 → 자막 줄(장면마다 한 줄): 해시태그·링크·이모지 빼고 짧은 문장으로 */
export function slideLines(body: string, n: number): string[] {
  const clean = body.replace(/#[^\s#]+/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, '').replace(/\[[^\]]*\]/g, ' ');
  const parts = clean.split(/\n+|(?<=[.!?。])\s+/).map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => x.length >= 4);
  const out: string[] = [];
  for (const p of parts) { if (out.length >= n) break; out.push(p.length > 30 ? `${p.slice(0, 29).replace(/\s+\S*$/, '')}…` : p); }
  return out;
}
/** 310차(로컬 11/01 ③ 다짐 11/3 쇼츠·릴스 첫 장면이 같은 사진): 같은 브랜드 앞뒤 3일 안 사진 영상의 첫 장면(얼굴 가린 사본이면 원본 기준)과
 *  이 영상의 첫 장면이 같으면 겹치지 않는 사진을 맨 앞으로 */
async function freshFirst(c: any, ids: string[]): Promise<string[]> {
  if (ids.length < 2 || !c?.id) return ids;
  const sql = db();
  const firsts = (await sql<{ f: string }[]>`select b.result->'reuse'->'photos'->>0 as f from mkt_briefs b join mkt_contents m on m.id = b.content_id
    where m.tenant = ${c.tenant} and m.brand_id is not distinct from ${c.brand_id ?? null} and m.id <> ${c.id} and m.status <> 'canceled' and jsonb_typeof(b.result->'reuse'->'photos') = 'array'
      and abs(extract(epoch from (coalesce(m.scheduled_at, m.created_at) - (select coalesce(scheduled_at, created_at, now()) from mkt_contents where id = ${c.id})))) <= 259200`).map((r) => r.f).filter(Boolean);
  if (!firsts.length) return ids;
  const all = [...new Set([...ids, ...firsts])].filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const orig = new Map((await sql<{ id: string; o: string }[]>`select id::text, coalesce(meta->>'of', id::text) as o from library_files where id = any(${all}::uuid[])`).map((r) => [r.id, r.o]));
  const taken = new Set(firsts.map((f) => orig.get(f) ?? f));
  const k = ids.findIndex((id) => !taken.has(orig.get(id) ?? id));
  return k <= 0 ? ids : [ids[k], ...ids.slice(0, k), ...ids.slice(k + 1)];
}
/** 쓸 사진: 고른 것(3장 넘으면) 아니면 이 글에 맞는 자료실 실사 — 이 회사·준비된·기밀 아닌 사진만, 최대 6장 */
async function photosFor(c: any, text: string, picked: string[]): Promise<{ photos: { id: string; storage_key: string }[]; dropped: string[] }> {
  const V = await import('./mktAutoVisual'); const out: string[] = []; // 314차(로컬 11/01 ②): 얼굴 때문에 뺀 사진도 의뢰에 남겨 사진 기록에 보임
  const dropped = (all: string[]) => [...new Set(out)].filter((id) => !all.includes(id)).slice(0, MAX);
  // 310차(로컬 11/01 ①: 사진 영상 장면에 얼굴 그대로): 장면 사진도 얼굴 자리를 알면 모자이크 사본, 모르면 뺌 — 고른 사진이 그래서 3장 밑으로 줄면 후보로 채움
  let ids = picked.length >= 3 ? await V.faceSafeFor(c, [...new Set(picked)], out) : [];
  ids = await V.photoRuleIds(c, ids, out, text); // 321차: 고른 사진도 제목 시설·내용 모름 규칙(뺀 사진은 기록에) · 323차: 글에 없는 다른 시설 사진도
  if (ids.length < 3) {
    const more = (await V.blogPhotoCandidates(c, text, MAX, { own: true })).map((p) => p.id).filter((id) => !ids.includes(id)); // 303차 #869: 이 브랜드 사진만
    ids = [...ids, ...(await V.faceSafeFor(c, more, out))];
  }
  if (ids.length < 3) { // 310차: 가까운 글에 이미 쓴 사진뿐이면(사진이 적은 브랜드) 영상을 멈추지 않고 다시 씀 — 대신 첫 장면은 아래에서 겹치지 않게
    const again = (await V.blogPhotoCandidates(c, text, MAX, { own: true, near: false })).map((p) => p.id).filter((id) => !ids.includes(id));
    ids = [...ids, ...(await V.faceSafeFor(c, again, out))];
  }
  ids = await freshFirst(c, [...new Set(ids)]);
  if (!ids.length) return { photos: [], dropped: dropped(ids) };
  const rows = await db()<{ id: string; storage_key: string }[]>`select id, storage_key from library_files where tenant = ${c.tenant} and id = any(${ids}::uuid[]) and deleted_at is null
    and upload_status = 'ready' and mime_type like 'image/%' and coalesce(security, 'internal') <> 'confidential' and storage_key is not null`;
  const photos = ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is { id: string; storage_key: string } => !!r).slice(0, MAX);
  return { photos, dropped: dropped(ids) };
}
/** 합성 의뢰(제작의뢰실 v2, 바로 합성 단계) 넣고 합성 함수 부르기 — 생성 비용 0(예상 크레딧 0·원장 없음) */
async function insertBrief(c: any, body: string, result: Record<string, unknown>, by: string | null, source: 'slideshow' | 'screen') {
  const sql = db(); const spec = KIND_SPEC[c.kind] ?? KIND_SPEC.reels;
  const [b] = await sql<{ id: string }[]>`insert into mkt_briefs (tenant, brand_id, channel, kind, purpose, message, refs, tone, quantity, status, prompt, content_id, est_credits, result, created_by, mode)
    values (${c.tenant}, ${c.brand_id}, ${spec.channel}, ${c.kind}, 'awareness', ${String(c.title).replace(/^\s*\[시험\]\s*/, '').slice(0, 300) || '영상'}, ${sql.json({ [source]: true } as never)}, null,
      1, 'generating', ${sql.json({ caption: body, source } as never)}, ${c.id}, 0, ${sql.json(result as never)}, ${by}, ${c.mode === 'ad' ? 'ad' : 'content'}) returning id`;
  await (await import('./mktVideo')).kickRender(b.id).catch(() => {}); // 실패는 의뢰 상태·정기 실행이 다시
  return b.id;
}
/**
 * 398차 #1024(대표 11/13 '수준이 너무 낮습니다 … 무조건 실사 사용하지 않아도 된다니까요?'): 장면 계획 새 기준.
 *  자막 = 영상 대본 줄(없으면 글 문장)을 영상 전체 길이에 장면마다 한 줄(훅 → … → 행동 권유) · 장면 수 = 줄 수.
 *  장면 그림: 첫 장면(훅)·마지막 장면(권유) = 브랜드 색 그래픽 카드 + 가운데 큰 글자 / 가운데 장면 = 이 브랜드 '영상 화면 캡처'(휴대폰 틀) → 품질을 통과한 실사 → 모자라면 그래픽 카드.
 *  실사는 gatePhoto(저해상·흔들림·하얗게 날아감·너무 어두움)를 통과한 것만 — 뺀 사진과 이유는 의뢰 기록(reuse.gated)에.
 */
export async function planSlides(c: any, body: string, script: string[], photos: { id: string; storage_key: string }[]) {
  const P = await import('./video/slidePlan'); const sql = db();
  const [brand] = c.brand_id ? await sql<{ name: string; video: any; facts: any }[]>`select name, video, facts from mkt_brands where id = ${c.brand_id}` : [];
  const sc = P.slideScript({ title: String(c.title ?? ''), body, script, phone: String(brand?.facts?.phone ?? ''), cta: String(brand?.video?.cta ?? '') });
  const lines = sc.lines; const notes = [...sc.notes];
  // 대본 검사(줄 수·제목 되풀이·같은 말·권유)는 합성 전에 — 미달이면 영상을 만들지 않음(자막이 빈 영상·검사 미달 파일을 자료실에 쌓지 않음)
  const bad = P.scriptIssues(lines, String(c.title ?? ''));
  if (bad.length) return { scenes: [] as V2Scene[], lines, notes, gated: [] as { id: string; why: string }[], photos: [] as string[], skipped: `영상 대본 미달 — ${bad.join(' · ')}` };
  const { dimOf } = await import('./video/compose'); const d = dimOf((KIND_SPEC[c.kind] ?? KIND_SPEC.reels).aspect);
  // 실사 품질 거름
  const { getObject } = await import('./storage'); const good: { id: string; key: string; mode: 'cover' | 'contain' }[] = []; const gated: { id: string; why: string }[] = [];
  // 사진 AI 설명이 '화면을 찍은 사진'·'기울어진 사진'이라고 쓴 것은 계산(해상도·선명도·노출)으로는 못 거르므로 설명 글로 거름 — 화면은 캡처를 씀
  const SHOT = /기울어|비스듬|삐뚤|(화면|모니터|스크린)[을를]?\s*(찍|촬영)|모아레|반사[가되]\S*\s*(심|보)/;
  const vis = new Map((photos.length ? await sql<{ id: string; t: string }[]>`select id::text, concat_ws(' ', vision->>'caption', vision->>'scene') as t from library_files where id = any(${photos.map((p) => p.id)}::uuid[])` : []).map((r) => [r.id, r.t ?? '']));
  for (const p of photos) {
    if (SHOT.test(vis.get(p.id) ?? '')) { gated.push({ id: p.id, why: '화면을 찍었거나 기울어진 사진(사진 설명 기준) — 화면은 캡처를 씀' }); continue; }
    try { const g = await P.gatePhoto(await getObject(p.storage_key), d); if (g.ok) good.push({ id: p.id, key: p.storage_key, mode: g.mode }); else gated.push({ id: p.id, why: g.why ?? '품질 미달' }); }
    catch (e: any) { gated.push({ id: p.id, why: `사진 읽기 실패: ${String(e?.message ?? e).slice(0, 60)}` }); }
  }
  // 이 브랜드의 깨끗한 화면 캡처(자료실 '영상 화면 캡처' — 폴더·태그에 브랜드 이름) 2장까지
  const name = String(brand?.name ?? '').replace(/^\s*\[시험\]\s*/, '').trim();
  const caps = name ? (await (await import('./mktVideo')).videoAssets(c.tenant, '영상 화면 캡처').catch(() => [])).filter((x) => x.folder.includes(name) || (x.tags ?? []).includes(name) || String(x.title ?? '').includes(name)).slice(0, 2) : [];
  const N = lines.length; const mid: ({ cap: string } | { photo: (typeof good)[number] })[] = [];
  { let ci = 0, pi = 0; for (let k = 0; k < N - 2; k++) { // 가운데 장면: 캡처·실사를 번갈아(캡처 먼저)
      const wantCap = k % 2 === 0;
      if (wantCap && ci < caps.length) mid.push({ cap: caps[ci++].id }); else if (pi < good.length) mid.push({ photo: good[pi++] }); else if (ci < caps.length) mid.push({ cap: caps[ci++].id }); else break; } }
  const scenes: V2Scene[] = lines.map((line, k) => {
    const base = { k, seconds: P.sceneSeconds(line, k), line, visualEn: '', status: 'completed' as const, tries: 0, still: true };
    const m = k > 0 && k < N - 1 ? mid[k - 1] : undefined;
    if (m && 'photo' in m) return { ...base, screen: null, key: m.photo.key, mode: m.photo.mode };
    if (m && 'cap' in m) return { ...base, screen: { mediaId: m.cap, device: 'phone' as const }, key: null, mode: 'card' as const };
    return { ...base, screen: null, key: null, mode: 'card' as const, big: true };
  });
  return { scenes, lines, notes, gated, photos: scenes.filter((x) => x.key).map((x) => good.find((g) => g.key === x.key)!.id), skipped: null as string | null };
}
async function startBrief(c: any, body: string, photos: { id: string; storage_key: string }[], by: string | null, extra: Record<string, unknown> = {}, script: string[] = []) {
  const plan = await planSlides(c, body, script, photos);
  if (plan.skipped) return { briefId: undefined as string | undefined, photos: 0, seconds: 0, skipped: plan.skipped };
  const { SLIDE_GEN } = await import('./video/slidePlan');
  const result = { provider: 'slideshow', pipeline: 'v2', model: null, stage: 'render', variants: [{ n: 0, scenes: plan.scenes }], errors: [], notes: plan.notes, mediaIds: [],
    reuse: { slideshow: true, gen: SLIDE_GEN, photos: plan.photos, ...(plan.gated.length ? { gated: plan.gated.slice(0, 8) } : {}), ...extra } };
  return { briefId: await insertBrief(c, body, result, by, 'slideshow'), photos: plan.photos.length, seconds: Math.round(plan.scenes.reduce((a, x) => a + x.seconds, 0)), skipped: undefined as string | undefined };
}
/** 273차 #811 1) 앱 화면 녹화: 녹화 영상 한 편 → 길이를 재서 장면(자막 한 줄씩)으로 나눠 끝 화면·배경음과 합성(187차 ⑦ 한 편 나눠 쓰기 길). 자막 = 파일 설명 줄(녹화 실행기가 대본 lines 를 넣음), 없으면 글 문장 */
async function startRecording(c: any, body: string, f: { id: string; storage_key: string; description: string | null }, by: string | null, extra: Record<string, unknown> = {}) {
  const own = String(f.description ?? '').split('\n').map((x) => x.trim()).filter((x) => x.length >= 2).slice(0, 6);
  const lines = own.length ? own : slideLines(body, 4);
  const result = { provider: 'screen', pipeline: 'v2', model: null, stage: 'render', variants: [{ n: 0, scenes: [], source: { key: f.storage_key, fileId: f.id, lines } }], errors: [], notes: [], mediaIds: [], reuse: { screen: true, fileId: f.id, ...extra } };
  return { briefId: await insertBrief(c, body, result, by, 'screen'), lines: lines.length };
}
type Rec = { id: string; title: string; storage_key: string; description: string | null; created_at: Date; used: boolean; mine: boolean };
/** 자료실 화면 녹화(폴더 '마케팅/화면 녹화' 또는 태그 '화면 녹화' 영상, 제작의뢰실이 만든 완성 영상은 뺌) — 이 글 브랜드 것(태그·제목) 먼저, 아직 영상으로 안 쓴 것 먼저, 새것 먼저 */
async function recordingsFor(c: any, limit = 12): Promise<Rec[]> {
  const sql = db();
  const [b] = c.brand_id ? await sql<{ name: string }[]>`select name from mkt_brands where id = ${c.brand_id}` : [];
  const brand = String(b?.name ?? '').replace(/^\s*\[시험\]\s*/, '').trim();
  return sql<Rec[]>`select f.id, f.title, f.storage_key, f.description, f.created_at,
      exists (select 1 from mkt_briefs x where x.tenant = f.tenant and x.result->'reuse'->>'fileId' = f.id::text and x.status <> 'failed') as used,
      (${brand} <> '' and (${brand} = any(f.tags) or f.title ilike ${`%${brand}%`})) as mine
    from library_files f where f.tenant = ${c.tenant} and f.deleted_at is null and f.upload_status = 'ready' and f.mime_type like 'video/%' and f.storage_key is not null
      and coalesce(f.security, 'internal') <> 'confidential' and (f.folder like '마케팅/화면 녹화%' or '화면 녹화' = any(f.tags))
      and not ('제작의뢰실' = any(f.tags)) and f.source <> 'ai' -- 녹화로 만든 완성 영상(태그 '화면 녹화')은 다시 녹화로 고르지 않음
    order by 7 desc, 6, f.created_at desc limit ${limit}`;
}
async function videoContent(u: SessionUser, id: string) {
  await assertSpace(u, 'marketing');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw notFound('콘텐츠를 찾을 수 없습니다');
  if (!isAdmin(u)) throw forbidden('영상 만들기는 관리자가 합니다');
  const [c] = await db()<any[]>`select id, tenant, brand_id, title, channel, kind, created_by, is_test, current_version, mode, auto from mkt_contents
    where id = ${id} and tenant = ${tenantOf(u)} and deleted_at is null and status not in ('published', 'canceled')`;
  if (!c) throw notFound('콘텐츠를 찾을 수 없습니다');
  if (!VIDEO_KINDS.includes(c.kind ?? '')) throw badRequest('릴스·쇼츠·영상 글에만 영상을 붙일 수 있습니다');
  return c;
}
/** 승인함 [녹화 파일로 영상 만들기]: 고를 녹화 목록 */
export async function recordingList(u: SessionUser, contentId: string) {
  const c = await videoContent(u, contentId);
  return { files: (await recordingsFor(c)).map((f) => ({ id: f.id, title: f.title, at: f.created_at, mine: f.mine, used: f.used, lines: String(f.description ?? '').split('\n').filter((x) => x.trim()).length })) };
}
export const recordingInput = z.object({ contentId: zUuid, fileId: zUuid });
export async function recordingStart(u: SessionUser, i: z.infer<typeof recordingInput>) {
  const c = await videoContent(u, i.contentId);
  if (await busyOf(c.id)) throw badRequest('이 글의 영상을 이미 만드는 중입니다');
  const [f] = await db()<Rec[]>`select id, title, storage_key, description, created_at, false as used, false as mine from library_files where id = ${i.fileId} and tenant = ${c.tenant}
    and deleted_at is null and upload_status = 'ready' and mime_type like 'video/%' and storage_key is not null and coalesce(security, 'internal') <> 'confidential'`;
  if (!f) throw badRequest('자료실 영상(기밀 제외)만 고를 수 있습니다');
  const [v] = await db()<{ body: string }[]>`select body from mkt_versions where content_id = ${c.id} and version = ${c.current_version}`;
  const out = await startRecording(c, v?.body ?? c.title, f, u.id);
  await (await import('./log')).audit(db(), u.id, 'mkt.video_screen', 'mkt_content', c.id, { brief: out.briefId, file: f.id }).catch(() => {});
  return out;
}
/** 자동 제작: 브랜드 영상 방법이 앱 화면 녹화(screen)면 이 브랜드의 아직 안 쓴 녹화로 그 판에 영상 — 없으면 하지 않음(제작 요청 카드 그대로) */
export async function autoRecording(c: any, version: number, body: string): Promise<{ briefId?: string; skipped?: string; none?: boolean }> {
  if (!VIDEO_KINDS.includes(c.kind ?? '')) return { skipped: '영상 글 아님' };
  if (await busyOf(c.id)) return { skipped: '이미 만드는 중' };
  const f = (await recordingsFor(c)).find((x) => x.mine && !x.used);
  if (!f) return { skipped: "이 브랜드의 안 쓴 화면 녹화 없음(자료실 '마케팅/화면 녹화')", none: true };
  return { briefId: (await startRecording(c, body, f, c.created_by ?? null, { auto: true, version })).briefId };
}
const busyOf = async (id: string) => (await db()`select 1 from mkt_briefs where content_id = ${id} and status = 'generating' limit 1`).length > 0;

export async function slideshowStart(u: SessionUser, i: z.infer<typeof slideshowInput>) {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('사진 영상 만들기는 관리자가 합니다');
  const sql = db(); const t = tenantOf(u);
  const [c] = await sql<any[]>`select id, tenant, brand_id, title, channel, kind, created_by, is_test, current_version, mode, auto from mkt_contents
    where id = ${i.contentId} and tenant = ${t} and deleted_at is null and status not in ('published', 'canceled')`;
  if (!c) throw notFound('콘텐츠를 찾을 수 없습니다');
  if (!VIDEO_KINDS.includes(c.kind ?? '')) throw badRequest('릴스·쇼츠·영상 글에만 사진 영상을 만들 수 있습니다');
  if (await busyOf(c.id)) throw badRequest('이 글의 영상을 이미 만드는 중입니다');
  const [v] = await sql<{ body: string }[]>`select body from mkt_versions where content_id = ${c.id} and version = ${c.current_version}`;
  const body = v?.body ?? c.title;
  const { photos, dropped } = await photosFor(c, `${c.title}\n${body}`, i.photoIds ?? []);
  // 398차 #1024: 실사가 없어도 만듦(그래픽 카드·화면 캡처) — 자막은 영상 대본 줄, 실사는 품질을 통과한 것만
  const [cq] = await sql<{ quality: any }[]>`select quality from mkt_contents where id = ${c.id}`;
  const sc0: string[] = Array.isArray(cq?.quality?.script) ? cq.quality.script.map(String) : (await import('./mktQuality')).scriptLines(body);
  const out = await startBrief(c, body, photos, u.id, dropped.length ? { faceDropped: dropped } : {}, sc0);
  if (!out.briefId) throw badRequest(out.skipped ?? '영상을 만들 수 없습니다');
  await (await import('./log')).audit(sql, u.id, 'mkt.video_slideshow', 'mkt_content', c.id, { brief: out.briefId, photos: photos.length }).catch(() => {});
  return out;
}

/**
 * 271차 #811 자동 제작: 브랜드 영상 키트의 '영상 만드는 방법'이 실제 사진(photos)이면 릴스·쇼츠 원고 직후 그 판에 사진 영상을 붙임(생성 비용 0).
 * 사진이 3장이 안 되면 하지 않음(제작 요청 카드 그대로) — 이유를 돌려줌
 */
export async function autoSlideshow(c: any, version: number, body: string, picked: string[] = [], ruleText = '', extra: Record<string, unknown> = {}): Promise<{ briefId?: string; photos: number; skipped?: string }> {
  if (!VIDEO_KINDS.includes(c.kind ?? '')) return { photos: 0, skipped: '영상 글 아님' };
  if (await busyOf(c.id)) return { photos: 0, skipped: '이미 만드는 중' };
  // 333차(CI mkt-face-310 ①·③·⑤): 사진 규칙(시설·수업·장면)이 보는 글 = 제목 + 캡션 + 대본 줄(ruleText) — 대본에 '상담은 전화로'가 있으면 상담 데스크 장면도 이 영상의 장면
  const { photos, dropped } = await photosFor(c, `${c.title}\n${body}${ruleText ? `\n${ruleText}` : ''}`, picked);
  // 398차 #1024(대표 11/13 '무조건 실사 사용하지 않아도 된다'): 사진이 3장이 안 돼도 보류하지 않음 — 그래픽 카드·화면 캡처로 만들고, 실사는 품질을 통과한 것만. 대본 줄 = ruleText(자동 제작이 넘긴 컷 줄)
  const script = ruleText.split('\n').map((x) => x.trim()).filter(Boolean);
  const out = await startBrief(c, body, photos, c.created_by ?? null, { auto: true, version, ...(dropped.length ? { faceDropped: dropped } : {}), ...extra }, script);
  if (!out.briefId) return { photos: 0, skipped: out.skipped ?? '영상 대본이 모자람' };
  return { briefId: out.briefId, photos: out.photos };
}

/**
 * 301차 #865(로컬 11/01: 하이링크 영상 4건이 '앱 화면 녹화'로 묶여 10/31부터 멈춤): 브랜드 영상 방법대로 자동 영상.
 * 앱 화면 녹화(screen)인데 이 브랜드의 안 쓴 녹화가 없고, 브랜드 시안 사진이 '앱 화면 캡처만'(screen)이 아니면 — 하이링크처럼 출입·업무 장면 사진·캡처가 있는 브랜드 —
 * 녹화를 기다리지 않고 그 사진·캡처로 사진 영상(생성 비용 0). 워크인처럼 '앱 화면 캡처만'인 브랜드는 녹화를 기다림(녹화 실행기로 올리면 붙음)
 */
export async function autoVideo(c: any, version: number, body: string, method: string | null | undefined, photoSource: string | null | undefined, picked: string[] = [], ruleText = ''):
  Promise<{ briefId?: string; skipped?: string; via: 'photos' | 'screen'; note?: string }> {
  if (method === 'photos') return { ...(await autoSlideshow(c, version, body, picked, ruleText)), via: 'photos' };
  const r = await autoRecording(c, version, body);
  if (!r.none) return { ...r, via: 'screen' };
  // 404차(노트북 11/13 밤 '워크인 쇼츠·릴스 2건이 영상 없이 올라옴'): 예전엔 '앱 화면 캡처만' 브랜드(워크인)는 녹화가 올라올 때까지 기다려 영상 없는 글로 남았다 →
  // 398차 #1024(대표 "무조건 실사 사용하지 않아도 된다" · 기본은 화면 캡처·도형·큰 글자)에 맞춰 녹화가 없으면 기다리지 않고 그래픽·화면 캡처 영상으로. 녹화가 있으면 그 녹화가 먼저
  const s = await autoSlideshow(c, version, body, picked, ruleText);
  const what = photoSource === 'screen' ? '그래픽·화면 캡처' : '장면 사진·캡처';
  return s.skipped ? { skipped: `${r.skipped} · ${what} 영상도 ${s.skipped}`, via: 'screen' } : { briefId: s.briefId, via: 'photos', note: `화면 녹화가 없어 ${what} 영상으로` };
}

/**
 * 301차 #865: 영상 글이 '영상 시안 제작 중'으로 멈춘 것 다시 시도(정기 실행) — 브랜드 영상 방법이 사진·화면 녹화인 글만, 6시간에 한 번, 게시 예정이 지나지 않은 것.
 * 원고 직후 사진이 3장이 안 됐거나(그 뒤 자료 요청으로 올라옴) 녹화가 없던 글(그 뒤 녹화가 올라왔거나, 장면 사진 브랜드)이 붙음
 */
export async function videoRetryTick(o: { limit?: number; tenant?: string } = {}) {
  const sql = db(); const tf = o.tenant ? sql`and c.tenant = ${o.tenant}` : sql``;
  const rows = await sql<any[]>`select c.id, c.tenant, c.brand_id, c.title, c.channel, c.kind, c.created_by, c.is_test, c.current_version, c.mode, c.auto, c.quality,
      b.video->>'method' as method, b.video->>'photoSource' as photo_source
    from mkt_contents c join mkt_brands b on b.id = c.brand_id
    where c.deleted_at is null and c.kind = any(${VIDEO_KINDS}::text[]) and c.current_version > 0 and c.produced_at is not null
      and (c.status in ('pending', 'changes') or (c.status = 'draft' and c.quality ? 'batch' and not coalesce((c.quality->>'held')::boolean, false)))
      and (c.scheduled_at is null or c.scheduled_at > now())
      and b.video->>'method' in ('photos', 'screen')
      and exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(c.quality->'issues') = 'array' then c.quality->'issues' else '[]'::jsonb end) x where x like '영상 시안 제작 중%')
      and not exists (select 1 from mkt_versions v where v.content_id = c.id and v.version = c.current_version and cardinality(v.media_ids) > 0)
      and not exists (select 1 from mkt_briefs x where x.content_id = c.id and x.status = 'generating')
      and coalesce((c.quality->'videoRetry'->>'at')::timestamptz, 'epoch'::timestamptz) < now() - interval '6 hours' ${tf}
    order by c.scheduled_at nulls last limit ${o.limit ?? 6}`;
  const out: { id: string; via: string; started: boolean; skipped?: string }[] = [];
  for (const c of rows) {
    const [v] = await sql<{ body: string }[]>`select body from mkt_versions where content_id = ${c.id} and version = ${c.current_version}`;
    const sc: string[] = Array.isArray(c.quality?.script) ? c.quality.script.map(String) : (await import('./mktQuality')).scriptLines(v?.body ?? ''); // 333차: 대본 줄도 사진 규칙 글에
    const r = await autoVideo(c, c.current_version, v?.body ?? c.title, c.method, c.photo_source, [], sc.join('\n')).catch((e: any) => ({ skipped: String(e?.message ?? e).slice(0, 200), via: c.method } as any));
    await sql`update mkt_contents set quality = coalesce(quality, '{}'::jsonb) || ${sql.json({ videoRetry: { at: new Date().toISOString(), via: r.via, ...(r.briefId ? { briefId: r.briefId } : {}), ...(r.skipped ? { skipped: r.skipped } : {}) } } as never)} where id = ${c.id}`;
    if (r.briefId && r.note) await sql`update mkt_versions set note = concat_ws(' · ', note, ${r.note}::text) where content_id = ${c.id} and version = ${c.current_version}`;
    out.push({ id: c.id, via: r.via, started: !!r.briefId, ...(r.skipped ? { skipped: r.skipped } : {}) });
  }
  return { checked: rows.length, started: out.filter((x) => x.started).length, items: out };
}

/**
 * 자동 사진 영상이 다 되면(합성 끝 · mktVideo finalize): 새 판을 만들지 않고 그 원고 판에 영상을 붙임 — '영상 시안 제작 중' 줄을 지우고,
 * 그것뿐이었으면 승인 대기로(주 묶음·초안 보관 원고는 초안 그대로, 묶음 상태만) · 영상 제작 요청 카드는 '실제 사진 영상으로 대신함'.
 * 그사이 사람이 다른 판을 올렸거나 이미 영상이 붙었으면 붙이지 않음(자료실 파일만 남음)
 */
export async function attachAuto(b: { content_id: string }, reuse: { version: number; screen?: boolean; replace?: boolean }, mediaIds: string[], note: string) {
  const sql = db();
  const r = await sql.begin(async (tx) => {
    const [c] = await tx<any[]>`select id, tenant, title, status, current_version, quality, brand_id, is_test, created_by from mkt_contents where id = ${b.content_id} and deleted_at is null for update`;
    if (!c || c.current_version !== reuse.version || ['published', 'canceled'].includes(c.status)) return null;
    // 398차 #1024: replace = 옛 기준 영상 시안을 새 기준 영상으로 바꿔 붙임(같은 판, 상태 그대로 — 옛 파일은 자료실에 남음)
    const [v] = reuse.replace
      ? await tx`update mkt_versions set media_ids = ${mediaIds}, note = concat_ws(' · ', note, ${`새 기준으로 다시 만든 영상 — ${note}`}::text) where content_id = ${c.id} and version = ${reuse.version} returning version`
      : await tx`update mkt_versions set media_ids = ${mediaIds}, note = concat_ws(' · ', note, ${note}::text) where content_id = ${c.id} and version = ${reuse.version} and cardinality(media_ids) = 0 returning version`;
    if (!v) return null;
    if (reuse.replace) return { c, toPending: false };
    const { VISUAL_ISSUE } = await import('./mktAutoVisual');
    const q = c.quality ?? {}; const left = ((q.issues ?? []) as string[]).filter((x) => !VISUAL_ISSUE.test(x));
    const passed = q.passed !== false || !left.length;
    const quality = { ...q, issues: left, passed, ...(q.batch ? { batch: { ...q.batch, status: passed ? 'pending' : 'changes' } } : {}) };
    // 323차(로컬 11/02 문제 1: 보류 글을 사진 영상 다시 의뢰하니 승인 대기로 풀림): 사람이 보류한 글(hold)은 영상이 붙어도 보류 그대로 — 풀기는 사람이
    const status = c.status === 'draft' ? 'draft' : c.status === 'hold' ? 'hold' : passed ? 'pending' : c.status;
    await tx`update mkt_contents set status = ${status}, quality = ${tx.json(quality as never)}, updated_at = now() where id = ${c.id}`;
    await tx`update mkt_production_requests set status = 'done', brief = concat_ws(E'\n\n', brief, ${reuse.screen ? '화면 녹화 영상으로 대신함(생성 비용 0)' : '실제 사진 영상으로 대신함(생성 비용 0)'}::text), decided_at = now()
      where content_id = ${c.id} and kind = 'video' and status in ('open', 'needs_approval')`;
    return { c, toPending: status === 'pending' && c.status !== 'pending' };
  });
  if (r?.toPending) {
    const A = await import('./mktAuto'); const s = await A.settingsOf(r.c.tenant);
    if (!A.isQuiet(new Date(), s)) await A.mktNotify(sql, r.c, null, { approval: true, type: 'review_requested', title: `승인 요청: ${r.c.title}`, body: note, link: `/s/marketing/approvals?c=${r.c.id}`, entityType: 'mkt_content', entityId: r.c.id, dedupeKey: `mktp:${r.c.id}:${reuse.version}:video` });
  }
  return !!r;
}

/**
 * 398차 #1024(대표 11/13 — 승인함의 영상 시안이 옛 기준): 아직 게시 전(승인 대기·수정 요청·보류·초안)인 글에 붙은 자동 사진 영상 중 새 기준(gen)이 아닌 것을
 * 한 번씩 새 기준으로 다시 만들어 그 판에 바꿔 붙임(생성 비용 0 — 서버 합성). 한 번에 2건, 글마다 한 번(quality.videoRemake).
 */
export async function videoRemakeTick(o: { limit?: number; tenant?: string } = {}) {
  const sql = db(); const tf = o.tenant ? sql`and c.tenant = ${o.tenant}` : sql``;
  const { SLIDE_GEN } = await import('./video/slidePlan');
  const rows = await sql<any[]>`select c.id, c.tenant, c.brand_id, c.title, c.channel, c.kind, c.created_by, c.is_test, c.current_version, c.mode, c.auto, c.quality
    from mkt_contents c
    where c.deleted_at is null and c.kind = any(${VIDEO_KINDS}::text[]) and c.status in ('pending', 'changes', 'hold', 'draft') and c.current_version > 0
      and (c.scheduled_at is null or c.scheduled_at > now()) and not (coalesce(c.quality, '{}'::jsonb) ? 'videoRemake')
      and exists (select 1 from mkt_versions v where v.content_id = c.id and v.version = c.current_version and cardinality(v.media_ids) > 0)
      and exists (select 1 from mkt_briefs x where x.content_id = c.id and x.status = 'review' and x.result->'reuse'->>'slideshow' = 'true' and x.result->'reuse'->>'auto' = 'true'
        and (x.result->'reuse'->>'version')::int = c.current_version and coalesce((x.result->'reuse'->>'gen')::int, 0) < ${SLIDE_GEN})
      and not exists (select 1 from mkt_briefs x where x.content_id = c.id and x.status = 'generating') ${tf}
    order by c.scheduled_at nulls last limit ${o.limit ?? 2}`;
  const out: { id: string; started: boolean; skipped?: string }[] = [];
  for (const c of rows) {
    const [v] = await sql<{ body: string }[]>`select body from mkt_versions where content_id = ${c.id} and version = ${c.current_version}`;
    const sc: string[] = Array.isArray(c.quality?.script) ? c.quality.script.map(String) : (await import('./mktQuality')).scriptLines(v?.body ?? '');
    const r = await autoSlideshow(c, c.current_version, v?.body ?? c.title, [], sc.join('\n'), { replace: true }).catch((e: any) => ({ photos: 0, skipped: String(e?.message ?? e).slice(0, 200) } as { briefId?: string; photos: number; skipped?: string }));
    await sql`update mkt_contents set quality = coalesce(quality, '{}'::jsonb) || ${sql.json({ videoRemake: { at: new Date().toISOString(), gen: SLIDE_GEN, ...(r.briefId ? { briefId: r.briefId } : {}), ...(r.skipped ? { skipped: r.skipped } : {}) } } as never)} where id = ${c.id}`;
    out.push({ id: c.id, started: !!r.briefId, ...(r.skipped ? { skipped: r.skipped } : {}) });
  }
  return { checked: rows.length, started: out.filter((x) => x.started).length, items: out };
}
