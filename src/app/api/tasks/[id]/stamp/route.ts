import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { loadTaskForUser } from '@/lib/access';
import { batchMateIds } from '@/lib/taskBatch';

/**
 * 대표 #794: 열려 있는 업무 상세가 15초마다 묻는 가벼운 '바뀜 표시' — 댓글·반응·첨부·체크리스트·업무 수정(같이 받은 업무 포함)이
 * 바뀌었을 때만 화면이 상세를 다시 읽는다(전체 상세를 15초마다 읽지 않게).
 */
export const GET = handler<{ id: string }>(async ({ user, params }) => {
  const sql = db();
  await loadTaskForUser(user, params.id, sql);
  const ids = [params.id, ...(await batchMateIds(sql, params.id))];
  const [r] = await sql<{ s: string }[]>`select md5(concat_ws('|',
      (select concat(count(*), max(greatest(c.created_at, c.edited_at, c.deleted_at))) from comments c where c.task_id = any(${ids}::uuid[])),
      (select concat(count(*), max(r.created_at)) from comment_reactions r join comments c on c.id = r.comment_id where c.task_id = any(${ids}::uuid[])),
      (select concat(count(*), max(greatest(a.created_at, a.updated_at))) from attachments a where a.task_id = any(${ids}::uuid[]) and a.deleted_at is null and a.upload_status = 'ready'),
      (select concat(count(*), sum(case when ci.done then 1 else 0 end), max(ci.done_at), md5(string_agg(ci.text, ',' order by ci.id))) from task_checklist_items ci where ci.task_id = any(${ids}::uuid[])),
      (select string_agg(concat(t.id, t.version, t.status), ',' order by t.id) from tasks t where t.id = any(${ids}::uuid[]))
    )) as s`;
  return { stamp: r.s };
});
