import { randomUUID } from 'node:crypto';
import { db } from './db';
import { notify } from './notifications';
import { dispatchPending } from './push';
import { spawnNextRecurrence } from './tasks';
import { nextDate, occurrences } from './recurrence';
import { addDays, todaySeoul } from './time';
import { STATUS_LABEL, type TaskStatus } from './types';
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
    where t.deleted_at is null and t.status not in ('done','on_hold') and u.status = 'active' and t.due_date is not null
      and ((t.due_date + coalesce(t.due_time, time '23:59')) at time zone 'Asia/Seoul') between now() and now() + make_interval(hours => coalesce(s.due_soon_hours, 24))
      -- V14 10번: 같은 업무·같은 날 알림은 가장 구체적인 1건 — 마감 당일은 "오늘 마감", 업무별 🔔 를 정했으면 그 알림만
      and t.due_date > (now() at time zone 'Asia/Seoul')::date and t.reminder_minutes is null`;
  let n = 0;
  for (const t of soon) {
    n += (await notify(sql, { userIds: [t.assignee_id], type: 'due_soon', title: `마감 임박: ${t.title}`,
      body: `마감 ${t.due_date}${t.due_time ? ' ' + t.due_time : ''}`, link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id,
      dedupeKey: `due_soon:${t.id}:${t.due_date}:${t.due_time ?? ''}` })).length;
  }
  // 매일 오전 9시(서울) 이후 첫 실행에서 하루 1회: 기한 지남 → 담당자·지시자, 오늘 마감 → 담당자 (완료·보류되면 멈춤)
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(now));
  const today = todaySeoul(now);
  let over: { id: string; title: string; assignee_id: string | null; requested_by: string | null; created_by: string; due_date: string; days: number }[] = [];
  let dueToday: { id: string; title: string; assignee_id: string; due_time: string | null }[] = [];
  if (hour >= Number(process.env.DUE_DIGEST_HOUR ?? 9)) {
    over = await sql`
      select t.id, t.title, t.assignee_id, t.requested_by, t.created_by, t.due_date, (${today}::date - t.due_date)::int as days from tasks t
      where t.deleted_at is null and t.status not in ('done','on_hold') and t.due_date is not null and t.due_date < ${today}::date`;
    for (const t of over) {
      n += (await notify(sql, { userIds: [t.assignee_id, t.requested_by ?? t.created_by], type: 'overdue', title: `기한 지남: ${t.title}`,
        body: `마감일 ${t.due_date} · ${t.days}일 지났습니다`, link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id,
        dedupeKey: `overdue:${t.id}:${today}` })).length;
    }
    dueToday = await sql`
      select t.id, t.title, t.assignee_id, to_char(t.due_time,'HH24:MI') due_time from tasks t join users u on u.id = t.assignee_id
      where t.deleted_at is null and t.status not in ('done','on_hold') and t.due_date = ${today}::date and u.status = 'active'`;
    for (const t of dueToday) {
      n += (await notify(sql, { userIds: [t.assignee_id], type: 'due_soon', title: `오늘 마감: ${t.title}`,
        body: t.due_time ? `오늘 ${t.due_time}까지` : '오늘까지 마감입니다', link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id,
        dedupeKey: `due_today:${t.id}:${today}` })).length;
    }
  }
  // V8 8번 미리 알림: 시간 있는 업무는 업무별 알림(최대 3개) 또는 각자 기본값(60분 전), 날짜만 있는 업무는 업무별 알림을 정했을 때만(당일 09시 기준)
  // 정기 실행 사이에 지나간 알림도 마감 전이면 보낸다(분 단위 정확도는 정기 실행 주기에 따름 — NEXT_ACTION 참고)
  const hourLeft = await sql<{ id: string; title: string; assignee_id: string; due_date: string; due_time: string | null; m: number }[]>`
    select t.id, t.title, t.assignee_id, to_char(t.due_date,'YYYY-MM-DD') due_date, to_char(t.due_time,'HH24:MI') due_time, r.m
    from tasks t join users u on u.id = t.assignee_id left join user_settings s on s.user_id = t.assignee_id
    cross join lateral unnest(coalesce(t.reminder_minutes, case when t.due_time is not null then array[coalesce(s.task_reminder_minutes, 60)] else array[]::int[] end)) as r(m)
    where t.deleted_at is null and t.status not in ('done','on_hold') and u.status = 'active' and t.due_date is not null
      and ((t.due_date + coalesce(t.due_time, time '09:00')) at time zone 'Asia/Seoul') > now()
      and ((t.due_date + coalesce(t.due_time, time '09:00')) at time zone 'Asia/Seoul') - make_interval(mins => r.m) <= now()`;
  for (const t of hourLeft) {
    const left = t.m >= 1440 ? `${Math.round(t.m / 1440)}일 뒤` : t.m >= 60 ? `${Math.round(t.m / 60)}시간 뒤` : t.m > 0 ? `${t.m}분 뒤` : '지금';
    n += (await notify(sql, { userIds: [t.assignee_id], type: 'due_soon', title: `${left} 마감: ${t.title}`,
      body: `${t.due_date === today ? '오늘' : t.due_date} ${t.due_time ?? ''}까지`.trim(), link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id,
      dedupeKey: `due_rem:${t.id}:${t.due_date}:${t.due_time ?? ''}:${t.m}` })).length;
  }
  // V13 6번: 같은 알림을 지시자에게도 (담당자 이름·상태로 구분, 지시자 = 담당자면 생략, 일괄 업무는 묶음 1건)
  const kinds = [
    ...soon.map((t) => ({ id: t.id, kind: 'soon', label: '마감 임박', when: `마감 ${t.due_date}${t.due_time ? ' ' + t.due_time : ''}`, key: `${t.due_date}:${t.due_time ?? ''}` })),
    ...dueToday.map((t) => ({ id: t.id, kind: 'today', label: '오늘 마감', when: t.due_time ? `오늘 ${t.due_time}까지` : '오늘까지', key: today })),
    ...hourLeft.map((t) => { const left = t.m >= 1440 ? `${Math.round(t.m / 1440)}일 뒤` : t.m >= 60 ? `${Math.round(t.m / 60)}시간 뒤` : t.m > 0 ? `${t.m}분 뒤` : '지금';
      return { id: t.id, kind: `rem${t.m}`, label: `${left} 마감`, when: `${t.due_date === today ? '오늘' : t.due_date} ${t.due_time ?? ''}까지`.trim(), key: `${t.due_date}:${t.due_time ?? ''}` }; }),
  ];
  if (kinds.length) {
    const info = await sql<{ id: string; title: string; status: TaskStatus; requested_by: string; batch_id: string | null; assignee_name: string }[]>`
      select t.id, t.title, t.status, t.requested_by, t.batch_id, a.name assignee_name from tasks t
        join users a on a.id = t.assignee_id join users r on r.id = t.requested_by left join user_settings rs on rs.user_id = r.id
      where t.id = any(${[...new Set(kinds.map((k) => k.id))]}::uuid[]) and t.requested_by is not null and t.requested_by <> t.assignee_id
        and r.status = 'active' and coalesce(rs.requester_due_alerts, true) and t.status not in ('done','on_hold')`;
    type Info = (typeof info)[number];
    const groups = new Map<string, { k: (typeof kinds)[number]; ts: Info[] }>();
    for (const k of kinds) {
      const t = info.find((x) => x.id === k.id); if (!t) continue;
      const g = `${t.requested_by}|${t.batch_id ?? t.id}|${k.kind}|${k.key}`;
      const cur = groups.get(g) ?? { k, ts: [] }; if (!cur.ts.some((x) => x.id === t.id)) cur.ts.push(t); groups.set(g, cur);
    }
    for (const [g, { k, ts }] of groups) {
      const t = ts[0];
      const who = ts.length > 1 ? `${t.assignee_name} 외 ${ts.length - 1}명` : t.assignee_name;
      const states = ts.length > 1 ? Object.entries(ts.reduce((a, x) => ({ ...a, [STATUS_LABEL[x.status]]: (a[STATUS_LABEL[x.status]] ?? 0) + 1 }), {} as Record<string, number>)).map(([s, c]) => `${s} ${c}`).join('·') : STATUS_LABEL[t.status];
      n += (await notify(sql, { userIds: [t.requested_by], type: 'due_soon', title: `[지시] ${k.label}: ${t.title}`,
        body: `담당 ${who} · ${states} · ${k.when}`, link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id,
        dedupeKey: `req_${g.split('|').slice(1).join(':')}` })).length;
    }
  }
  return { dueSoon: soon.length, overdue: over.length, dueToday: dueToday.length, dueHour: hourLeft.length, created: n };
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
  await step('briefing', async () => (await import('./briefing')).briefingJob());
  await step('personalReport', async () => (await import('./briefing')).personalReportJob());
  await step('usage', async () => (await import('./plans')).usageJob());
  await step('aiRetention', async () => ({ purged: await (await import('./ai/threads')).purgeOldThreads() })); // V14 2번 AI 대화 보관 기간
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
      select u.id, coalesce(s.event_reminder_minutes, 10) as lead from users u left join user_settings s on s.user_id = u.id
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
