import { z } from 'zod';
import { db } from './db';
import { loadTaskForUser } from './access';
import { loadEvent } from './events';
import { badRequest, forbidden, notFound } from './errors';
import { activity } from './log';
import { maxUploadBytes, tooLargeMsg, uploadTargetFor } from './storage';
import type { SessionUser } from './types';
import { zDate, zUuid } from './api';

export const attachmentInput = z.object({
  taskId: zUuid.optional(),
  eventId: zUuid.optional(),
  kind: z.enum(['file', 'link']),
  url: z.string().url().max(2000).optional(),
  fileName: z.string().trim().min(1).max(200).optional(),
  mimeType: z.string().max(100).optional(),
  size: z.number().int().positive().optional(),
  docTitle: z.string().max(200).optional(),
  docVersion: z.string().max(50).optional(),
  docBaseDate: zDate.optional(),
  docOwner: z.string().max(100).optional(),
  source: z.enum(['upload', 'google_drive', 'chatgpt', 'notion', 'web', 'other']).optional(),
  capturedAt: z.string().datetime({ offset: true }).optional(),
});

const BLOCKED_EXT = /\.(exe|bat|cmd|com|msi|scr|ps1|vbs|jar|apk|ipa|dll|sh)$/i;

export async function assertAttachTarget(u: SessionUser, taskId?: string | null, eventId?: string | null, need: 'view' | 'edit' = 'edit') {
  if (!!taskId === !!eventId) throw badRequest('업무 또는 일정 중 하나에 첨부해야 합니다');
  if (taskId) {
    const { perms } = await loadTaskForUser(u, taskId);
    // V14 50: 업무를 볼 수 있는 사람은 첨부 올리기 가능, 남이 올린 첨부 삭제는 요청자·담당자만
    void need;
    return { perms: { edit: true, manage: perms.edit } };
  }
  const { perms } = await loadEvent(u, eventId!);
  if (need === 'edit' && !(perms.edit || perms.attendee)) throw forbidden();
  return { perms: { edit: perms.edit || perms.attendee, manage: perms.edit } };
}

export function detectSource(url: string): 'google_drive' | 'chatgpt' | 'notion' | 'web' {
  const h = new URL(url).hostname;
  if (/(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/.test(h)) return 'google_drive';
  if (/(^|\.)chatgpt\.com$|(^|\.)openai\.com$/.test(h)) return 'chatgpt';
  if (/(^|\.)notion\.(so|site)$/.test(h)) return 'notion';
  return 'web';
}

export async function createAttachment(u: SessionUser, i: z.infer<typeof attachmentInput>) {
  await assertAttachTarget(u, i.taskId, i.eventId);
  const sql = db();
  if (i.kind === 'link') {
    if (!i.url || !/^https?:\/\//i.test(i.url)) throw badRequest('http(s) 링크만 첨부할 수 있습니다');
    const source = i.source && i.source !== 'upload' ? i.source : detectSource(i.url);
    const [a] = await sql<{ id: string }[]>`insert into attachments (task_id, event_id, kind, url, doc_title, doc_version, doc_base_date, doc_owner, source, created_by)
      values (${i.taskId ?? null}, ${i.eventId ?? null}, 'link', ${i.url}, ${i.docTitle ?? i.url}, ${i.docVersion ?? null},
        ${i.docBaseDate ?? null}, ${i.docOwner ?? null}, ${source}, ${u.id}) returning id`;
    await activity(sql, i.taskId ? 'task' : 'event', (i.taskId ?? i.eventId)!, u.id, 'link_attached', { title: i.docTitle ?? i.url, url: i.url });
    return { id: a.id };
  }
  if (!i.fileName || !i.size) throw badRequest('파일 이름과 크기가 필요합니다');
  if (i.size > maxUploadBytes(i.mimeType)) throw badRequest(tooLargeMsg(i.mimeType)); // #109: 영상 100MB(조각)
  if (BLOCKED_EXT.test(i.fileName)) throw badRequest('실행 파일은 첨부할 수 없습니다');
  await (await import('./plans')).assertStorage(u, i.size); // V10 회사 저장공간 한도
  const safe = i.fileName.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120);
  const mime = i.mimeType || 'application/octet-stream';
  const [a] = await sql<{ id: string }[]>`insert into attachments (task_id, event_id, kind, file_name, mime_type, size_bytes, upload_status,
      doc_title, doc_version, doc_base_date, doc_owner, source, created_by, captured_at)
    values (${i.taskId ?? null}, ${i.eventId ?? null}, 'file', ${i.fileName}, ${mime}, ${i.size}, 'pending',
      ${i.docTitle ?? i.fileName}, ${i.docVersion ?? null}, ${i.docBaseDate ?? null}, ${i.docOwner ?? null}, ${i.source ?? 'upload'}, ${u.id}, ${i.capturedAt ?? null})
    returning id`;
  const key = `att/${new Date().toISOString().slice(0, 7)}/${a.id}/${safe}`;
  await sql`update attachments set storage_key = ${key} where id = ${a.id}`;
  return { id: a.id, upload: await uploadTargetFor(key, mime, i.size) }; // #109: 20MB 넘으면 조각 업로드
}

export async function loadAttachment(u: SessionUser, id: string, need: 'view' | 'edit' = 'view') {
  const [a] = await db()`select * from attachments where id = ${id} and deleted_at is null`;
  if (!a) throw notFound('첨부가 없습니다');
  const t = await assertAttachTarget(u, a.task_id, a.event_id, need === 'edit' ? 'view' : 'view');
  return { a, perms: t.perms };
}
