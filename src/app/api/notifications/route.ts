import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { actionsFor, type NotifRow } from '@/lib/notifActions';

export const GET = handler(async ({ req, user }) => {
  const unreadOnly = req.nextUrl.searchParams.get('unread') === '1';
  const space = req.nextUrl.searchParams.get('space'); // #104 묶음 알림 링크 → 그 공간 알림만
  const archived = req.nextUrl.searchParams.get('archived') === '1'; // #110 보관함 탭(보관한 것만), 기본 목록은 보관 제외
  const sql = db();
  // V12 7번: 검토 요청 알림은 업무가 아직 검토 중이면 바로 승인·반려 (task_status·task_version)
  const items = await sql<any[]>`select n.id, n.type, n.title, n.body, n.link, n.read_at, n.created_at, u.name as actor_name, n.entity_id, n.entity_type, n.meta, n.count, n.action_done, n.action_done_at, n.space, n.archived_at,
      case when n.entity_type = 'task' then t.status end as task_status, case when n.type = 'review_requested' then t.version end as task_version,
      case when n.meta->>'extensionId' is not null then exists (select 1 from task_due_extensions x where x.id = (n.meta->>'extensionId')::uuid and x.status = 'pending') end as ext_pending
    from notifications n left join users u on u.id = n.actor_id
    left join tasks t on n.entity_type = 'task' and t.id = n.entity_id and t.deleted_at is null
    where n.user_id = ${user.id} and n.type <> 'chat' ${archived ? sql`and n.archived_at is not null` : sql`and n.archived_at is null`} ${unreadOnly ? sql`and n.read_at is null` : sql``} ${space && ['work', 'sales', 'marketing'].includes(space) ? sql`and n.space = ${space}` : sql``}
    order by (n.read_at is null) desc, n.created_at desc limit 150`;
  const [c] = await sql`select count(*)::int c from notifications where user_id = ${user.id} and read_at is null and type <> 'chat'`; // 메신저는 메시지 화면 배지로
  // 로컬 10/20: 알림에서 바로 처리할 버튼(종류·상태로 정함) — 처리된 알림은 action_done("승인함")만
  // 로컬 10/20(대표): 웹 알람 띠 — 알람처럼 울리는 알림 중 아직 해제·읽음 전(3시간 안) 을 함께 돌려 상단 고정 띠 + 소리
  const alarms = unreadOnly ? items.filter((n) => n.meta?.alarm && !n.action_done && !n.read_at && Date.now() - new Date(n.created_at).getTime() < 3 * 3600e3).slice(0, 3)
    .map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, link: n.link, actions: actionsFor(n as NotifRow) })) : undefined;
  return { items: items.map((n) => ({ ...n, actions: actionsFor(n as NotifRow) })), unread: c.c, ...(alarms ? { alarms } : {}) };
});
