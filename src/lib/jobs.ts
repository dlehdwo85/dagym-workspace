import { randomUUID } from 'node:crypto';
import { db } from './db';
import { notify } from './notifications';
import { dispatchPending } from './push';
import { spawnNextRecurrence } from './tasks';
import { nextDate, occurrences } from './recurrence';
import { addDays, todaySeoul } from './time';
import { logError } from './log';
import { googleConfigured } from './google/client';
import { syncAllDue } from './google/sync';

const RECUR_LEAD_DAYS = 7;

async function dueNotifications() {
  const sql = db();
  // 마감 임박: 사용자별 설정 시간(기본 24시간) 이내
  const soon = await sql<{ id: string; title: string; assignee_id: string; due_date: string; due_time: string | null }[]>`
    select t.id, t.title, t.assignee_id, t.due_date, to_char(t.due_time,'HH24:MI') due_time
    from tasks t join users u on u.id = t.assignee_id left join user_settings s on s.user_id = u.id
    where t.deleted_at is null and t.status not in ('done') and u.status = 'active' and t.due_date is not null
      and ((t.due_date + coalesce(t.due_time, time '23:59')) at time zone 'Asia/Seoul') between now() and now() + make_interval(hours => coalesce(s.due_soon_hours, 24))`;
  let n = 0;
  for (const t of soon) {
    n += (await notify(sql, { userIds: [t.assignee_id], type: 'due_soon', title: `마감 임박: ${t.title}`,
      body: `마감 ${t.due_date}${t.due_time ? ' ' + t.due_time : ''}`, link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id,
      dedupeKey: `due_soon:${t.id}:${t.due_date}:${t.due_time ?? ''}` })).length;
  }
  // 기한 초과: 담당자 + 작성자에게 한 번
  const over = await sql<{ id: string; title: string; assignee_id: string | null; created_by: string; due_date: string }[]>`
    select t.id, t.title, t.assignee_id, t.created_by, t.due_date from tasks t
    where t.deleted_at is null and t.status not in ('done','on_hold') and t.due_date is not null
      and ((t.due_date + coalesce(t.due_time, time '23:59:59')) at time zone 'Asia/Seoul') < now()`;
  for (const t of over) {
    n += (await notify(sql, { userIds: [t.assignee_id, t.created_by], type: 'overdue', title: `기한 초과: ${t.title}`,
      body: `마감일 ${t.due_date} 이 지났습니다`, link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id,
      dedupeKey: `overdue:${t.id}:${t.due_date}` })).length;
  }
  return { dueSoon: soon.length, overdue: over.length, created: n };
}

async function recurringTasks() {
  const sql = db();
  const today = todaySeoul();
  const rows = await sql<{ id: string; recurrence_rule: string; due_date: string }[]>`
    select id, recurrence_rule, due_date from tasks where recurrence_rule is not null and not recurrence_stopped and deleted_at is null and due_date is not null`;
  let spawned = 0;
  for (const r of rows) {
    const next = nextDate(r.recurrence_rule, r.due_date, r.due_date);
    if (!next || next > addDays(today, RECUR_LEAD_DAYS)) continue;
    const id = await sql.begin((tx) => spawnNextRecurrence(tx, r.id, null));
    if (id) spawned++;
  }
  return { candidates: rows.length, spawned };
}

async function cleanup() {
  const sql = db();
  const a = await sql`delete from idempotency_keys where created_at < now() - interval '3 days'`;
  const b = await sql`delete from sessions where expires_at < now() - interval '7 days' or revoked_at < now() - interval '30 days'`;
  const c = await sql`delete from google_oauth_states where created_at < now() - interval '1 hour'`;
  const d = await sql`update attachments set deleted_at = now() where upload_status = 'pending' and created_at < now() - interval '1 day' and deleted_at is null`;
  const e = await sql`delete from job_runs where started_at < now() - interval '60 days'`;
  // B-8 현장 신고자 이름·연락처: 처리 완료 1년 뒤 파기 (신고 양식 동의 문구와 개인정보처리방침에 적은 기준)
  const expired = await sql<{ task_id: string }[]>`update form_submissions s set reporter_name = null, reporter_phone = null, purged_at = now()
    from tasks t where t.id = s.task_id and s.purged_at is null and (s.reporter_name is not null or s.reporter_phone is not null)
      and t.status = 'done' and t.completed_at < now() - interval '1 year' returning s.task_id`;
  if (expired.length) {
    await sql`update tasks set description = regexp_replace(description, E'\n신고자: [^\n]*', E'\n신고자: (보관 기간 경과로 삭제)')
      where id = any(${expired.map((r) => r.task_id)}::uuid[])`;
  }
  return { idempotency: a.count, sessions: b.count, oauthStates: c.count, staleUploads: d.count, jobRuns: e.count, reporterPurged: expired.length };
}

/** 서버 정기 실행 (GitHub Actions 스케줄러가 5~15분마다 호출). 대표 PC 와 무관하게 동작 */
export async function runTick(trigger: string) {
  const sql = db();
  const holder = randomUUID();
  const got = await sql`insert into job_locks (name, locked_until, holder) values ('tick', now() + interval '4 minutes', ${holder})
    on conflict (name) do update set locked_until = excluded.locked_until, holder = excluded.holder where job_locks.locked_until < now() returning 1`;
  const [run] = await sql<{ id: number }[]>`insert into job_runs (job, trigger, status) values ('tick', ${trigger}, ${got.length ? 'running' : 'skipped'}) returning id`;
  if (!got.length) {
    await sql`update job_runs set finished_at = now(), detail = ${sql.json({ reason: '이전 실행이 진행 중' })} where id = ${run.id}`;
    return { skipped: true };
  }
  const detail: Record<string, unknown> = {};
  let failed = false;
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { detail[name] = await fn(); } catch (e) { failed = true; detail[name] = { error: (e as Error).message }; await logError(`tick:${name}`, e); }
  };
  await step('recurring', recurringTasks);
  await step('due', dueNotifications);
  await step('eventReminders', () => eventReminders());
  await step('automations', async () => (await import('./automation')).dueSoonAutomations());
  await step('seriesTasks', async () => (await import('./eventtasks')).seriesTasksJob());
  await step('deadlineRisk', async () => (await import('./availability')).riskNotifyJob());
  await step('weeklyReport', async () => (await import('./insights')).weeklyReportJob());
  await step('push', () => dispatchPending(200));
  if (googleConfigured()) await step('google', () => syncAllDue());
  await step('cleanup', cleanup);
  await sql`update job_runs set finished_at = now(), status = ${failed ? 'error' : 'ok'}, detail = ${sql.json(detail as never)} where id = ${run.id}`;
  await sql`delete from job_locks where name = 'tick' and holder = ${holder}`;
  return { ok: !failed, detail };
}

/**
 * 일정 시작 전 알림: 참석자·개인 캘린더 주인·작성자에게 사용자별 설정 시간(기본 30분) 전에 1회.
 * 정기 실행이 10분 주기라 최대 10분 이르게 도착할 수 있다. 반복 일정은 회차마다 따로 보낸다.
 */
export async function eventReminders(now = new Date()) {
  const sql = db();
  const MAX_LEAD_MIN = 40320; // 최대 4주 전 알림
  const until = new Date(now.getTime() + (MAX_LEAD_MIN + 15) * 60000);
  const masters = await sql<any[]>`
    select e.*, c.type as cal_type, c.owner_user_id from events e join calendars c on c.id = e.calendar_id
    where e.deleted_at is null and e.recurring_event_id is null and not e.all_day and not e.cancelled
      and (e.rrule is not null or (e.start_at > ${now} and e.start_at < ${until}))`;
  let sent = 0;
  for (const m of masters) {
    const dur = m.end_at.getTime() - m.start_at.getTime();
    const exs = await sql<any[]>`select * from events where recurring_event_id = ${m.id} and deleted_at is null`;
    const skip = new Set([...(m.exdates ?? []).map((d: Date) => new Date(d).getTime()), ...exs.map((x) => x.original_start.getTime())]);
    const occ: { id: string; start: Date; title: string }[] = [];
    const starts = m.rrule ? occurrences(m.rrule, m.start_at, now, until) : [m.start_at];
    for (const s of starts) if (!skip.has(s.getTime()) && s > now) occ.push({ id: m.id, start: s, title: m.title });
    for (const x of exs) if (!x.cancelled && x.start_at > now && x.start_at < until) occ.push({ id: x.id, start: x.start_at, title: x.title });
    if (!occ.length) continue;
    const att = (await sql<{ user_id: string; response: string }[]>`select user_id, response from event_attendees where event_id = ${m.id}`)
      .filter((a) => a.response !== 'declined').map((a) => a.user_id);
    const people = [...new Set([...att, m.created_by, ...(m.cal_type === 'personal' && m.owner_user_id ? [m.owner_user_id] : [])])];
    const leads = await sql<{ id: string; lead: number }[]>`
      select u.id, coalesce(s.event_reminder_minutes, 30) as lead from users u left join user_settings s on s.user_id = u.id
      where u.id = any(${people}::uuid[]) and u.status = 'active'`;
    const custom: number[] | null = m.reminder_minutes ?? null; // 일정별 알림이 있으면 사용자 기본값 대신 적용
    // S-10 연결 업무 맥락 (제목 없이 건수만)
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);
    const linked = await sql<{ status: string; due_date: string | null; occurrence_start: Date | null }[]>`
      select t.status, to_char(t.due_date, 'YYYY-MM-DD') as due_date, et.occurrence_start from event_tasks et join tasks t on t.id = et.task_id
      where et.event_id = ${m.id} and t.deleted_at is null`;
    for (const o of occ) {
      const mine = linked.filter((l) => !l.occurrence_start || l.occurrence_start.getTime() === o.start.getTime());
      const late = mine.filter((l) => l.status !== 'done' && l.due_date && l.due_date < today).length;
      const open = mine.filter((l) => l.status !== 'done').length;
      const ctx = mine.length ? ` · 연결 업무 ${mine.length}건${open ? ` 중 미완료 ${open}건` : ' 모두 완료'}${late ? `(지연 ${late}건)` : ''}` : '';
      for (const p of leads) {
        // 아직 시각이 안 된 알림은 건너뛰고, 지난 알림 중 가장 가까운 것 하나만 보낸다(정기 실행 지연 시 몰아서 여러 번 보내지 않음)
        const all = custom ?? (p.lead ? [p.lead] : []);
        const due = all.filter((l) => o.start.getTime() - l * 60000 <= now.getTime());
        if (!due.length) continue;
        const lead = Math.min(...due);
        const hm = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' }).format(o.start);
        const mins = Math.max(1, Math.round((o.start.getTime() - now.getTime()) / 60000));
        sent += (await notify(sql, { userIds: [p.id], type: 'event_reminder', title: `일정 ${fmtLeft(mins)} 전: ${o.title}`, body: `${hm} 시작${m.location ? ` · ${m.location}` : ''}${ctx}`,
          link: `/calendar?event=${o.id}`, entityType: 'event', entityId: o.id, dedupeKey: `evrem:${m.id}:${o.start.toISOString()}:${lead}` })).length;
      }
    }
  }
  return { candidates: masters.length, created: sent };
}

function fmtLeft(mins: number) {
  if (mins >= 1440) return `${Math.round(mins / 1440)}일`;
  if (mins >= 60) return `${Math.round(mins / 60)}시간`;
  return `${mins}분`;
}
