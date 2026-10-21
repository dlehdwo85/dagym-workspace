import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { loadAttachment } from '@/lib/attachments';
import { completeMultipart, objectSize } from '@/lib/storage';
import { badRequest, forbidden } from '@/lib/errors';
import { activity } from '@/lib/log';

export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const { a } = await loadAttachment(user, params.id);
  if (a.created_by !== user.id) throw forbidden();
  if (a.upload_status === 'ready') return { ok: true, id: a.id };
  const { uploadId } = await body(req, z.object({ uploadId: z.string().max(400).optional() }).default({})).catch(() => ({ uploadId: undefined as string | undefined }));
  if (uploadId) await completeMultipart(a.storage_key, uploadId).catch((e) => { throw badRequest(`조각 합치기 실패: ${(e as Error).message}`); }); // #109 영상 조각 업로드
  const size = await objectSize(a.storage_key);
  if (size === null) throw badRequest('업로드된 파일을 찾을 수 없습니다. 다시 올려 주세요.');
  const sql = db();
  await sql`update attachments set upload_status = 'ready', size_bytes = ${size} where id = ${a.id}`;
  await activity(sql, a.task_id ? 'task' : 'event', a.task_id ?? a.event_id, user.id, 'file_attached', { name: a.file_name, size });
  // V38 4: 업무 첨부 → 자료실 자동 등록(같은 파일, 업무를 볼 수 있는 사람만). 실패해도 첨부는 그대로
  const libraryId = await (await import('@/lib/library')).registerTaskAttachment(user, a as any, size).catch(() => null);
  return { ok: true, id: a.id, libraryId };
});
