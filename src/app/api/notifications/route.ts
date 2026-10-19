import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { actionsFor, type NotifRow } from '@/lib/notifActions';

export const GET = handler(async ({ req, user }) => {
  const unreadOnly = req.nextUrl.searchParams.get('unread') === '1';
  const sql = db();
  // V12 7번: 검토 요청 알림은 업무가 아직 검토 중이면 바로 승인·반려 (task_status·task_version)
  const items = await sql<any[]>`select n.id, n.type, n.title, n.body, n.link, n.read_at, n.created_at, u.name as actor_name, n.entity_id, n.entity_type, n.meta, n.count, n.action_done, n.action_done_at,
      case when n.entity_type = 'task' then t.status end as task_status, case when n.type = 'review_requested' then t.version end as task_version,
      case when n.meta->>'extensionId' is not null then exists (select 1 from task_due_extensions x where x.id = (n.meta->>'extensionId')::uuid and x.status = 'pending') end as ext_pending
    from notifications n left join users u on u.id = n.actor_id
    left join tasks t on n.entity_type = 'task' and t.id = n.entity_id and t.deleted_at is null
    where n.user_id = ${user.id} and n.type <> 'chat' ${unreadOnly ? sql`and n.read_at is null` : sql``}
    order by (n.read_at is null) desc, n.created_at desc limit 150`;
  const [c] = await sql`select count(*)::int c from notifications where user_id = ${user.id} and read_at is null and type <> 'chat'`; // 메신저는 메시지 화면 배지로
  // 로컬 10/20: 알림에서 바로 처리할 버튼(종류·상태로 정함) — 처리된 알림은 action_done("승인함")만
  return { items: items.map((n) => ({ ...n, actions: actionsFor(n as NotifRow) })), unread: c.c };
});
