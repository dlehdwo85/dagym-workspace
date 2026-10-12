import { randomUUID } from 'node:crypto';
import { db } from './db';
import { notify } from './notifications';
import { dispatchPending } from './push';
import { spawnNextRecurrence } from './tasks';
import { nextDate } from './recurrence';
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
  return { idempotency: a.count, sessions: b.count, oauthStates: c.count, staleUploads: d.count, jobRuns: e.count };
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
  await step('push', () => dispatchPending(200));
  if (googleConfigured()) await step('google', () => syncAllDue());
  await step('cleanup', cleanup);
  await sql`update job_runs set finished_at = now(), status = ${failed ? 'error' : 'ok'}, detail = ${sql.json(detail as never)} where id = ${run.id}`;
  await sql`delete from job_locks where name = 'tick' and holder = ${holder}`;
  return { ok: !failed, detail };
}
