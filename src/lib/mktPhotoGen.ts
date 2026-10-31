import { createHash } from 'node:crypto';
import { db } from './db';
import { audit } from './log';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { badRequest, forbidden, notFound } from './errors';
import { visionOk } from './mktPhotos';
import { tenantOf, type SessionUser } from './types';
import { seesInternals } from './customerScope';
import type { CardPage, VisualContent } from './mktAutoVisual';

/**
 * 189차(대표 #685 "모든 장 실사 — 모자라면 실사를 참고해 실사풍으로 생성(크레딧 한도)" · #621 "품질 검수 → 보정/AI 재생성"):
 *  ① 빈 칸 채우기: 서버가 그린 피드·스토리 시안에서 실사가 모자라 브랜드 색으로 남은 칸(표지 — 피드 틀이 없는 브랜드만 · 카드뉴스 장 · 스토리 프레임, 행동 장 빼고)을
 *     같은 브랜드 실사(AI 설명상 실사·홍보물 아님·얼굴 안 보임·화질 괜찮음)를 참고 사진으로 실사풍 생성 → 그 칸만 그 사진으로 다시 그려 새 버전.
 *     회사 설정 photo_gen(기본 꺼짐, 자동 생성 일시정지 중엔 안 함)이면 정기 실행이, 아니면 관리자가 상세 '사진 기록'의 [빈 칸 생성으로 채우기]로.
 *     한 글 2장까지 · 이번 주·이번 달 크레딧 한도 안(진행 중인 생성도 셈) · 시험 글·게시 2시간 안 글 제외.
 *  ② 다시 만들기(#621): 관리자가 사진 AI 설명 목록에서 [AI로 다시 만들기] — 그 사진(얼굴 안 보이는 것만)을 참고로 깨끗한 실사풍 한 장.
 *  생성 사진 = 자료실 '마케팅/AI 생성(실사 참고)'(source ai_ref · 태그 AI 생성·실사 참고·글자없음 · meta.gen 참고 사진) — 사진 고르기에서 실사보다 뒤(−3),
 *  사진 기록·노트에 '생성'으로 따로 보임. 비동기: 제출(요청 id) → 정기 실행이 상태 확인 → 완료분 저장·원장 → 다 끝나면 붙임. 실패·검수 걸림은 과금 없음.
 *  외부 연결은 플랫폼 운영 › 생성 연동(키·켜기·모델 표의 '참고 사진 칸')에서만 — 고객 화면에는 서비스 이름·모델·원인을 내보내지 않는다(#602).
 */
export const FILL_MAX = 4; // 296차: 2 → 4 — 사진 장이 절반이 될 때까지만(레퍼런스 '사진 장 절반 이상', 크레딧 한도 안)
export const GEN_FOLDER = '마케팅/AI 생성(실사 참고)';
const TIMEOUT_MIN = 30;
const TERMINAL = new Set(['completed', 'failed', 'nsfw', 'canceled', 'timeout']);
export const NOT_READY = '사진 생성이 아직 준비되지 않았습니다(운영사 설정)';
const NO_REF = '참고할 실사가 없습니다 — 같은 브랜드의 얼굴이 보이지 않는 실사가 필요합니다';
const LIMIT = '이번 주(또는 이번 달) 크레딧 한도라 생성하지 않았습니다';
type Slot = 'cover' | number;
export type FillJob = { slot: Slot; requestId: string; statusUrl: string; status: string; ref: string; fileId?: string; error?: string };
export type Fill = { v: number; checked?: number; status: 'generating' | 'done' | 'skipped' | 'failed' | 'stale' | 'none'; reason?: string; model?: string; per?: number; credits?: number; jobs?: FillJob[]; at: string; by: 'auto' | 'manual'; error?: string };
type Row = VisualContent & { status: string; quality: any; scheduled_at: Date | null };
const COLS = 'c.id, c.tenant, c.brand_id, c.title, c.channel, c.kind, c.created_by, c.is_test, c.current_version, c.status, c.quality, c.scheduled_at, c.auto';

/** 같은 입력이면 같은 키(다시 보내도 두 번 과금되지 않게) — UUID 모양 */
const uuidOf = (s: string) => { const h = createHash('sha1').update(s).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`; };

/** 빈 사진 칸(피드·스토리만 — 블로그는 도표형 카드로 채움): 표지(틀 없이 그렸고 사진 없음 — 브랜드에 피드 틀이 없을 때만) + 행동 장·스토리 마지막 프레임을 뺀 장 중 사진 없는 장 */
export function emptySlots(c: { kind: string | null; channel: string }, q: any, templates: boolean): Slot[] {
  if ((c.kind !== 'feed' && c.kind !== 'story') || c.channel === 'blog') return [];
  const out: Slot[] = []; const vis = q?.visual;
  // 295차 #835: 단색 바탕 + 글자 표지(visual.plain)도 표지 칸 — 피드 틀이 있는 브랜드여도
  if (vis?.by === 'server' && (vis.plain || (!templates && !vis.template && !vis.photoId && !(Array.isArray(vis.photoIds) && vis.photoIds.length)))) out.push('cover');
  const pages: CardPage[] = Array.isArray(q?.pages) ? q.pages : []; const story = c.kind === 'story';
  pages.forEach((p, k) => { if (p.role !== 'cta' && !(story && k === pages.length - 1) && !p.photoId) out.push(k); });
  return out;
}

async function ready() {
  const H = await import('./higgsfield');
  const hf = await H.hfSettings(); const m = H.refModel(hf.models);
  return hf.enabled && m?.ref ? { H, m: m as typeof m & { ref: string } } : null;
}

/** 사진 AI 설명 화면 [AI로 다시 만들기]: 준비됨(운영사 설정) · 장당 크레딧(고객사에도 크레딧은 보임 — 모델 이름은 안 보냄) */
export async function regenInfo() { const r = await ready(); return { ready: !!r, credits: r ? Number(r.m.credits) || 0 : null }; }

/** #602 자료실 파일 상세(meta)에서 생성 요청 주소·모델·오류 원문은 고객사에 빼고 상태만 */
export function customerMeta(m: any) {
  if (!m || typeof m !== 'object') return m;
  const out = { ...m };
  if (out.regen && typeof out.regen === 'object') out.regen = { status: out.regen.status ?? null, fileId: out.regen.fileId ?? null, at: out.regen.at ?? null };
  if (out.gen && typeof out.gen === 'object') { const { model: _m, ...g } = out.gen; out.gen = g; }
  return out;
}

/** 진행 중인 생성 장 수(빈 칸 채우기 + 다시 만들기) — 한도 계산에 미리 셈 */
async function inflight(tenant: string) {
  const [r] = await db()<{ n: number }[]>`select ((select coalesce(sum((select count(*) from jsonb_array_elements(case when jsonb_typeof(c.quality->'fill'->'jobs') = 'array' then c.quality->'fill'->'jobs' else '[]'::jsonb end) j
        where coalesce(j->>'status', '') not in ('completed', 'failed', 'nsfw', 'canceled', 'timeout'))), 0) from mkt_contents c where c.tenant = ${tenant} and c.quality->'fill'->>'status' = 'generating')
      + (select count(*) from library_files where tenant = ${tenant} and meta->'regen'->>'status' = 'generating'))::int as n`;
  return Number(r?.n ?? 0);
}
/** 크레딧 한도(이번 주·이번 달, 비우면 요금제) 안에서 만들 수 있는 장 수 — 장당 원가가 0이면 한도와 상관없음 */
export async function budgetFor(tenant: string, per: number, want: number): Promise<number> {
  if (want <= 0) return 0;
  if (!(per > 0)) return want;
  const M = await import('./mktAuto');
  const lim = M.limitsOf(await M.settingsOf(tenant)); const use = await M.usageOf(tenant); const busy = (await inflight(tenant)) * per;
  const fit = (limit: number | null, used: number) => (limit === null ? want : Math.floor((limit - used - busy) / per + 1e-9));
  const s = await M.settingsOf(tenant);
  if (M.costMode(s)) { // 270차 #809 내부 회사: 월 실제 비용 한도(원) 안에서
    const g = await M.monthGenKrw(tenant); const each = per * g.perCreditMax;
    return Math.max(0, Math.min(want, Math.floor(((s.cost_cap_krw ?? 0) - g.krw - busy * g.perCreditMax) / each + 1e-9)));
  }
  return Math.max(0, Math.min(want, fit(lim.weeklyCredits, use.weekCredits), fit(lim.monthlyCredits, use.monthCredits)));
}

/** 참고 사진을 바깥 생성 서비스에 올림(우리 자료실 주소는 로그인이 필요해서) — 1536px 안 JPEG 로 */
async function refUrl(H: typeof import('./higgsfield'), tenant: string, refId: string, cache: Map<string, string>) {
  const hit = cache.get(refId); if (hit) return hit;
  const { libBytes } = await import('./mktVideo');
  const f = await libBytes(tenant, refId, /^image\//);
  if (!f) throw new Error('참고 사진을 읽지 못했습니다');
  const sharp = (await import('sharp')).default;
  const jpg = await sharp(f.data).rotate().resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  const up = await H.hfUploadImage(jpg, 'image/jpeg');
  if (!up.ok) throw new Error(up.error);
  cache.set(refId, up.url); return up.url;
}

/** 생성 지시문 — 참고 실사와 같은 곳·재질·빛, 새 구도 · 글자·로고 없음 · 사람은 회사 설정(생성 인물 허용)에 따라 */
export function genPrompt(o: { topic: string; refCaption: string; people: boolean; mode: 'fill' | 'regen' }) {
  const lines = [o.mode === 'regen'
    ? 'Recreate the reference photo as a clean, well-lit, sharp photorealistic photograph of the same place and scene: keep the layout, objects, materials and color mood, and fix darkness, blur and noise.'
    : 'Photorealistic photograph for a Korean brand social media card. Use the reference photo as the visual reference: the same kind of place, interior materials, lighting and color mood, but a new natural camera angle and composition.'];
  lines.push(o.people ? 'If people appear, keep them small, from behind or at a distance, with no recognizable faces.' : 'No people.');
  lines.push('No text, letters, numbers, signs with writing, logos, watermarks, frames or collage. Natural light, realistic textures, not an illustration, not a 3D render.');
  if (o.topic) lines.push(`Card topic (Korean): ${o.topic}`);
  if (o.refCaption) lines.push(`Reference photo (Korean description): ${o.refCaption}`);
  return lines.join('\n').slice(0, 1500);
}

/** 생성 결과 → 자료실(마케팅/AI 생성(실사 참고)) JPEG — 깨진 파일은 여기서 걸림 */
async function saveGen(actor: SessionUser, url: string, o: { title: string; tags: string[]; meta: Record<string, unknown>; description: string }) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`결과 내려받기 실패 ${res.status}`);
  const raw = Buffer.from(await res.arrayBuffer());
  if (raw.length > 30 * 1024 * 1024) throw new Error('결과 파일이 너무 큽니다');
  const sharp = (await import('sharp')).default;
  const data = await sharp(raw).rotate().jpeg({ quality: 90 }).toBuffer();
  const { saveGeneratedFile } = await import('./library');
  const safe = o.title.replace(/[\\/:*?"<>|\n]+/g, ' ').trim().slice(0, 70) || 'AI 생성 사진';
  const f = await saveGeneratedFile(actor, { fileName: `${safe}.jpg`, mime: 'image/jpeg', data, title: o.title, folder: GEN_FOLDER, tags: o.tags, description: o.description, source: 'ai_ref', space: 'marketing', meta: o.meta });
  return f.id;
}

const saveFill = async (id: string, f: Fill, v?: number) => {
  const sql = db();
  await sql`update mkt_contents set quality = jsonb_set(coalesce(quality, '{}'::jsonb), '{fill}', ${sql.json(f as never)}::jsonb) where id = ${id} ${v === undefined ? sql`` : sql`and current_version = ${v}`}`;
  return f;
};

/** 빈 칸 채우기 시작 — 생성 준비 안 됨·한도는 기록하지 않고 돌려줌(다음 정기 실행이 다시 봄), 빈 칸 없음·참고 실사 없음·요청 실패는 이 버전에 기록 */
export async function startFill(c: Row, by: 'auto' | 'manual'): Promise<Fill> {
  const sql = db(); const at = new Date().toISOString(); const v = c.current_version; const q = c.quality ?? {};
  const [b] = c.brand_id ? await sql<{ feed: any }[]>`select feed from mkt_brands where id = ${c.brand_id}` : [];
  const V = await import('./mktAutoVisual');
  const slots = emptySlots(c, q, V.templateReady(b));
  if (!slots.length) return saveFill(c.id, { v, status: 'none', at, by }, v);
  // 296차(로컬 10/31 레퍼런스 대조표 '피드 사진 장 절반 이상' 8/8 미통과): 사진·화면이 든 장이 전체의 절반이 될 만큼만 — 단색 표지는 사진이 있어도 1장 채움
  const pg: CardPage[] = Array.isArray(q.pages) ? q.pages : [];
  const vis = q.visual ?? {};
  const coverHas = !vis.plain && (!!vis.photoId || (Array.isArray(vis.photoIds) && vis.photoIds.length > 0) || ['phone', 'laptop'].includes(String(vis.template ?? '')));
  const total = 1 + pg.length; const have = (coverHas ? 1 : 0) + pg.filter((p) => !!p.photoId).length;
  const need = Math.max(Math.ceil(total / 2) - have, slots.includes('cover') ? 1 : 0);
  const r = await ready();
  if (!r) return { v, status: 'skipped', reason: NOT_READY, at, by };
  // 이미 절반 — 앞 판의 '채움 완료' 기록(장 수·크레딧)은 그대로 두고 이 판을 확인했다는 표시(checked)만
  if (need <= 0) return saveFill(c.id, q.fill?.status === 'done' ? { ...q.fill, checked: v } : { v, status: 'none', at, by }, v);
  const per = Number(r.m.credits) || 0;
  const n = await budgetFor(c.tenant, per, Math.min(FILL_MAX, slots.length, need));
  if (!n) return { v, status: 'skipped', reason: LIMIT, at, by, per };
  const [ver] = await sql<{ body: string }[]>`select body from mkt_versions where content_id = ${c.id} and version = ${v}`;
  const pages: CardPage[] = Array.isArray(q.pages) ? q.pages : [];
  const pool = await V.photoPool(c);
  const s = await (await import('./mktAuto')).settingsOf(c.tenant);
  const aspect = c.kind === 'story' ? '9:16' : '4:5';
  const cache = new Map<string, string>(); const jobs: FillJob[] = []; const errors: string[] = [];
  for (const slot of slots) {
    if (jobs.length >= n) break;
    const page = slot === 'cover' ? null : pages[slot];
    const first = String(ver?.body ?? '').split('\n').find((x) => x.trim()) ?? '';
    const topic = (page ? `${page.title} — ${page.body}` : `${c.title.replace(/^\s*\[시험\]\s*/, '')} — ${first}`).replace(/\s+/g, ' ').trim().slice(0, 200);
    const refs = await V.refPhotos(c, `${topic} ${c.title}`, pool);
    const ref = refs.find((x) => !jobs.some((j) => j.ref === x.id)) ?? refs[0]; // 한 글 안에서는 참고 실사를 돌려 씀(장마다 다른 그림)
    if (!ref) continue;
    try {
      const url = await refUrl(r.H, c.tenant, ref.id, cache);
      const sub = await r.H.hfSubmit({ kind: 'image', model: r.m.id, prompt: genPrompt({ topic, refCaption: ref.caption, people: !!s.allow_generated_people, mode: 'fill' }), aspect,
        idempotencyKey: uuidOf(`fill:${c.id}:v${v}:${slot}`), ref: { field: r.m.ref, url } });
      if (sub.ok) jobs.push({ slot, requestId: sub.requestId, statusUrl: sub.statusUrl, status: 'queued', ref: ref.id });
      else errors.push(sub.error);
    } catch (e: any) { errors.push(String(e?.message ?? e).slice(0, 200)); }
  }
  const error = errors.length ? errors.join(' / ').slice(0, 300) : undefined;
  if (!jobs.length) return saveFill(c.id, { v, status: errors.length ? 'failed' : 'skipped', reason: errors.length ? '사진 생성 요청이 실패했습니다 — 잠시 뒤 다시 눌러 주세요' : NO_REF, error, at, by, per, model: r.m.id }, v);
  return saveFill(c.id, { v, status: 'generating', jobs, at, by, per, model: r.m.id, ...(error ? { error } : {}) }, v);
}

/** 생성된 사진으로 그 칸만 다시 그려 새 버전 — 그사이 버전·상태가 바뀌었으면 붙이지 않음(사진은 자료실에 남음) */
async function applyFill(c: Row, f: Fill, actor: SessionUser): Promise<Fill> {
  const sql = db(); const V = await import('./mktAutoVisual');
  const stale = (reason: string): Fill => ({ ...f, status: 'stale', reason });
  const [cur] = await sql<any[]>`select current_version, status, quality from mkt_contents where id = ${c.id}`;
  if (!cur || cur.current_version !== f.v || !['pending', 'changes'].includes(cur.status)) return stale('그사이 글이 바뀌어 생성 사진을 붙이지 않았습니다(자료실에는 남아 있습니다)');
  const [ver] = await sql<{ body: string; media_ids: string[] }[]>`select body, media_ids from mkt_versions where content_id = ${c.id} and version = ${f.v}`;
  const q = cur.quality ?? {}; const pages: CardPage[] = Array.isArray(q.pages) ? JSON.parse(JSON.stringify(q.pages)) : [];
  let media = (ver?.media_ids ?? []).map(String);
  const got = (f.jobs ?? []).filter((j) => j.fileId);
  const pageJobs = got.filter((j) => j.slot !== 'cover' && pages[j.slot as number]); const coverJob = got.find((j) => j.slot === 'cover');
  if (pageJobs.length && media.length !== 1 + pages.length) return stale('장 수가 달라 생성 사진을 붙이지 못했습니다(자료실에는 남아 있습니다)');
  for (const j of pageJobs) { const p = pages[j.slot as number]; p.photoId = j.fileId!; p.gen = true; p.ref = j.ref; delete p.rel; }
  const c2 = { ...c, current_version: f.v };
  if (pageJobs.length) media = [media[0], ...(await V.drawPages(c2, pages, { keep: true, actor }))];
  let visual = { ...(q.visual ?? {}) };
  if (coverJob) {
    const d = await V.drawAutoVisual(c2, ver?.body ?? '', { photoId: coverJob.fileId!, actor });
    media[0] = d.fileId;
    visual = { ...visual, fileId: d.fileId, photoId: coverJob.fileId, gen: true, ref: coverJob.ref, ...(d.photoFix?.length ? { fix: d.photoFix } : {}), tried: [...new Set([...((visual.tried ?? []) as string[]), coverJob.fileId!])].slice(-20) };
    if (d.template) visual.template = d.template;
    if (d.plain) visual.plain = true; else delete visual.plain;
  }
  // 295차 #835: 단색 표지 때문에만 수정 요청에 있던 글은 표지 사진이 붙으면 승인 대기로
  const ps = V.plainStatus(c, q, !!visual.plain, cur.status);
  if (media.length > 1) visual.bodyIds = media.slice(1);
  const done: Fill = { ...f, status: 'done', credits: Math.round(got.length * (f.per ?? 0) * 10) / 10 };
  const v = f.v + 1;
  const ok = await sql.begin(async (tx) => {
    const [x] = await tx<{ current_version: number }[]>`select current_version from mkt_contents where id = ${c.id} for update`;
    if (!x || x.current_version !== f.v) return false;
    await tx`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, ${v}, ${ver?.body ?? ''}, ${media},
      ${`실사 참고 생성 ${got.length}장으로 빈 사진 칸을 채웠습니다(서버 그리기)${pageJobs.length ? ` ${V.photoNote(pages)}` : ''}`}, ${actor.id})`;
    const quality = { ...q, ...(pageJobs.length ? { pages } : {}), visual, fill: done, issues: ps.issues, passed: ps.passed, ...(q.report ? { report: { ...q.report, v } } : {}) };
    await tx`update mkt_contents set current_version = ${v}, status = ${ps.status}, quality = ${tx.json(quality as never)}, reminded_at = null, updated_at = now() where id = ${c.id}`;
    return true;
  });
  if (ok && ps.status === 'pending' && cur.status === 'changes') {
    const M = await import('./mktAuto');
    await M.mktNotify(sql, c, null, { approval: true, type: 'review_requested', title: `표지 사진을 채웠습니다(v${v}): ${c.title}`, body: '단색 바탕 표지를 같은 브랜드 실사를 참고해 만든 사진 표지로 바꿨습니다 — 승인해 주세요',
      link: `/s/marketing/approvals?c=${c.id}`, entityType: 'mkt_content', entityId: c.id, dedupeKey: `mktfill:${c.id}:${v}` }).catch(() => {});
  }
  return ok ? done : stale('그사이 글이 바뀌어 생성 사진을 붙이지 않았습니다(자료실에는 남아 있습니다)');
}

/** 진행 중인 빈 칸 채우기 확인 — 완료분 저장·원장, 다 끝나면 붙임 */
async function pollFill(c: Row): Promise<Fill> {
  const sql = db(); const f: Fill = JSON.parse(JSON.stringify(c.quality.fill));
  const H = await import('./higgsfield'); const V = await import('./mktAutoVisual');
  const old = Date.now() - new Date(f.at).getTime() > TIMEOUT_MIN * 60000;
  const [b] = c.brand_id ? await sql<{ name: string }[]>`select name from mkt_brands where id = ${c.brand_id}` : [];
  const brand = String(b?.name ?? '').replace(/^\s*\[시험\]\s*/, '').trim();
  let actor: SessionUser | null = null;
  for (const j of f.jobs ?? []) {
    if (TERMINAL.has(j.status)) continue;
    const st = await H.hfStatus(j.requestId, j.statusUrl);
    if (!st.ok) { if (!st.retry || old) { j.status = st.retry ? 'timeout' : 'failed'; j.error = st.error; } continue; }
    if (st.status === 'completed') {
      try {
        if (!st.urls[0]) throw new Error('완료됐지만 결과 주소가 없음');
        actor ??= await V.actorOf(c);
        if (!actor) throw new Error('저장할 계정이 없습니다');
        const [rf] = await sql<{ title: string }[]>`select coalesce(nullif(title, ''), file_name) as title from library_files where id = ${j.ref}`;
        const where = j.slot === 'cover' ? '표지' : `${(j.slot as number) + 2}장`;
        j.fileId = await saveGen(actor, st.urls[0], { title: `${brand ? `${brand} ` : ''}${c.title.replace(/^\s*\[시험\]\s*/, '').slice(0, 30)} ${where} — AI 생성(실사 참고)`,
          tags: ['AI 생성', '실사 참고', '글자없음', ...(brand ? [brand] : [])], description: `실사 참고 생성 — 참고: ${rf?.title ?? '같은 브랜드 실사'}`,
          meta: { gen: { kind: 'fill', ref: j.ref, contentId: c.id, slot: j.slot, model: f.model ?? null } } });
        j.status = 'completed';
        await sql`insert into mkt_credit_ledger (tenant, content_id, version, kind, credits, note, created_by, title) values (${c.tenant}, ${c.id}, ${f.v}, 'generate_image', ${f.per ?? 0},
          ${`실사 참고 생성(${where})`}, ${actor.id}, ${c.title})`;
      } catch (e: any) { j.status = 'failed'; j.error = String(e?.message ?? e).slice(0, 200); }
    } else if (H.HF_TERMINAL.has(st.status)) { j.status = st.status; j.error = st.error ?? `생성 ${st.status}`; }
    else if (old) { j.status = 'timeout'; j.error = `${TIMEOUT_MIN}분 안에 끝나지 않음`; }
    else j.status = st.status;
  }
  if (!(f.jobs ?? []).every((j) => TERMINAL.has(j.status))) return saveFill(c.id, f);
  if (!(f.jobs ?? []).some((j) => j.fileId)) return saveFill(c.id, { ...f, status: 'failed', reason: '사진을 만들지 못했습니다 — 잠시 뒤 다시 눌러 주세요', error: (f.jobs ?? []).map((j) => j.error).filter(Boolean).join(' / ').slice(0, 300) });
  actor ??= await V.actorOf(c);
  if (!actor) return saveFill(c.id, { ...f, status: 'failed', reason: '저장할 계정이 없습니다' });
  const out = await applyFill(c, f, actor);
  return out.status === 'done' ? out : saveFill(c.id, out);
}

/** #621 [AI로 다시 만들기]: 관리자 · 자료실 사진 후보 안의 사진 · AI 설명이 있고 얼굴이 안 보이는 사진만(바깥 서비스로 보내므로) · 한도 안 */
export async function startRegen(u: SessionUser, fileId: string) {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('AI로 다시 만들기는 관리자만 할 수 있습니다');
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw notFound('사진을 찾을 수 없습니다');
  const sql = db(); const t = tenantOf(u); const { poolCond } = await import('./mktPhotos');
  const [f] = await sql<any[]>`select id, title, file_name, vision, meta, source from library_files where id = ${fileId} and ${poolCond(sql, t)}`;
  if (!f) throw notFound('사진을 찾을 수 없습니다');
  if (f.source === 'ai_ref') throw badRequest('생성한 사진은 다시 만들지 않습니다');
  if (!visionOk(f.vision)) throw badRequest('AI 설명이 끝난 사진만 다시 만들 수 있습니다');
  if ((f.vision as { faces?: boolean }).faces) throw badRequest('얼굴이 보이는 사진은 바깥으로 보내지 않아 다시 만들 수 없습니다');
  if (f.meta?.regen?.status === 'generating') throw badRequest('이미 다시 만드는 중입니다');
  const r = await ready();
  if (!r) throw badRequest(NOT_READY);
  const per = Number(r.m.credits) || 0;
  if (!(await budgetFor(t, per, 1))) throw badRequest(LIMIT);
  const { libBytes } = await import('./mktVideo');
  const raw = await libBytes(t, f.id, /^image\//);
  if (!raw) throw badRequest('사진 파일을 읽지 못했습니다');
  const meta = await (await import('sharp')).default(raw.data).metadata().catch(() => null);
  const [w, h] = (meta?.orientation ?? 1) >= 5 ? [meta?.height ?? 1, meta?.width ?? 1] : [meta?.width ?? 1, meta?.height ?? 1];
  const ratio = (a: string) => { const [x, y] = a.split(':').map(Number); return x / y; };
  const aspect = ['1:1', '4:5', '3:4', '2:3', '9:16', '5:4', '4:3', '3:2', '16:9'].reduce((best, a) => (Math.abs(Math.log(ratio(a) / (w / h))) < Math.abs(Math.log(ratio(best) / (w / h))) ? a : best), '1:1');
  const s = await (await import('./mktAuto')).settingsOf(t);
  let sub: Awaited<ReturnType<typeof r.H.hfSubmit>>;
  try {
    const url = await refUrl(r.H, t, f.id, new Map());
    sub = await r.H.hfSubmit({ kind: 'image', model: r.m.id, prompt: genPrompt({ topic: '', refCaption: (f.vision as { caption: string }).caption, people: !!s.allow_generated_people, mode: 'regen' }), aspect,
      idempotencyKey: uuidOf(`regen:${f.id}:${Date.now()}`), ref: { field: r.m.ref, url } });
  } catch (e: any) { sub = { ok: false, error: String(e?.message ?? e).slice(0, 200) }; }
  if (!sub.ok) {
    await sql`update library_files set meta = coalesce(meta, '{}'::jsonb) || ${sql.json({ regen: { status: 'failed', error: sub.error.slice(0, 300), at: new Date().toISOString() } } as never)} where id = ${f.id}`;
    throw badRequest('사진 생성 요청이 실패했습니다 — 잠시 뒤 다시 눌러 주세요');
  }
  await sql`update library_files set meta = coalesce(meta, '{}'::jsonb) || ${sql.json({ regen: { status: 'generating', requestId: sub.requestId, statusUrl: sub.statusUrl, model: r.m.id, per, at: new Date().toISOString(), by: u.id } } as never)} where id = ${f.id}`;
  await audit(sql, u.id, 'mkt.photo_regen', 'library_file', f.id, {}).catch(() => {});
  return { status: 'generating' as const };
}

/** 진행 중인 다시 만들기 확인 — 완료면 새 사진(ai_ref, meta.gen.ref = 원본) 저장·원장, 원본 meta.regen = done(새 사진 id) */
async function pollRegen(f: { id: string; tenant: string; title: string; tags: string[] | null; meta: any }) {
  const sql = db(); const H = await import('./higgsfield'); const g = f.meta.regen;
  const old = Date.now() - new Date(g.at).getTime() > TIMEOUT_MIN * 60000;
  const set = (regen: Record<string, unknown>) => sql`update library_files set meta = coalesce(meta, '{}'::jsonb) || ${sql.json({ regen } as never)} where id = ${f.id}`;
  const st = await H.hfStatus(g.requestId, g.statusUrl);
  if (!st.ok) { if (!st.retry || old) await set({ ...g, status: 'failed', error: st.error }); return; }
  if (st.status === 'completed') {
    try {
      if (!st.urls[0]) throw new Error('완료됐지만 결과 주소가 없음');
      const actor = await (await import('./mktStudio')).actorFor(g.by);
      const keep = (f.tags ?? []).filter((x) => !['쓰지않음', '글자있음'].includes(x));
      const id = await saveGen(actor, st.urls[0], { title: `${String(f.title).replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 60)} — AI로 다시 만든 사진`, tags: [...new Set([...keep, 'AI 생성', '실사 참고', '글자없음'])],
        description: `AI로 다시 만든 사진 — 원본: ${f.title}`, meta: { gen: { kind: 'regen', ref: f.id, model: g.model ?? null } } });
      await sql`insert into mkt_credit_ledger (tenant, content_id, version, kind, credits, note, created_by, title) values (${f.tenant}, null, null, 'generate_image', ${g.per ?? 0}, ${'AI로 다시 만들기(사진)'}, ${actor.id}, ${f.title})`;
      await set({ status: 'done', fileId: id, at: new Date().toISOString(), by: g.by });
    } catch (e: any) { await set({ ...g, status: 'failed', error: String(e?.message ?? e).slice(0, 200) }); }
  } else if (H.HF_TERMINAL.has(st.status)) await set({ ...g, status: 'failed', error: st.error ?? `생성 ${st.status}` });
  else if (old) await set({ ...g, status: 'failed', error: `${TIMEOUT_MIN}분 안에 끝나지 않음` });
}

/** 정기 실행: ① 진행 중 확인(빈 칸 채우기·다시 만들기) ② 회사 설정 photo_gen(일시정지 아님)인 회사의 빈 칸 있는 승인 대기·수정 요청 시안에 채우기 시작 */
export async function photoFillTick(o: { tenant?: string; limit?: number; budgetMs?: number } = {}) {
  const sql = db(); const t0 = Date.now(); const budget = o.budgetMs ?? 60000; const L = await import('./later');
  const tf = o.tenant ? sql`and c.tenant = ${o.tenant}` : sql``;
  const gen = await sql<Row[]>`select ${sql.unsafe(COLS)} from mkt_contents c where c.quality->'fill'->>'status' = 'generating' ${tf} order by c.updated_at limit 10`;
  let polled = 0;
  for (const c of gen) { if (Date.now() - t0 > budget) break; await L.withLock(`mktFill:${c.id}`, () => pollFill(c)); polled++; }
  const regens = await sql<any[]>`select id, tenant, coalesce(nullif(title, ''), file_name) as title, tags, meta from library_files where meta->'regen'->>'status' = 'generating' ${o.tenant ? sql`and tenant = ${o.tenant}` : sql``} order by created_at limit 5`;
  for (const f of regens) { if (Date.now() - t0 > budget) break; await L.withLock(`mktRegen:${f.id}`, () => pollRegen(f)); }
  let started = 0; const skipped: Record<string, number> = {};
  if (await ready()) {
    const cand = await sql<Row[]>`select ${sql.unsafe(COLS)} from mkt_contents c join mkt_settings s on s.tenant = c.tenant and s.photo_gen and not coalesce(s.auto_pause, false)
      where c.status in ('pending', 'changes') and not coalesce(c.is_test, false) and c.channel <> 'blog' and c.kind in ('feed', 'story') and c.quality->'visual'->>'by' = 'server'
        and (c.quality->'fill' is null or (c.quality->'visual'->>'plain' = 'true' and coalesce((c.quality->'fill'->>'v')::int, 0) < c.current_version and c.quality->'fill'->>'status' <> 'generating') -- 295차 #835: 단색 표지는 예전 판에서 채웠어도 새 판에서 한 번 더
          or (c.quality->'fill'->>'status' in ('done', 'none') and coalesce((c.quality->'fill'->>'checked')::int, (c.quality->'fill'->>'v')::int, 0) < c.current_version)) -- 296차: 새 판에서 사진 장이 아직 절반이 안 되면 더 채움(절반이면 'none'·checked 로 끝)
        and (c.scheduled_at is null or c.scheduled_at > now() + interval '2 hours' or c.scheduled_at < now()) ${tf} -- 297차: 게시 예정이 지난 승인 대기 글도(승인 전이라 바로 게시되지 않음) — 막는 건 게시 직전 2시간만
      order by c.scheduled_at nulls last limit ${o.limit ?? 3}`;
    for (const c of cand) {
      if (Date.now() - t0 > budget) break;
      const f = await L.withLock(`mktFill:${c.id}`, () => startFill(c, 'auto'));
      if ('status' in f && f.status === 'generating') started++;
      // 296차(로컬 10/31 18:10 '채우기가 한 장도 안 돎'): 한도·준비 안 됨처럼 기록하지 않는 건너뜀도 정기 실행 결과(job_runs)에 까닭별로 남김
      else if ('status' in f && f.status) { const k = `${f.status}${f.reason ? `: ${f.reason}` : ''}`; skipped[k] = (skipped[k] ?? 0) + 1; }
    }
  } else skipped['준비 안 됨(생성 연동 꺼짐·참고 사진 모델 없음)'] = 1;
  // 297차(로컬 10/31 18:25 '크레딧 여유인데 0장'): 대기 글(피드·스토리)이 왜 후보가 아닌지 — 채우기 기록 상태·이 판 여부·회사 설정·게시 직전별 수
  const pool = await sql<{ k: string; n: number }[]>`select concat_ws(' · ', case when not coalesce(s.photo_gen, false) then '회사 설정 꺼짐' when coalesce(s.auto_pause, false) then '자동 제작 멈춤' end,
      case when c.quality->'visual'->>'by' is distinct from 'server' then '사람이 붙인 시안' end,
      case when c.scheduled_at between now() and now() + interval '2 hours' then '게시 2시간 안' end,
      coalesce(c.quality->'fill'->>'status', '기록 없음') || case when c.quality->'fill' is null then '' when coalesce((c.quality->'fill'->>'checked')::int, (c.quality->'fill'->>'v')::int, 0) >= c.current_version then '(이 판)' else '(앞 판)' end,
      case when c.quality->'visual'->>'plain' = 'true' then '단색 표지' end) as k, count(*)::int as n
    from mkt_contents c left join mkt_settings s on s.tenant = c.tenant
    where c.status in ('pending', 'changes') and not coalesce(c.is_test, false) and c.channel <> 'blog' and c.kind in ('feed', 'story') ${tf}
    group by 1 order by 2 desc limit 12`.catch(() => []);
  return { polled, regens: regens.length, started, ...(Object.keys(skipped).length ? { skipped } : {}), ...(pool.length ? { pool: Object.fromEntries(pool.map((r) => [r.k, r.n])) } : {}) };
}

/** 상세 화면용(고객사에도 보임 — 서비스 이름·모델·원인 문장은 빼고 상태·까닭·장 수만) */
export async function fillView(u: SessionUser, c: { id: string; kind: string | null; channel: string; brand_id: string | null; status: string; quality: any }) {
  const f: Fill | undefined = c.quality?.fill;
  const [b] = c.brand_id ? await db()<{ feed: any }[]>`select feed from mkt_brands where id = ${c.brand_id}` : [];
  const empty = c.quality?.visual?.by === 'server' ? emptySlots(c, c.quality, (await import('./mktAutoVisual')).templateReady(b)).length : 0;
  const busy = f?.status === 'generating';
  return { status: f?.status ?? null, reason: f?.reason ?? null, total: f?.jobs?.length ?? 0, made: (f?.jobs ?? []).filter((j) => j.fileId).length, credits: f?.credits ?? null, by: f?.by ?? null,
    empty, canStart: isAdmin(u) && !busy && empty > 0 && ['pending', 'changes'].includes(c.status),
    // #602 모델·요청 오류 원문은 슈퍼관리자·우리 회사만
    ...(seesInternals(u) && f ? { detail: { model: f.model ?? null, error: f.error ?? null, jobs: (f.jobs ?? []).map((j) => ({ slot: j.slot, status: j.status, error: j.error ?? null })) } } : {}) };
}

/** 관리자 [빈 칸 생성으로 채우기]·[다시 확인] — 회사 설정과 상관없이 이 글만(한도는 그대로) */
export async function fillAction(u: SessionUser, id: string, action: 'start' | 'check') {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('빈 칸 생성은 관리자만 할 수 있습니다');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('콘텐츠를 찾을 수 없습니다');
  const sql = db(); const L = await import('./later');
  const [c] = await sql<Row[]>`select ${sql.unsafe(COLS)} from mkt_contents c where c.id = ${id} and c.tenant = ${tenantOf(u)}`;
  if (!c) throw notFound('콘텐츠를 찾을 수 없습니다');
  if (action === 'check') { if (c.quality?.fill?.status === 'generating') await L.withLock(`mktFill:${c.id}`, () => pollFill(c)); }
  else {
    if (!['pending', 'changes'].includes(c.status)) throw badRequest('승인 대기·수정 요청 글만 채울 수 있습니다');
    if (c.quality?.visual?.by !== 'server') throw badRequest('서버가 그린 시안만 채울 수 있습니다');
    if (c.quality?.fill?.status === 'generating') throw badRequest('이미 생성 중입니다');
    const r = await L.withLock(`mktFill:${c.id}`, () => startFill({ ...c, quality: { ...(c.quality ?? {}), fill: undefined } }, 'manual'));
    if ('busy' in r) throw badRequest('이미 생성 중입니다');
    if (r.status === 'skipped' && r.reason) throw badRequest(r.reason);
    if (r.status === 'generating') await audit(sql, u.id, 'mkt.photo_fill', 'mkt_content', c.id, { slots: (r.jobs ?? []).map((j) => j.slot) }).catch(() => {});
  }
  const [n] = await sql<Row[]>`select ${sql.unsafe(COLS)} from mkt_contents c where c.id = ${id}`;
  return fillView(u, n);
}
