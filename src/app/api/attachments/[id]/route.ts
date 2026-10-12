import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { loadAttachment } from '@/lib/attachments';
import { forbidden } from '@/lib/errors';
import { activity } from '@/lib/log';

export const DELETE = handler<{ id: string }>(async ({ user, params }) => {
  const { a, perms } = await loadAttachment(user, params.id);
  if (a.created_by !== user.id && !perms.manage) throw forbidden('첨부한 사람 또는 관리자만 삭제할 수 있습니다');
  const sql = db();
  await sql`update attachments set deleted_at = now() where id = ${params.id}`;
  await activity(sql, a.task_id ? 'task' : 'event', a.task_id ?? a.event_id, user.id, 'attachment_removed', { name: a.doc_title ?? a.file_name });
  return { ok: true };
});
