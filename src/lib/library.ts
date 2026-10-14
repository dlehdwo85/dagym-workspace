import { z } from 'zod';
import { db } from './db';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { isAdmin, denyDemo } from './access';
import { activity } from './log';
import { MAX_UPLOAD_BYTES, downloadUrl, getObject, objectSize, putObject, uploadTarget } from './storage';
import { extractText } from './textExtract';
import type { Role, SessionUser } from './types';
import { RANK, menuLevel, requireMenu } from './menuPerms';

/**
 * V9 회사 자료실: 로고·소개서·단가표·보고서. 업무 첨부와 같은 저장소(S3 호환/로컬)를 쓰고, 저장 키에 고객 회사(tenant)가 들어간다.
 * V13 4번 권한: 메뉴 권한(자료실: 보기 / 올리기·수정 / 삭제) × 폴더 권한(가까운 상위 폴더 설정을 상속, 메뉴 권한보다 넓힐 수 없음).
 * 내려받기 주소 발급·AI 비서 검색·읽기 모두 listLibrary / loadLibraryFile 을 거치므로 같은 검사를 받는다.
 */
export { tenantOf } from './types';
import { tenantOf } from './types';
const BLOCKED_EXT = /\.(exe|bat|cmd|com|msi|scr|ps1|vbs|jar|apk|ipa|dll|sh)$/i;
const cleanFolder = (f?: string | null) => (f ?? '').split('/').map((s) => s.trim()).filter(Boolean).join('/').slice(0, 200);

export const libraryInput = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().max(100).optional(),
  size: z.number().int().positive(),
  title: z.string().trim().max(200).optional(),
  folder: z.string().max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  description: z.string().max(2000).optional(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), // V13 3번 중복 감지
  allowDuplicate: z.boolean().optional(),
  purpose: z.enum(['revenue', 'ai_attach']).optional(), // revenue: 매출 근거 폴더 / ai_attach: AI 에게 줄 첨부(자동 정리 생략 — AI 요청 1회 아낌)
});
export const libraryPatch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  folder: z.string().max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  description: z.string().max(2000).nullable().optional(),
});

const COLS = `f.id, f.folder, f.title, f.file_name, f.mime_type, f.size_bytes, f.tags, f.description, f.upload_status, f.created_at, f.updated_at, f.created_by,
  (f.text_content is not null) as has_text, f.organized_by, f.ai_confidence, f.needs_review, (f.ai_prev is not null) as can_undo, f.organize_status, f.organize_error`;

// ---------------- V13 4번 폴더 권한 ----------------
type FolderPerm = { folder: string; role: string; level: string };
const folderPerms = (u: SessionUser) => db()<FolderPerm[]>`select folder, role, level from library_folder_perms where tenant = ${tenantOf(u)}`;
/** 폴더에 대한 실제 단계: 대표는 전부, 나머지는 min(메뉴 단계, 가장 가까운 상위 폴더 설정) */
function folderLevelOf(role: Role, base: string, perms: FolderPerm[], folder: string) {
  if (role === 'owner') return base;
  const parts = folder.split('/').filter(Boolean);
  for (let n = parts.length; n >= 1; n--) {
    const p = perms.find((x) => x.role === role && x.folder === parts.slice(0, n).join('/'));
    if (p) return RANK[p.level] < RANK[base] ? p.level : base;
  }
  return base;
}
export async function folderLevel(u: SessionUser, folder: string) {
  const [base, perms] = await Promise.all([menuLevel(u, 'library'), folderPerms(u)]);
  return folderLevelOf(u.role, base, perms, cleanFolder(folder));
}
async function requireFolder(u: SessionUser, folder: string, need: 'view' | 'edit' | 'delete') {
  const lv = await folderLevel(u, folder);
  if (RANK[lv] >= RANK[need]) return lv;
  if (lv === 'none') throw notFound('자료가 없습니다');
  throw forbidden(`"${folder || '최상위'}" 폴더: ${need === 'delete' ? '삭제' : '올리기·수정'} 권한이 없습니다`);
}

export async function listLibrary(u: SessionUser, q: { q?: string; folder?: string; limit?: number; review?: boolean }) {
  denyDemo(u);
  const base = await requireMenu(u, 'library', 'view'); // V13 메뉴 권한
  const sql = db();
  // 폴더 권한: 볼 수 있는 폴더만 (올린 사람 본인 파일은 항상 보임)
  const [perms, allFolders] = await Promise.all([folderPerms(u),
    sql<{ folder: string; n: number }[]>`select folder, count(*)::int n from library_files
      where tenant = ${tenantOf(u)} and deleted_at is null and upload_status = 'ready' group by folder order by folder`]);
  const visible = allFolders.filter((f) => folderLevelOf(u.role, base, perms, f.folder) !== 'none');
  const visibleNames = visible.map((f) => f.folder);
  const terms = (q.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  const like = (t: string) => `%${t.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const rows = await sql`
    select ${sql.unsafe(COLS)}, u.name as created_by_name,
      ${terms.length ? sql`substring(f.text_content from greatest(1, strpos(lower(f.text_content), lower(${terms[0]})) - 60) for 200)` : sql`null`} as snippet
    from library_files f left join users u on u.id = f.created_by
    where f.tenant = ${tenantOf(u)} and f.deleted_at is null and f.upload_status = 'ready'
      and (f.folder = any(${visibleNames}::text[]) or f.created_by = ${u.id})
      ${q.review ? sql`and f.needs_review` : sql``}
      ${q.folder !== undefined && q.folder !== null && q.folder !== '*' ? sql`and (f.folder = ${cleanFolder(q.folder)} or f.folder like ${cleanFolder(q.folder) + '/%'})` : sql``}
      ${terms.length ? sql`and ${terms.map((t) => sql`(f.title ilike ${like(t)} or f.file_name ilike ${like(t)} or f.folder ilike ${like(t)} or array_to_string(f.tags, ' ') ilike ${like(t)}
          or coalesce(f.description, '') ilike ${like(t)} or coalesce(f.text_content, '') ilike ${like(t)})`).reduce((a, b) => sql`${a} and ${b}`)}` : sql``}
    order by ${terms.length ? sql`(f.title ilike ${like(terms[0])}) desc,` : sql``} f.updated_at desc
    limit ${Math.min(q.limit ?? 200, 500)}`;
  const [{ review }] = await sql<{ review: number }[]>`select count(*)::int review from library_files f where f.tenant = ${tenantOf(u)} and f.deleted_at is null
    and f.upload_status = 'ready' and f.needs_review and (f.folder = any(${visibleNames}::text[]) or f.created_by = ${u.id})`;
  return { files: rows.map((r: any) => ({ ...r, level: r.created_by === u.id && folderLevelOf(u.role, base, perms, r.folder) === 'none' ? 'view' : folderLevelOf(u.role, base, perms, r.folder) })),
    folders: visible, review, level: base, aiOrganize: (await import('./ai/provider')).aiEnabled() };
}

export async function createLibraryFile(u: SessionUser, i: z.infer<typeof libraryInput>) {
  denyDemo(u);
  // 매출 근거: 매출 입력 권한이 있으면 "매출 근거" 폴더에 올릴 수 있다(자료실 폴더 권한과 별개)
  const revenue = i.purpose === 'revenue' && RANK[await menuLevel(u, 'revenue')] >= RANK.edit;
  const folder = revenue ? '매출 근거' : cleanFolder(i.folder);
  if (!revenue) { await requireMenu(u, 'library', 'edit'); await requireFolder(u, folder, 'edit'); }
  if (i.size > MAX_UPLOAD_BYTES) throw badRequest(`파일은 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB 까지 올릴 수 있습니다`);
  if (BLOCKED_EXT.test(i.fileName)) throw badRequest('실행 파일은 올릴 수 없습니다');
  await (await import('./plans')).assertStorage(u, i.size); // V10 회사 저장공간 한도
  const sql = db();
  const mime = i.mimeType || 'application/octet-stream';
  if (i.contentHash && !i.allowDuplicate) { // V13 3번: 같은 파일이 이미 있으면 알려 준다(볼 수 있는 것만)
    const dups = await sql<{ id: string; title: string; folder: string; created_by: string }[]>`select id, title, folder, created_by from library_files
      where tenant = ${tenantOf(u)} and content_hash = ${i.contentHash} and deleted_at is null and upload_status = 'ready' limit 5`;
    const base = await menuLevel(u, 'library'); const perms = await folderPerms(u);
    const d = dups.find((x) => x.created_by === u.id || folderLevelOf(u.role, base, perms, x.folder) !== 'none');
    if (d) throw new HttpError(409, 'duplicate', `이미 있는 파일입니다: ${d.folder ? d.folder + ' / ' : ''}${d.title}`, { duplicate: d });
  }
  const [f] = await sql<{ id: string }[]>`insert into library_files (tenant, folder, title, file_name, mime_type, size_bytes, tags, description, created_by, content_hash, source)
    values (${tenantOf(u)}, ${folder}, ${i.title || i.fileName.replace(/\.[^.]+$/, '')}, ${i.fileName}, ${mime}, ${i.size}, ${i.tags ?? []}, ${i.description ?? null}, ${u.id},
      ${i.contentHash ?? null}, ${revenue ? 'revenue' : i.purpose === 'ai_attach' ? 'ai_attach' : 'upload'}) returning id`;
  const safe = i.fileName.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120);
  const key = `lib/${tenantOf(u)}/${f.id}/${safe}`;
  await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
  return { id: f.id, upload: await uploadTarget(key, mime) };
}

/** 서버가 만든 파일(AI 보고서 등)을 자료실에 바로 저장 */
export async function saveGeneratedFile(u: SessionUser, p: { fileName: string; mime: string; data: Buffer; title: string; folder: string; tags?: string[]; description?: string; source?: string }) {
  await (await import('./plans')).assertStorage(u, p.data.length);
  const sql = db();
  const [f] = await sql<{ id: string }[]>`insert into library_files (tenant, folder, title, file_name, mime_type, size_bytes, tags, description, source, created_by, upload_status)
    values (${tenantOf(u)}, ${cleanFolder(p.folder)}, ${p.title}, ${p.fileName}, ${p.mime}, ${p.data.length}, ${p.tags ?? []}, ${p.description ?? null}, ${p.source ?? 'ai'}, ${u.id}, 'pending') returning id`;
  const key = `lib/${tenantOf(u)}/${f.id}/${p.fileName.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120)}`;
  await putObject(key, p.data, p.mime);
  await sql`update library_files set storage_key = ${key}, upload_status = 'ready', text_content = ${extractText(p.data, p.fileName, p.mime)} where id = ${f.id}`;
  return { id: f.id, storageKey: key };
}

export async function loadLibraryFile(u: SessionUser, id: string) {
  denyDemo(u);
  const [f] = await db()<any[]>`select * from library_files where id = ${id} and tenant = ${tenantOf(u)} and deleted_at is null`;
  if (!f) throw notFound('자료가 없습니다'); // 다른 회사 자료는 없는 것처럼
  if (f.created_by === u.id) return f; // 올린 사람 본인 (매출 근거처럼 다른 경로로 올린 파일 포함)
  await requireMenu(u, 'library', 'view');
  await requireFolder(u, f.folder, 'view'); // 폴더 권한 — 서명 주소 발급·AI 읽기 전에
  return f;
}
const canEdit = (u: SessionUser, f: { created_by?: string | null }) => f.created_by === u.id || isAdmin(u);

export async function completeLibraryFile(u: SessionUser, id: string) {
  const f = await loadLibraryFile(u, id);
  if (f.created_by !== u.id) throw forbidden();
  if (f.upload_status === 'ready') return { ok: true, id };
  const size = await objectSize(f.storage_key);
  if (size === null) throw badRequest('업로드된 파일을 찾을 수 없습니다. 다시 올려 주세요.');
  const text = await getObject(f.storage_key).then((b) => extractText(b, f.file_name, f.mime_type)).catch(() => null);
  await db()`update library_files set upload_status = 'ready', size_bytes = ${size}, text_content = ${text}, updated_at = now() where id = ${id}`;
  // V13 3번: 올리자마자 자동 정리(AI, 한도 소진·AI 꺼짐이면 파일명 규칙). 정리 실패는 올리기 성공에 영향 없음
  const organized = f.source === 'revenue' || f.source === 'ai_attach' ? null : await organizeLibraryFile(u, id, { keepFolder: !!f.folder }).catch(async (e: any) => {
    await db()`update library_files set organize_status = 'failed', organize_error = ${String(e?.message ?? '정리 오류').slice(0, 200)} where id = ${id}`;
    return { by: 'rule' as const, error: String(e?.message ?? '정리 오류') };
  });
  return { ok: true, id, hasText: !!text, organized };
}

export async function updateLibraryFile(u: SessionUser, id: string, i: z.infer<typeof libraryPatch>) {
  const f = await loadLibraryFile(u, id);
  await requireMenu(u, 'library', 'edit');
  if (f.created_by !== u.id) await requireFolder(u, f.folder, 'edit');
  if (!canEdit(u, f)) throw forbidden('올린 사람 또는 관리자만 고칠 수 있습니다');
  const folder = i.folder !== undefined ? cleanFolder(i.folder) : f.folder;
  if (folder !== f.folder) await requireFolder(u, folder, 'edit');
  const tags = i.tags ?? f.tags;
  const sql = db();
  await sql`update library_files set title = ${i.title ?? f.title}, folder = ${folder}, tags = ${tags}, description = ${i.description !== undefined ? i.description : f.description},
    needs_review = false, updated_at = now() where id = ${id}`;
  // 자동 정리된 파일을 사람이 고치면 회사별 학습 예시로 남긴다 → 다음 정리에 반영
  if (f.organized_by && (folder !== f.folder || String(tags) !== String(f.tags)))
    await sql`insert into library_rules (tenant, file_name, mime_type, folder, tags, created_by) values (${tenantOf(u)}, ${f.file_name}, ${f.mime_type}, ${folder}, ${tags}, ${u.id})`;
  return { ok: true };
}
export async function deleteLibraryFile(u: SessionUser, id: string) {
  const f = await loadLibraryFile(u, id);
  // 삭제 단계 권한이 있으면 누구 파일이든, 올리기·수정 단계면 내가 올린 파일만
  const lv = await folderLevel(u, f.folder);
  if (!(RANK[lv] >= RANK.delete || (f.created_by === u.id && RANK[await menuLevel(u, 'library')] >= RANK.edit)))
    throw forbidden('자료실: 삭제 권한이 없습니다 — 대표에게 요청하세요');
  await db()`update library_files set deleted_at = now() where id = ${id}`;
  return { ok: true };
}
export async function libraryDownload(u: SessionUser, id: string, inline: boolean) {
  const f = await loadLibraryFile(u, id);
  if (f.upload_status !== 'ready') throw notFound();
  return downloadUrl(f.storage_key, f.file_name, inline && /^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/.test(f.mime_type));
}

/** 자료를 업무에 첨부 (같은 저장 파일을 가리킴 — 복사하지 않음) */
export async function attachLibraryToTask(u: SessionUser, fileId: string, taskId: string) {
  const f = await loadLibraryFile(u, fileId);
  if (f.upload_status !== 'ready') throw badRequest('아직 올리는 중인 자료입니다');
  const { assertAttachTarget } = await import('./attachments');
  await assertAttachTarget(u, taskId, null);
  const sql = db();
  const [a] = await sql<{ id: string }[]>`insert into attachments (task_id, kind, storage_key, file_name, mime_type, size_bytes, upload_status, doc_title, source, created_by)
    values (${taskId}, 'file', ${f.storage_key}, ${f.file_name}, ${f.mime_type}, ${f.size_bytes}, 'ready', ${f.title}, 'other', ${u.id}) returning id`;
  await activity(sql, 'task', taskId, u.id, 'file_attached', { name: f.file_name, size: Number(f.size_bytes), from: 'library' });
  return { id: a.id };
}

// ---------------- V13 3번 자료실 자동 정리 ----------------
const tokens = (name: string) => name.replace(/\.[^.]+$/, '').toLowerCase().split(/[\s_\-.()[\]]+/).filter((t) => t.length >= 2);
/** AI 없이: 회사가 고친 예시 중 파일명 낱말이 가장 많이 겹치는 것의 폴더·태그를 따른다 */
function ruleGuess(fileName: string, rules: { file_name: string; folder: string; tags: string[] }[]) {
  const mine = new Set(tokens(fileName));
  let best: (typeof rules)[number] | null = null; let score = 0;
  for (const r of rules) { const s = tokens(r.file_name).filter((t) => mine.has(t)).length; if (s > score) { score = s; best = r; } }
  return best && score > 0 ? { folder: best.folder, tags: best.tags, confidence: Math.min(0.9, 0.4 + score * 0.2) } : null;
}
const ORG_SYSTEM = `회사 자료실 정리 담당입니다. 파일 하나의 이름·종류·본문 일부(또는 이미지)를 보고 폴더·태그·제목·한 줄 요약을 정해 JSON 으로 답하세요.
- 폴더는 "상위/하위" 형식, 가능하면 이미 있는 폴더를 쓰고 없을 때만 새로 만드세요. 예: 다짐_로고_가로형.png → 브랜드자료/다짐, 태그 로고·다짐·가로형.
- 회사가 직접 고친 예시가 있으면 그 규칙(같은 종류는 같은 폴더)을 우선 따르세요.
- 태그는 3~6개, # 없이 짧게. 제목은 사람이 읽기 좋게(확장자 없이). 요약은 한 문장.
- confidence 는 0~1, 내용을 확인하지 못했거나 애매하면 0.5 이하.`;
export async function organizeLibraryFile(u: SessionUser, id: string, opt: { keepFolder?: boolean } = {}) {
  const sql = db();
  const [f] = await sql<any[]>`select * from library_files where id = ${id} and tenant = ${tenantOf(u)} and deleted_at is null`;
  if (!f) throw notFound();
  const prev = { folder: f.folder, title: f.title, tags: f.tags, description: f.description };
  const [rules, folders] = await Promise.all([
    sql<{ file_name: string; folder: string; tags: string[] }[]>`select file_name, folder, tags from library_rules where tenant = ${tenantOf(u)} order by created_at desc limit 40`,
    sql<{ folder: string }[]>`select distinct folder from library_files where tenant = ${tenantOf(u)} and deleted_at is null and folder <> '' order by folder limit 80`,
  ]);
  let out: { folder: string; tags: string[]; title?: string; summary?: string; confidence: number } | null = null;
  let by: 'ai' | 'rule' = 'rule';
  let reason: string | null = null; // V14 3번: AI 로 정리하지 못한 이유(화면에 표시)
  await sql`update library_files set organize_status = 'pending', organize_error = null where id = ${id}`;
  const { aiEnabled, anthropicProvider, costUsd } = await import('./ai/provider');
  const quota = aiEnabled() ? await (await import('./plans')).assertAiRequest(u).then(() => null, (e: any) => e?.message ?? '이번 달 AI 한도를 모두 썼습니다') : '내장 AI 가 꺼져 있습니다(운영자 설정)';
  if (quota) reason = quota;
  else {
    const provider = anthropicProvider({ tier: 'fast' });
    const isImg = /^image\/(png|jpe?g|gif|webp)$/.test(f.mime_type) && Number(f.size_bytes) <= 3_500_000;
    const isPdf = f.mime_type === 'application/pdf' && !f.text_content && Number(f.size_bytes) <= 8_000_000;
    const bin = isImg || isPdf ? await getObject(f.storage_key).catch(() => null) : null;
    const info = `파일명: ${f.file_name}\n종류: ${f.mime_type}\n지금 폴더: ${f.folder || '(없음)'}\n이미 있는 폴더: ${folders.map((x) => x.folder).join(', ') || '(없음)'}\n` +
      `회사가 고친 예시: ${rules.slice(0, 20).map((r) => `${r.file_name} → ${r.folder} [${r.tags.join(',')}]`).join(' / ') || '(없음)'}\n` +
      (f.text_content ? `본문 일부:\n${String(f.text_content).slice(0, 2500)}` : '(본문 글자 없음)');
    const schema = { type: 'object', additionalProperties: false, required: ['folder', 'tags', 'title', 'summary', 'confidence'], properties: {
      folder: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, title: { type: 'string' }, summary: { type: 'string' }, confidence: { type: 'number' } } };
    const content = [
      ...(bin && isImg ? [{ type: 'image', source: { type: 'base64', media_type: f.mime_type === 'image/jpg' ? 'image/jpeg' : f.mime_type, data: bin.toString('base64') } }] : []),
      ...(bin && isPdf ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bin.toString('base64') } }] : []),
      { type: 'text', text: info }] as never;
    const ask = (format: boolean) => provider.chat({ system: ORG_SYSTEM + (format ? '' : '\n반드시 {"folder","tags","title","summary","confidence"} JSON 하나만 답하세요.'), tools: [], ...(format ? { format: schema } : {}), messages: [{ role: 'user', content }] });
    try {
      // 구조화 출력이 거절되면(400) 일반 답변 + JSON 추출로 한 번 더
      const r = await ask(true).catch((e: any) => (e?.status === 400 ? ask(false) : Promise.reject(e)));
      await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
        values (${tenantOf(u)}, ${u.id}, ${crypto.randomUUID()}, ${provider.name}, ${r.model ?? provider.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens},
          ${r.usage.cache_read_input_tokens ?? 0}, ${r.usage.cache_creation_input_tokens ?? 0}, ${costUsd(r.model ?? provider.model, r.usage)}, 'library_organize')`;
      const text = r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      const m = /\{[\s\S]*\}/.exec(text);
      if (!m) throw new Error('AI 답을 해석하지 못했습니다');
      const j = JSON.parse(m[0]);
      out = { folder: String(j.folder ?? ''), tags: (Array.isArray(j.tags) ? j.tags : []).map(String), title: String(j.title ?? ''), summary: String(j.summary ?? ''), confidence: Number(j.confidence) || 0 };
      by = 'ai';
    } catch (e: any) {
      out = null;
      reason = e?.status ? `AI 서버 오류(${e.status})${e?.error?.error?.message ? ': ' + String(e.error.error.message).slice(0, 120) : ''}` : String(e?.message ?? 'AI 오류').slice(0, 200);
      const { logError } = await import('./log');
      await logError('library.organize', e, { fileId: id });
    }
  }
  if (!out) { // AI 꺼짐·한도 소진·실패 → 파일명 규칙
    const g = ruleGuess(f.file_name, rules);
    out = g ? { ...g } : { folder: '', tags: tokens(f.file_name).slice(0, 4), confidence: 0.3 };
  }
  let folder = opt.keepFolder ? f.folder : cleanFolder(out.folder) || f.folder;
  if (folder !== f.folder && RANK[await folderLevel(u, folder)] < RANK.edit) folder = f.folder; // 권한 없는 폴더로는 옮기지 않는다
  const tags = [...new Set([...f.tags, ...out.tags.map((t) => t.replace(/^#/, '').trim().slice(0, 30)).filter(Boolean)])].slice(0, 20);
  const title = (out.title || '').trim().slice(0, 200) || f.title;
  const description = f.description || (out.summary || '').trim().slice(0, 500) || null;
  const confidence = Math.max(0, Math.min(1, out.confidence));
  await sql`update library_files set folder = ${folder}, tags = ${tags}, title = ${title}, description = ${description}, organized_by = ${by},
    ai_confidence = ${confidence}, needs_review = ${confidence < 0.6}, ai_prev = ${sql.json(prev as never)}, updated_at = now(),
    organize_status = ${by === 'ai' ? 'done' : 'failed'}, organize_error = ${reason} where id = ${id}`;
  return { by, folder, tags, title, description, confidence, needsReview: confidence < 0.6, error: reason };
}
export async function undoOrganize(u: SessionUser, id: string) {
  const f = await loadLibraryFile(u, id);
  if (!canEdit(u, f)) throw forbidden('올린 사람 또는 관리자만 되돌릴 수 있습니다');
  if (!f.ai_prev) throw badRequest('되돌릴 자동 정리가 없습니다');
  const p = f.ai_prev;
  await db()`update library_files set folder = ${p.folder ?? ''}, title = ${p.title ?? f.title}, tags = ${p.tags ?? []}, description = ${p.description ?? null},
    organized_by = null, ai_confidence = null, needs_review = false, ai_prev = null, updated_at = now() where id = ${id}`;
  return { ok: true };
}
export async function reorganize(u: SessionUser, id: string) {
  const f = await loadLibraryFile(u, id);
  await requireMenu(u, 'library', 'edit');
  if (!canEdit(u, f)) throw forbidden('올린 사람 또는 관리자만 다시 정리할 수 있습니다');
  return organizeLibraryFile(u, id);
}

// ---------------- V13 4번 폴더 권한 설정 (대표만) ----------------
export const folderPermInput = z.object({ folder: z.string().min(1).max(200), role: z.enum(['admin', 'dept_lead', 'site_manager', 'staff']), level: z.enum(['none', 'view', 'edit', 'delete']).nullable() });
export async function listFolderPerms(u: SessionUser) {
  if (u.role !== 'owner' || u.isDemo) throw forbidden('대표만 폴더 권한을 바꿀 수 있습니다');
  return { perms: await folderPerms(u) };
}
export async function setFolderPerm(u: SessionUser, i: z.infer<typeof folderPermInput>, ip: string | null) {
  if (u.role !== 'owner' || u.isDemo) throw forbidden('대표만 폴더 권한을 바꿀 수 있습니다');
  const sql = db(); const folder = cleanFolder(i.folder);
  if (!folder) throw badRequest('폴더를 고르세요');
  if (i.level === null) await sql`delete from library_folder_perms where tenant = ${tenantOf(u)} and folder = ${folder} and role = ${i.role}`;
  else await sql`insert into library_folder_perms (tenant, folder, role, level, updated_by) values (${tenantOf(u)}, ${folder}, ${i.role}, ${i.level}, ${u.id})
    on conflict (tenant, folder, role) do update set level = excluded.level, updated_by = excluded.updated_by, updated_at = now()`;
  const { audit } = await import('./log');
  await audit(sql, u.id, 'library_folder_perm.set', null, null, { folder, role: i.role, level: i.level }, ip);
  return { ok: true };
}

/** V14 3번: 관리자 "전체 정리" — 아직 정리하지 않았거나 실패한 파일을 한 번에 최대 10개씩(화면이 반복 호출) */
export async function organizeAll(u: SessionUser) {
  if (!isAdmin(u)) throw forbidden('대표·본사 관리자만 전체 정리할 수 있습니다');
  await requireMenu(u, 'library', 'edit');
  const sql = db();
  const rows = await sql<{ id: string }[]>`select id from library_files where tenant = ${tenantOf(u)} and deleted_at is null and upload_status = 'ready'
    and source not in ('revenue', 'ai_attach') and (organize_status is null or organize_status in ('failed', 'pending')) and organized_by is distinct from 'ai'
    order by (organize_status is null) desc, created_at desc limit 10`;
  let ai = 0, failed = 0;
  for (const r of rows) { const o = await organizeLibraryFile(u, r.id).catch(() => null); if (o?.by === 'ai') ai++; else failed++; }
  const [{ left }] = await sql<{ left: number }[]>`select count(*)::int left from library_files where tenant = ${tenantOf(u)} and deleted_at is null and upload_status = 'ready'
    and source not in ('revenue', 'ai_attach') and organize_status is null and organized_by is distinct from 'ai'`;
  return { done: rows.length, ai, failed, left };
}
