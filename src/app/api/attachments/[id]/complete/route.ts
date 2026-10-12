import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { loadAttachment } from '@/lib/attachments';
import { objectSize } from '@/lib/storage';
import { badRequest, forbidden } from '@/lib/errors';
import { activity } from '@/lib/log';

export const POST = handler<{ id: string }>(async ({ user, params }) => {
  const { a } = await loadAttachment(user, params.id);
  if (a.created_by !== user.id) throw forbidden();
  if (a.upload_status === 'ready') return { ok: true, id: a.id };
  const size = await objectSize(a.storage_key);
  if (size === null) throw badRequest('업로드된 파일을 찾을 수 없습니다. 다시 올려 주세요.');
  const sql = db();
  await sql`update attachments set upload_status = 'ready', size_bytes = ${size} where id = ${a.id}`;
  await activity(sql, a.task_id ? 'task' : 'event', a.task_id ?? a.event_id, user.id, 'file_attached', { name: a.file_name, size });
  return { ok: true, id: a.id };
});
