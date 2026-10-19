import { db } from './db';
import { accessibleUnitIds, taskVisibleSql } from './access';
import type { SessionUser } from './types';

/**
 * 최근 활동(업무 생성·완료·댓글, 보이는 업무만). 멘션 @[이름](id) 은 @이름 으로(로컬 검수 10/17).
 * 로컬 10/19(대표) 홈 개편: 홈 '최근 활동' 카드를 없애고 알림 화면 '활동' 탭으로 옮김 — 대시보드와 알림이 같이 씀
 */
const MENTION_RE = String.raw`@\[([^\]]+)\]\([0-9a-f-]{36}\)`;
export async function recentActivity(u: SessionUser, o: { limit?: number; brand?: string | null; days?: number } = {}) {
  const sql = db();
  const units = await accessibleUnitIds(u, sql);
  const vis = taskVisibleSql(sql, u, units);
  const bf = o.brand ? sql`and t.brand_id = ${o.brand}` : sql``;
  const since = sql`now() - ${`${o.days ?? 30} days`}::interval`;
  return sql<{ kind: string; task_id: string; title: string; at: Date; actor_id: string | null; actor_name: string | null; body: string | null }[]>`select * from (
      select 'created' as kind, t.id as task_id, t.title, t.created_at as at, cu.id as actor_id, cu.name as actor_name, null::text as body
        from tasks t left join users cu on cu.id = t.created_by left join org_units o on o.id = t.org_unit_id
        where t.deleted_at is null and ${vis} ${bf} and t.created_at > ${since}
      union all
      select 'done', t.id, t.title, t.completed_at, au.id, au.name, null from tasks t left join users au on au.id = t.assignee_id left join org_units o on o.id = t.org_unit_id
        where t.deleted_at is null and ${vis} ${bf} and t.status = 'done' and t.completed_at > ${since}
      union all
      select 'comment', t.id, t.title, c.created_at, cu.id, cu.name, left(regexp_replace(c.body, ${MENTION_RE}, ${'@\\1'}, 'g'), 80) from comments c join tasks t on t.id = c.task_id left join users cu on cu.id = c.author_id left join org_units o on o.id = t.org_unit_id
        where c.deleted_at is null and t.deleted_at is null and ${vis} ${bf} and c.created_at > ${since}
    ) a order by at desc limit ${Math.min(Math.max(o.limit ?? 30, 1), 100)}`;
}
