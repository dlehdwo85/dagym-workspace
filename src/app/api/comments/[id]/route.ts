import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { forbidden, notFound } from '@/lib/errors';
import { loadTaskForUser } from '@/lib/access';
import { activity } from '@/lib/log';

async function own(userId: string, id: string) {
  const [c] = await db()`select * from comments where id = ${id} and deleted_at is null`;
  if (!c) throw notFound('댓글이 없습니다');
  if (c.author_id !== userId) throw forbidden('본인 댓글만 수정·삭제할 수 있습니다');
  return c;
}

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => {
  const c = await own(user.id, params.id);
  await loadTaskForUser(user, c.task_id);
  const { body: text } = await body(req, z.object({ body: z.string().min(1).max(10000) }));
  await db()`update comments set body = ${text}, edited_at = now() where id = ${params.id}`;
  await activity(db(), 'task', c.task_id, user.id, 'comment_edited', { commentId: params.id });
  return { ok: true };
});

export const DELETE = handler<{ id: string }>(async ({ user, params }) => {
  const c = await own(user.id, params.id);
  await db()`update comments set deleted_at = now() where id = ${params.id}`;
  await activity(db(), 'task', c.task_id, user.id, 'comment_deleted', { commentId: params.id });
  return { ok: true };
});
