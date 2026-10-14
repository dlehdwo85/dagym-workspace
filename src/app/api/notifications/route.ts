import { handler } from '@/lib/api';
import { db } from '@/lib/db';

export const GET = handler(async ({ req, user }) => {
  const unreadOnly = req.nextUrl.searchParams.get('unread') === '1';
  const sql = db();
  // V12 7번: 검토 요청 알림은 업무가 아직 검토 중이면 바로 승인·반려 (task_status·task_version)
  const items = await sql`select n.id, n.type, n.title, n.body, n.link, n.read_at, n.created_at, u.name as actor_name, n.entity_id,
      case when n.type = 'review_requested' and (t.requested_by = ${user.id} or t.assignee_id = ${user.id}) then t.status end as task_status, case when n.type = 'review_requested' then t.version end as task_version
    from notifications n left join users u on u.id = n.actor_id
    left join tasks t on n.entity_type = 'task' and t.id = n.entity_id and t.deleted_at is null
    where n.user_id = ${user.id} and n.type <> 'chat' ${unreadOnly ? sql`and n.read_at is null` : sql``}
    order by n.created_at desc limit 100`;
  const [c] = await sql`select count(*)::int c from notifications where user_id = ${user.id} and read_at is null and type <> 'chat'`; // 메신저는 메시지 화면 배지로
  return { items, unread: c.c };
});
