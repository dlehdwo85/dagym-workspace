import { z } from 'zod';
import { db } from './db';
import { badRequest, forbidden, notFound } from './errors';
import { isAdmin, denyDemo } from './access';
import { activity } from './log';
import { MAX_UPLOAD_BYTES, downloadUrl, getObject, objectSize, putObject, uploadTarget } from './storage';
import { extractText } from './textExtract';
import type { SessionUser } from './types';

/**
 * V9 회사 자료실: 로고·소개서·단가표·보고서. 업무 첨부와 같은 저장소(S3 호환/로컬)를 쓰고, 저장 키에 고객 회사(tenant)가 들어간다.
 * 같은 회사 직원은 모두 보고 올릴 수 있고, 고치기·지우기는 올린 사람 또는 대표·본사 관리자.
 */
export const tenantOf = (u: SessionUser) => (u.isDemo ? 'demo' : 'default');
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
});
export const libraryPatch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  folder: z.string().max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  description: z.string().max(2000).nullable().optional(),
});

const COLS = `f.id, f.folder, f.title, f.file_name, f.mime_type, f.size_bytes, f.tags, f.description, f.upload_status, f.created_at, f.updated_at, f.created_by,
  (f.text_content is not null) as has_text`;

export async function listLibrary(u: SessionUser, q: { q?: string; folder?: string; limit?: number }) {
  denyDemo(u);
  const sql = db();
  const terms = (q.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  const like = (t: string) => `%${t.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const rows = await sql`
    select ${sql.unsafe(COLS)}, u.name as created_by_name,
      ${terms.length ? sql`substring(f.text_content from greatest(1, strpos(lower(f.text_content), lower(${terms[0]})) - 60) for 200)` : sql`null`} as snippet
    from library_files f left join users u on u.id = f.created_by
    where f.tenant = ${tenantOf(u)} and f.deleted_at is null and f.upload_status = 'ready'
      ${q.folder !== undefined && q.folder !== null && q.folder !== '*' ? sql`and (f.folder = ${cleanFolder(q.folder)} or f.folder like ${cleanFolder(q.folder) + '/%'})` : sql``}
      ${terms.length ? sql`and ${terms.map((t) => sql`(f.title ilike ${like(t)} or f.file_name ilike ${like(t)} or f.folder ilike ${like(t)} or array_to_string(f.tags, ' ') ilike ${like(t)}
          or coalesce(f.description, '') ilike ${like(t)} or coalesce(f.text_content, '') ilike ${like(t)})`).reduce((a, b) => sql`${a} and ${b}`)}` : sql``}
    order by ${terms.length ? sql`(f.title ilike ${like(terms[0])}) desc,` : sql``} f.updated_at desc
    limit ${Math.min(q.limit ?? 200, 500)}`;
  const folders = await sql<{ folder: string; n: number }[]>`select folder, count(*)::int n from library_files
    where tenant = ${tenantOf(u)} and deleted_at is null and upload_status = 'ready' group by folder order by folder`;
  return { files: rows, folders };
}

export async function createLibraryFile(u: SessionUser, i: z.infer<typeof libraryInput>) {
  denyDemo(u);
  if (i.size > MAX_UPLOAD_BYTES) throw badRequest(`파일은 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB 까지 올릴 수 있습니다`);
  if (BLOCKED_EXT.test(i.fileName)) throw badRequest('실행 파일은 올릴 수 없습니다');
  const sql = db();
  const mime = i.mimeType || 'application/octet-stream';
  const [f] = await sql<{ id: string }[]>`insert into library_files (tenant, folder, title, file_name, mime_type, size_bytes, tags, description, created_by)
    values (${tenantOf(u)}, ${cleanFolder(i.folder)}, ${i.title || i.fileName.replace(/\.[^.]+$/, '')}, ${i.fileName}, ${mime}, ${i.size}, ${i.tags ?? []}, ${i.description ?? null}, ${u.id}) returning id`;
  const safe = i.fileName.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120);
  const key = `lib/${tenantOf(u)}/${f.id}/${safe}`;
  await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
  return { id: f.id, upload: await uploadTarget(key, mime) };
}

/** 서버가 만든 파일(AI 보고서 등)을 자료실에 바로 저장 */
export async function saveGeneratedFile(u: SessionUser, p: { fileName: string; mime: string; data: Buffer; title: string; folder: string; tags?: string[]; description?: string; source?: string }) {
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
  return { ok: true, id, hasText: !!text };
}

export async function updateLibraryFile(u: SessionUser, id: string, i: z.infer<typeof libraryPatch>) {
  const f = await loadLibraryFile(u, id);
  if (!canEdit(u, f)) throw forbidden('올린 사람 또는 관리자만 고칠 수 있습니다');
  await db()`update library_files set title = ${i.title ?? f.title}, folder = ${i.folder !== undefined ? cleanFolder(i.folder) : f.folder},
    tags = ${i.tags ?? f.tags}, description = ${i.description !== undefined ? i.description : f.description}, updated_at = now() where id = ${id}`;
  return { ok: true };
}
export async function deleteLibraryFile(u: SessionUser, id: string) {
  const f = await loadLibraryFile(u, id);
  if (!canEdit(u, f)) throw forbidden('올린 사람 또는 관리자만 지울 수 있습니다');
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
