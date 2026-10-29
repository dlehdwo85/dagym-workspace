import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { notFound } from '@/lib/errors';
import { loadTaskOrBatchMate } from '@/lib/taskBatch';

/** V13 8번 댓글 반응 — 같은 이모지를 다시 누르면 취소. 업무를 볼 수 있는 사람만(#794 같이 받은 업무 사람 포함) */
const REACTIONS = ['👍', '✅', '🙏', '❤️', '😂'] as const;
export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const { emoji } = await body(req, z.object({ emoji: z.enum(REACTIONS) }));
  const sql = db();
  const [c] = await sql<{ task_id: string }[]>`select task_id from comments where id = ${params.id} and deleted_at is null`;
  if (!c) throw notFound('댓글이 없습니다');
  await loadTaskOrBatchMate(user, c.task_id, sql);
  const del = await sql`delete from comment_reactions where comment_id = ${params.id} and user_id = ${user.id} and emoji = ${emoji} returning 1`;
  if (!del.length) await sql`insert into comment_reactions (comment_id, user_id, emoji) values (${params.id}, ${user.id}, ${emoji}) on conflict do nothing`;
  return { ok: true, on: !del.length };
});
