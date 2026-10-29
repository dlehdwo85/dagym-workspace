import { DateTime } from 'luxon';
import { calendar } from './calendarGate';
import { db, type Sql } from './db';
import { notify } from './notifications';
import { occurrences } from './recurrence';
import { addDays, todaySeoul, weekRangeSeoul } from './time';
import { assignedOpenSql } from './taskAssignees';

const TZ = 'Asia/Seoul';
const hm = (d: Date) => DateTime.fromJSDate(d).setZone(TZ).toFormat('HH:mm');

/** 그날 이 사람의 일정(내 개인 캘린더 + 참석) — 반복 일정 회차 포함, 시작 순 */
export async function eventsOfDay(sql: Sql, userId: string, day: string) {
  const from = DateTime.fromISO(day, { zone: TZ }).toJSDate(), to = DateTime.fromISO(day, { zone: TZ }).plus({ days: 1 }).toJSDate();
  const rows = await sql<{ id: string; title: string; start_at: Date; end_at: Date; all_day: boolean; rrule: string | null; exdates: Date[]; kind: string }[]>`
    select e.id, e.title, e.start_at, e.end_at, e.all_day, e.rrule, e.exdates, e.kind from events e join calendars c on c.id = e.calendar_id
    where e.deleted_at is null and e.recurring_event_id is null and e.kind <> 'task_block'
      and (e.rrule is not null or (e.start_at < ${to} and e.end_at > ${from}))
      and ((c.type = 'personal' and c.owner_user_id = ${userId}) or exists (select 1 from event_attendees a where a.event_id = e.id and a.user_id = ${userId}))`;
  const out: { title: string; start: Date; allDay: boolean; kind: string }[] = [];
  for (const e of rows) {
    if (!e.rrule) { out.push({ title: e.title, start: e.start_at, allDay: e.all_day, kind: e.kind }); continue; }
    const skip = new Set((e.exdates ?? []).map((d) => new Date(d).getTime()));
    for (const s of occurrences(e.rrule, e.start_at, from, to)) if (!skip.has(s.getTime())) out.push({ title: e.title, start: s, allDay: e.all_day, kind: e.kind });
  }
  return out.sort((a, b) => +a.start - +b.start);
}

/**
 * V8 1번 아침 브리핑: 사람마다 설정한 시각(기본 08:30) 이후 첫 정기 실행에서 하루 1번.
 * 주말·공휴일은 기본으로 보내지 않음, 할 일·일정이 모두 0건이면 보내지 않음.
 */
export async function briefingJob(now = new Date()) {
  const sql = db();
  const today = todaySeoul(now);
  const local = DateTime.fromJSDate(now).setZone(TZ);
  const nowHM = local.toFormat('HH:mm');
  if (nowHM >= '22:00') return { sent: 0 };
  const weekend = local.weekday >= 6;
  const [hol] = await sql`select name from holidays where date = ${today}`;
  const users = await sql<{ id: string; tenant: string; role: string; t: string; weekend: boolean }[]>`
    select u.id, u.tenant, u.role, to_char(coalesce(s.briefing_time, time '08:30'), 'HH24:MI') as t, coalesce(s.briefing_weekend, false) as weekend
    from users u left join user_settings s on s.user_id = u.id
    where u.status = 'active' and not u.is_demo and coalesce(s.briefing_enabled, true)
      and not exists (select 1 from notifications n where n.user_id = u.id and n.dedupe_key = 'briefing:' || u.id::text || ':' || ${today})`; // 202차: 오늘 이미 보낸 사람은 다시 세지 않음(15분마다 실행 — DB 부담)
  let sent = 0;
  const { salesBriefLine } = await import('./sales/leadList');
  for (const u of users) {
    if (nowHM < u.t) continue;
    if ((weekend || hol) && !u.weekend) continue;
    const [c] = await sql<{ open: number; over: number; due: number }[]>`
      select count(*)::int as open, count(*) filter (where t.due_date < ${today})::int as over, count(*) filter (where t.due_date = ${today})::int as due
      from tasks t where t.deleted_at is null and ${assignedOpenSql(sql, u.id)} and t.status not in ('done', 'on_hold')
        and (t.due_date <= ${today} or t.start_date <= ${today})`; // #475 공동 담당(내 몫 완료 전)도
    const evs = await eventsOfDay(sql, u.id, today);
    // 202차(#461 ⑤): 영업 공간을 쓰는 사람은 진행 중 거래처의 오늘 연락·연락일 지남·다음 행동 없음(대표·관리자는 회사 전체 + 담당 없음)
    const sales = await salesBriefLine(sql, u, today).catch(() => null);
    if (!c.open && !evs.length && !sales) continue;
    const first = evs.find((e) => !e.allDay) ?? evs[0];
    const parts = c.open || evs.length ? [`할 일 ${c.open}건${c.over ? `(기한 지남 ${c.over})` : ''}`, `일정 ${evs.length}건`] : [];
    if (sales) parts.push(sales);
    // 로컬 10/20 알림 다이어트: 개별 마감 예고 푸시 대신 아침 브리핑에 오늘 마감·기한 지남 업무 이름(최대 3개)
    const dueList = await sql<{ title: string; late: boolean }[]>`select t.title, (t.due_date < ${today}) as late from tasks t where t.deleted_at is null and ${assignedOpenSql(sql, u.id)} and t.status not in ('done', 'on_hold') and t.due_date <= ${today}
      order by t.priority = 'urgent' desc, t.priority = 'high' desc, t.due_date limit 3`;
    const dueText = dueList.length ? `. 마감: ${dueList.map((d) => `${d.title}${d.late ? '(지남)' : ''}`).join(', ')}${c.due + c.over > dueList.length ? ` 외 ${c.due + c.over - dueList.length}건` : ''}` : '';
    const body = `${parts.join(' · ')}${first ? `. 첫 일정 ${first.allDay ? '종일' : hm(first.start)} ${first.title}` : ''}${dueText}`;
    sent += (await notify(sql, { userIds: [u.id], type: 'briefing', title: `좋은 아침입니다 · ${today.slice(5).replace('-', '/')} 브리핑`, body,
      link: '/', entityType: null as never, entityId: null as never, dedupeKey: `briefing:${u.id}:${today}` })).length;
  }
  return { sent };
}

/** V8 2번 개인 주간 보고 초안 내용 (월~일 기준 주) */
export async function buildPersonalReport(userId: string, weekStart: string) {
  const sql = db();
  const weekEnd = addDays(weekStart, 6), nextStart = addDays(weekStart, 7), nextEnd = addDays(weekStart, 13);
  const from = DateTime.fromISO(weekStart, { zone: TZ }).toJSDate(), to = DateTime.fromISO(nextStart, { zone: TZ }).toJSDate();
  const [done, open, next] = await Promise.all([
    sql<{ id: string; title: string; project: string | null }[]>`select t.id, t.title, p.name as project from tasks t left join projects p on p.id = t.project_id
      where t.deleted_at is null and t.assignee_id = ${userId} and t.status = 'done' and t.completed_at >= ${from} and t.completed_at < ${to} order by p.name nulls last, t.completed_at`,
    sql<{ id: string; title: string; due_date: string | null; status: string }[]>`select t.id, t.title, to_char(t.due_date,'YYYY-MM-DD') as due_date, t.status from tasks t
      where t.deleted_at is null and t.assignee_id = ${userId} and t.status not in ('done') and (t.status = 'in_progress' or t.due_date <= ${weekEnd}) order by t.due_date nulls last limit 30`,
    sql<{ id: string; title: string; due_date: string }[]>`select t.id, t.title, to_char(t.due_date,'YYYY-MM-DD') as due_date from tasks t
      where t.deleted_at is null and t.assignee_id = ${userId} and t.status <> 'done' and t.due_date between ${nextStart} and ${nextEnd} order by t.due_date limit 30`,
  ]);
  const evs: { title: string; day: string }[] = [];
  for (let d = weekStart; d <= weekEnd; d = addDays(d, 1)) for (const e of await eventsOfDay(sql, userId, d)) evs.push({ title: e.title, day: d });
  const today = todaySeoul();
  // 202차(#461 ⑤): 영업 공간을 쓰는 사람 — 내 담당 진행 중 거래처의 다음 행동 없음·오래 쉼(14일 넘게 연락 없음)
  const [me] = await sql<{ tenant: string; role: string }[]>`select tenant, role from users where id = ${userId}`;
  const sales = me ? await (await import('./sales/leadList')).salesWeekLines(sql, { id: userId, tenant: me.tenant, role: me.role }, today).catch(() => null) : null;
  const byProject = new Map<string, string[]>();
  for (const t of done) byProject.set(t.project ?? '프로젝트 없음', [...(byProject.get(t.project ?? '프로젝트 없음') ?? []), t.title]);
  const lines = [
    `■ 이번 주 완료 (${done.length}건)`,
    ...[...byProject.entries()].flatMap(([p, ts]) => [`  [${p}]`, ...ts.map((x) => `   - ${x}`)]),
    '',
    `■ 진행 중·지연 (${open.length}건)`,
    ...open.map((t) => `  - ${t.title}${t.due_date ? ` (마감 ${t.due_date}${t.due_date < today ? ', 지연 — 사유: ' : ''})` : ''}`),
    '',
    `■ 다음 주 마감 (${next.length}건)`,
    ...next.map((t) => `  - ${t.title} (${t.due_date})`),
    '',
    ...(sales?.lines ?? []),
    `■ 이번 주 일정 (${evs.length}건)`,
    ...evs.slice(0, 30).map((e) => `  - ${e.day.slice(5)} ${e.title}`),
  ];
  return { data: { weekStart, done: done.length, open: open.length, overdue: open.filter((t) => t.due_date && t.due_date < today).length, next: next.length, events: evs.length, ...(sales ? { salesNone: sales.none, salesStale: sales.stale } : {}) }, body: lines.join('\n') };
}

/** 금요일 16:00(서울) 이후 첫 정기 실행에서 이번 주 초안을 한 번 만든다 (이미 있으면 그대로) */
export async function personalReportJob(now = new Date()) {
  const local = DateTime.fromJSDate(now).setZone(TZ);
  if (!calendar(local.weekday === 5 && local.toFormat('HH:mm') >= '16:00')) return { created: 0 }; // 168차: CALENDAR_JOBS(시험 서버 off)
  return { created: await ensureDrafts(weekRangeSeoul(now).start) };
}
export async function ensureDrafts(weekStart: string, onlyUser?: string) {
  const sql = db();
  const users = await sql<{ id: string }[]>`select u.id from users u where u.status = 'active' and not u.is_demo
    and ${onlyUser ? sql`u.id = ${onlyUser}` : sql`true`}
    and not exists (select 1 from personal_reports r where r.user_id = u.id and r.week_start = ${weekStart})`;
  let n = 0;
  for (const u of users) {
    const r = await buildPersonalReport(u.id, weekStart);
    const ins = await sql`insert into personal_reports (user_id, week_start, data, body) values (${u.id}, ${weekStart}, ${sql.json(r.data)}, ${r.body})
      on conflict (user_id, week_start) do nothing returning id`;
    if (ins.length && !onlyUser) {
      n++;
      await notify(sql, { userIds: [u.id], type: 'weekly_report', title: '이번 주 보고 초안이 준비됐습니다', body: '확인하고 고쳐서 제출해 주세요', link: '/reports/mine',
        entityType: null as never, entityId: null as never, dedupeKey: `preport:${u.id}:${weekStart}` });
    } else if (ins.length) n++;
  }
  return n;
}
