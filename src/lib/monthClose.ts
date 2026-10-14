import { DateTime } from 'luxon';
import { db, type Sql } from './db';
import { notify } from './notifications';
import { forbidden } from './errors';
import { tenantOf, type SessionUser } from './types';
import { menuLevel, RANK } from './menuPerms';

/**
 * V20 월 마감 기록 — 매월 1일 00:10(Asia/Seoul) 뒤 첫 정기 실행에서 지난달 숫자를 회사·담당자별로 고정 저장한다.
 * 완료 = 그달에 완료, 이월 = 그달 말에 아직 안 끝난 업무, 지연 = 이월 중 마감이 그달 말 전에 지난 것, 생성 = 그달에 만든 업무 (최상위 업무만, 삭제 제외)
 * 처음 실행할 때는 최근 3개월을 지금 데이터로 소급 계산하고 "추정"으로 표시한다. 같은 달은 다시 계산하지 않는다(중복 없음).
 */
const TZ = 'Asia/Seoul';
const monthBounds = (m: string) => {
  const s = DateTime.fromISO(`${m}-01`, { zone: TZ });
  return { start: s.toJSDate(), end: s.plus({ months: 1 }).toJSDate(), endDate: s.plus({ months: 1 }).toISODate()! };
};
const prevMonth = (m: string, n = 1) => DateTime.fromISO(`${m}-01`, { zone: TZ }).minus({ months: n }).toFormat('yyyy-MM');

type MonthRow = { total: boolean; assignee_id: string | null; done_count: number; carried_count: number; overdue_count: number; created_count: number };
export async function computeMonth(sql: Sql, tenant: string, month: string): Promise<MonthRow[]> {
  const { start, end, endDate } = monthBounds(month);
  return sql<MonthRow[]>`
    with base as (
      select t.assignee_id, t.completed_at, t.created_at, t.due_date
      from tasks t join org_units o on o.id = t.org_unit_id
      where o.tenant = ${tenant} and t.parent_id is null and (t.deleted_at is null or t.deleted_at >= ${end}) and t.created_at < ${end}
    )
    select grouping(assignee_id) = 1 as total, assignee_id,
      count(*) filter (where completed_at >= ${start} and completed_at < ${end})::int as done_count,
      count(*) filter (where completed_at is null or completed_at >= ${end})::int as carried_count,
      count(*) filter (where (completed_at is null or completed_at >= ${end}) and due_date < ${endDate}::date)::int as overdue_count,
      count(*) filter (where created_at >= ${start})::int as created_count
    from base group by grouping sets ((assignee_id), ())`;
}

export async function monthCloseJob(now = new Date(), opts: { tenant?: string } = {}) {
  const d = DateTime.fromJSDate(now).setZone(TZ);
  if (d.day === 1 && d.hour === 0 && d.minute < 10) return { skipped: 'before 00:10' };
  const thisMonth = d.toFormat('yyyy-MM');
  const last = prevMonth(thisMonth);
  const sql = db();
  const tenants = opts.tenant ? [opts.tenant] : (await sql<{ id: string }[]>`select id from tenants where id <> 'demo'`).map((t) => t.id);
  const out: Record<string, string[]> = {};
  for (const tenant of tenants) {
    const has = (await sql<{ n: number }[]>`select count(*)::int n from task_month_close where tenant = ${tenant}`)[0].n;
    const months = has ? [last] : [prevMonth(thisMonth, 3), prevMonth(thisMonth, 2), last]; // 첫 실행: 최근 3개월 소급
    const made: string[] = [];
    for (const m of months) {
      const exists = await sql`select 1 from task_month_close where tenant = ${tenant} and month = ${m} and user_id is null`;
      if (exists.length) continue;
      const rows = await computeMonth(sql, tenant, m);
      const total = rows.find((r) => r.total);
      if (!total) continue;
      // 그달이 끝나고 하루 넘게 지나 계산하면 "추정"(그사이 바뀐 업무가 반영될 수 있음)
      const estimated = now.getTime() - monthBounds(m).end.getTime() > 86400000;
      const inserted = await sql.begin(async (tx) => {
        let n = 0;
        for (const r of rows) {
          if (!r.total && !r.assignee_id) continue; // 담당자 없는 업무는 회사 전체에만
          const res = await tx`insert into task_month_close (tenant, month, user_id, done_count, carried_count, overdue_count, created_count, estimated)
            values (${tenant}, ${m}, ${r.total ? null : r.assignee_id}, ${r.done_count}, ${r.carried_count}, ${r.overdue_count}, ${r.created_count}, ${estimated})
            on conflict do nothing returning id`;
          n += res.length;
        }
        return n;
      });
      if (!inserted) continue;
      made.push(m);
      if (m === last) {
        const owners = (await sql<{ id: string }[]>`select id from users where tenant = ${tenant} and role = 'owner' and status = 'active'`).map((u) => u.id);
        await notify(sql, { userIds: owners, type: 'month_close', title: `${Number(m.slice(5))}월 마감: 완료 ${total.done_count} · 이월 ${total.carried_count} · 지연 ${total.overdue_count}`,
          body: `새 업무 ${total.created_count}건${estimated ? ' (소급 계산)' : ''}`, link: `/reports?month=${m}`, actorId: null, dedupeKey: `month_close:${tenant}:${m}` });
      }
    }
    if (made.length) out[tenant] = made;
  }
  return { closed: out };
}

/** 리포트 "월별 기록": 회사 전체 + 담당자별 (주간 보고와 같은 권한: 대표·본사 관리자 등 "주간 보고(모아보기)" 조회 이상) */
export async function monthCloses(u: SessionUser) {
  if (RANK[await menuLevel(u, 'team_reports')] < RANK.view) throw forbidden('월별 기록은 주간 보고 권한이 있는 사람이 봅니다');
  const rows = await db()`select c.month, c.user_id, u.name, c.done_count, c.carried_count, c.overdue_count, c.created_count, c.estimated, c.created_at
    from task_month_close c left join users u on u.id = c.user_id
    where c.tenant = ${tenantOf(u)} order by c.month desc, c.user_id nulls first, u.name limit 2000`;
  return { months: rows };
}
