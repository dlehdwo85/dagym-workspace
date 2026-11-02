// 329차(대표 11/02 결정 ⓑ·2 — "글마다 확인하게 하고, 최종 검수가 끝나야만 대표자에게 승인대기실에 요청" · "모든 문구와 사진들은 어느 정도 매칭해야 한다 — 시설·수업 이름·장면까지 장마다"):
// 글의 표지·장·본문 사진마다 사진 쪽 글(자료실 이름·태그·설명·사진 AI 설명)과 그 칸의 글을 빠른 모델이 글로만 대조(사진 자체는 안 보냄 — 글당 몇 원) →
// 맞음(ok)·무난함(weak)·안 맞음(mismatch). 안 맞음이 하나라도 있으면 승인 대기 대신 수정 요청(사유 줄) + 그 브랜드 자료 요청. 대조 중(pending)인 글은 승인할 시안에서 빠지고 [승인]도 막힘.
// 흐름: 자동 제작(produceContent)은 원고를 저장하며 '대조 중' 표시 → 바로 대조 · 사람·자동이 새 판을 붙이면(addVersion) '대조 중' → 정기 실행이 대조 ·
//       대조 표시 없는 승인 대기 글(예전 글·다른 경로)도 정기 실행이 한 번 대조. 끄기: MKT_PHOTO_AUDIT=off(시험 서버 기본) · AI 비서 꺼짐·대조할 사진 없음·AI 한도면 '건너뜀'으로 통과(막지 않음) · AI 오류는 3번까지 다시, 그 뒤 통과
import { db } from './db';
import { visionOk } from './mktPhotos';

export type AuditVerdict = 'ok' | 'weak' | 'mismatch';
export type AuditSlot = { where: string; text: string; photoId: string };
export type PhotoAuditRow = { where: string; photoId: string; title: string | null; verdict: AuditVerdict; why: string };
export type PhotoAudit = { v: 1; at: string; version: number; passed: boolean; rows: PhotoAuditRow[]; model?: string; skipped?: string; pending?: boolean; tries?: number; error?: string };
export const AUDIT_PREFIX = 'AI 사진·글 대조 미통과';
export const VERDICT_LABEL: Record<AuditVerdict, string> = { ok: '맞음', weak: '무난함', mismatch: '안 맞음' };
export const auditOn = () => process.env.MKT_PHOTO_AUDIT !== 'off';
/** 333차(로컬 329차 확인 ⓐ): 사진이 없어 대조를 건너뛴 글도 기록에 한 줄 — 승인함에서 '대조 통과'와 '건너뜀(영상/사진 없음)'을 구분 */
export const skippedAudit = (version: number, skipped: string): PhotoAudit => ({ v: 1, at: new Date().toISOString(), version, passed: true, rows: [], skipped });
export const SKIP_VIDEO = '영상 글 — 대조할 사진 없음(장면은 영상 기록으로)';
export const SKIP_NO_PHOTO = '사진 없음 — 시안이 붙으면 대조';
/** 제작 직후 붙은 파일이 없을 때 사유: 영상 글이면 '영상 글', 아니면 '사진 없음' */
export const skipReasonFor = (kind: string | null | undefined) => (['reels', 'shorts', 'video'].includes(kind ?? '') ? SKIP_VIDEO : SKIP_NO_PHOTO);
export const auditIssue = (a: PhotoAudit) => `${AUDIT_PREFIX} — ${a.rows.filter((r) => r.verdict === 'mismatch').map((r) => `${r.where}: ${r.why || '사진이 글과 다른 내용'}`).join(' · ')}(사진을 바꾸거나 글에 맞는 사진을 올린 뒤 다시 그리기)`;
const UUID = /^[0-9a-f-]{36}$/i;
const firstLine = (body: string) => body.split('\n').map((l) => l.trim()).find((l) => l && !/^#/.test(l)) ?? '';
/** 블로그 본문 사진 k 번째 칸의 글: '[사진 k]' 표시 다음 문단, 없으면 본문 앞부분 */
function bodyExcerpt(body: string, k: number) {
  const m = body.split(new RegExp(`\\[사진\\s*${k + 1}\\]`));
  const seg = m.length > 1 ? m[1] : body;
  return seg.replace(/\[사진\s*\d+\]/g, ' ').trim().slice(0, 400);
}
type C = { id: string; tenant: string; title: string; channel: string; kind?: string | null; created_by?: string | null; brand_id?: string | null; is_test?: boolean | null; quality?: any; status: string; current_version: number };
/** 대조할 칸: 서버가 그린 시안이면 표지·장·본문 사진(시안 기록 photoRecord 와 같은 이름), 사람이 붙인 시안이면 이미지 파일 자체(최대 6장) */
export async function slotsOf(c: Pick<C, 'title' | 'quality'>, body: string, mediaIds: string[]): Promise<AuditSlot[]> {
  const q = c.quality ?? {}; const vis = q.visual; const pages: { title?: string; body?: string; photoId?: string | null }[] = Array.isArray(q.pages) ? q.pages : [];
  const head = `${c.title}\n${firstLine(body)}`.trim();
  const out: AuditSlot[] = [];
  if (vis?.by === 'server') {
    const coverIds: string[] = Array.isArray(vis.photoIds) && vis.photoIds.length ? vis.photoIds.map(String) : vis.photoId ? [String(vis.photoId)] : [];
    coverIds.forEach((id, k) => out.push({ where: coverIds.length > 1 ? `표지 사진 ${k + 1}` : '표지', text: head, photoId: id }));
    pages.forEach((p, k) => { if (p.photoId) out.push({ where: `${k + 2}장`, text: `${p.title ?? ''}\n${p.body ?? ''}`.trim(), photoId: String(p.photoId) }); });
    (Array.isArray(vis.bodyIds) ? vis.bodyIds : []).forEach((id: unknown, k: number) => out.push({ where: `본문 사진 ${k + 1}`, text: bodyExcerpt(body, k), photoId: String(id) }));
  } else {
    mediaIds.slice(0, 6).forEach((id, k) => out.push({ where: `시안 ${k + 1}`, text: `${head}\n${body.slice(0, 300)}`.trim(), photoId: id }));
  }
  return out.filter((s) => UUID.test(s.photoId));
}
async function photoTexts(tenant: string, ids: string[]) {
  const rows = ids.length ? await db()<{ id: string; title: string; mime: string; tags: string[] | null; description: string | null; vision: unknown; folder: string | null }[]>`select id::text, coalesce(nullif(title, ''), file_name) as title, mime_type as mime, tags, description, vision, folder
    from library_files where id = any(${ids}::uuid[]) and tenant = ${tenant}` : [];
  const m = new Map<string, { title: string; text: string; image: boolean }>();
  for (const r of rows) {
    const v = visionOk(r.vision) ? `AI 설명: ${r.vision.caption} / ${r.vision.scene} / 태그 ${r.vision.tags.join(' ')}${r.vision.seen ? ` / 보이는 글자 ${r.vision.seen}` : ''}` : '';
    m.set(r.id, { title: r.title, image: /^image\//.test(r.mime), text: [`이름 ${r.title}`, r.folder ? `폴더 ${r.folder}` : '', r.tags?.length ? `태그 ${r.tags.join(' ')}` : '', r.description ? `설명 ${r.description}` : '', v].filter(Boolean).join(' · ').slice(0, 700) });
  }
  return m;
}
const SYSTEM = `MKT_PHOTO_AUDIT
너는 SNS 게시물 검수자다. 게시물의 칸(표지·카드뉴스 장·본문 사진)마다 그 칸의 글과 그 칸에 깐 사진의 설명(자료실 이름·태그·설명·사진 AI 설명)을 대조해 판정한다. 사진 자체는 볼 수 없고 설명만 본다.
판정: ok = 글과 사진이 맞음(같은 시설·같은 수업·같은 장면·같은 업종) · weak = 사진이 일반적인 공간·기구·사람이라 글과 어긋나지 않음(허용) · mismatch = 사진이 글과 다른 것을 보여 줌 — 다른 시설(헬스장 글에 카페·주차장), 다른 수업(요가 글에 스피닝·필라테스), 다른 장면(상담 글에 청소), 다른 업종·다른 브랜드 제품.
글에 수업 이름(요가·필라테스·스피닝·줌바·크로스핏·PT 등)이나 장면(출입·상담·청소·결제·라커 등)이 있으면 사진이 그와 같아야 ok 다. 설명이 짧아 알 수 없으면 weak. 브랜드 이름·분위기·색감 차이는 mismatch 가 아니다.
why 는 한국어 40자 안, 근거만. 모든 칸에 대해 verdicts 에 하나씩, where 는 받은 그대로.`;
const FORMAT = { type: 'object', additionalProperties: false, required: ['verdicts'], properties: { verdicts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['where', 'verdict', 'why'],
  properties: { where: { type: 'string' }, verdict: { type: 'string', enum: ['ok', 'weak', 'mismatch'] }, why: { type: 'string' } } } } } };
/** 칸마다 글 ↔ 사진 설명 대조(빠른 모델, 글만) — 호출 1번에 모든 칸 */
export async function auditPhotos(c: Pick<C, 'id' | 'tenant' | 'title' | 'kind' | 'channel' | 'created_by'>, version: number, slots: AuditSlot[]): Promise<PhotoAudit> {
  const base = { v: 1 as const, at: new Date().toISOString(), version };
  if (!auditOn()) return { ...base, passed: true, rows: [], skipped: '대조 끔(MKT_PHOTO_AUDIT=off)' };
  const P = await import('./ai/provider');
  if (!P.aiEnabled()) return { ...base, passed: true, rows: [], skipped: 'AI 비서 꺼짐' };
  const info = await photoTexts(c.tenant, [...new Set(slots.map((s) => s.photoId))]);
  const use = slots.filter((s) => info.get(s.photoId)?.image);
  // 333차: 영상·문서만 붙은 글(영상형)은 '영상 글 — 대조할 사진 없음', 아무것도 없으면 '사진 없음' — 승인함 칩에서 구분
  if (!use.length) return { ...base, passed: true, rows: [], skipped: slots.length && [...info.values()].some((x) => !x.image) ? SKIP_VIDEO : slots.length ? '대조할 사진 없음(자료실에서 지워짐)' : skipReasonFor(c.kind) };
  const A = await import('./mktAuto');
  try { await A.assertMktAi(c.tenant); } catch (e: any) { return { ...base, passed: true, rows: [], skipped: `AI 한도: ${String(e?.message ?? e).slice(0, 120)}` }; }
  const p = P.anthropicProvider({ tier: 'fast', maxTokens: 1200 });
  const r = await p.chat({ system: SYSTEM, messages: [{ role: 'user', content: JSON.stringify({ post: { title: c.title, kind: c.kind ?? null, channel: c.channel }, slots: use.map((s) => ({ where: s.where, text: s.text.slice(0, 500), photo: info.get(s.photoId)!.text })) }) }], tools: [], format: FORMAT });
  await A.logAi({ tenant: c.tenant, created_by: c.created_by ?? null, id: c.id }, p, r, P, 'marketing_photo_audit').catch(() => {}); // 333차 ⓑ: 사용량 '사진·글 AI 대조' 줄로 따로
  let parsed: { verdicts?: { where?: string; verdict?: string; why?: string }[] } = {};
  try { parsed = JSON.parse(A.textOf(r)); } catch { /* 모양이 깨지면 전부 무난함 */ }
  const by = new Map((parsed.verdicts ?? []).map((v) => [String(v.where ?? ''), v]));
  const rows: PhotoAuditRow[] = use.map((s) => { const v = by.get(s.where); const verdict = (['ok', 'weak', 'mismatch'] as const).find((x) => x === v?.verdict) ?? 'weak'; return { where: s.where, photoId: s.photoId, title: info.get(s.photoId)?.title ?? null, verdict, why: String(v?.why ?? '').slice(0, 80) }; });
  return { ...base, passed: !rows.some((x) => x.verdict === 'mismatch'), rows, model: r.model ?? p.model };
}
/** 글 하나를 대조해 결과를 quality.photoAudit 에 쓰고 상태를 맞춤: 승인 대기 + 안 맞음 → 수정 요청(사유 줄·알림·자료 요청) · 초안(주 묶음)은 묶음 상태만 · AI 오류는 '대조 중' 그대로(3번까지) */
export async function auditContent(id: string, opt: { quiet?: boolean } = {}): Promise<PhotoAudit | { pending: true; tries: number } | null> {
  const sql = db();
  const [c] = await sql<(C & { body: string | null; media_ids: string[] | null })[]>`select c.id, c.tenant, c.title, c.channel, c.kind, c.status, c.quality, c.current_version, c.created_by, c.brand_id, c.is_test, v.body, v.media_ids
    from mkt_contents c left join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${id} and c.deleted_at is null`;
  if (!c) return null;
  const prev: Partial<PhotoAudit> = c.quality?.photoAudit ?? {};
  const slots = await slotsOf(c, c.body ?? '', c.media_ids ?? []);
  let audit: PhotoAudit;
  try { audit = await auditPhotos(c, c.current_version, slots); }
  catch (e: any) {
    const tries = (Number(prev.tries) || 0) + 1; const error = String(e?.message ?? e).slice(0, 160);
    if (tries < 3) { await sql`update mkt_contents set quality = coalesce(quality, '{}'::jsonb) || ${sql.json({ photoAudit: { v: 1, at: new Date().toISOString(), version: c.current_version, pending: true, tries, error } } as never)} where id = ${id}`; return { pending: true, tries }; }
    audit = { v: 1, at: new Date().toISOString(), version: c.current_version, passed: true, rows: [], skipped: `AI 대조 못 함(3번 시도) — ${error}` };
  }
  const q = c.quality ?? {};
  const rest = ((q.issues ?? []) as string[]).filter((x) => !x.startsWith(AUDIT_PREFIX));
  const line = audit.passed ? null : auditIssue(audit);
  const issues = line ? [...rest, line] : rest;
  const passed = issues.length === 0;
  const toChanges = c.status === 'pending' && !!line;
  const batch = q.batch ? { ...q.batch, status: line ? 'changes' : passed ? 'pending' : q.batch.status } : undefined;
  await sql`update mkt_contents set status = ${toChanges ? 'changes' : c.status}, quality = (coalesce(quality, '{}'::jsonb) - 'photoAudit') || ${sql.json({ photoAudit: audit, passed, issues, ...(batch ? { batch } : {}) } as never)}, updated_at = now() where id = ${id}`;
  if (line && !c.is_test) {
    if (!opt.quiet) await (await import('./mktAuto')).mktNotify(sql, c, null, { approval: true, type: 'review_requested', title: `사진·글 대조 미통과: ${c.title}`, body: line, link: `/s/marketing/approvals?c=${c.id}`, entityType: 'mkt_content', entityId: c.id, dedupeKey: `mktaudit:${c.id}:${c.current_version}` }).catch(() => {});
    await (await import('./mktMaterials')).needMaterial({ ...c, brand_id: c.brand_id ?? null }, `글과 맞는 사진이 없어 AI 사진·글 대조에서 막혔습니다 — ${audit.rows.filter((r) => r.verdict === 'mismatch').map((r) => r.where).join('·')} 칸에 맞는 실사`).catch(() => null);
  }
  return audit;
}
/** 정기 실행: '대조 중' 표시 글 + 대조 표시가 이 판이 아닌 승인 대기 글(예전 글·다른 경로) — 한 번에 8건 */
export async function auditPendingTick(max = 8) {
  if (!auditOn()) return { skipped: 'off' };
  const sql = db();
  const rows = await sql<{ id: string }[]>`select id from mkt_contents where deleted_at is null and not is_test and status in ('pending', 'draft', 'changes')
    and (quality->'photoAudit'->>'pending' = 'true' or (status = 'pending' and current_version > 0 and coalesce((quality->'photoAudit'->>'version')::int, -1) <> current_version))
    order by (quality->'photoAudit'->>'pending' = 'true') desc nulls last, updated_at limit ${max}`;
  let done = 0, failed = 0, pending = 0;
  for (const r of rows) {
    const a = await auditContent(r.id).catch(() => null);
    if (!a) continue;
    if ('pending' in a && a.pending) pending++; else if ('passed' in a && !a.passed) failed++; else done++;
  }
  return { checked: rows.length, done, failed, pending };
}
