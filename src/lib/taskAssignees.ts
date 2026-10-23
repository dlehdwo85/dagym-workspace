import { type Sql } from './db';
import { badRequest, forbidden } from './errors';
import { activity } from './log';
import { notify } from './notifications';
import { tenantOf, type SessionUser } from './types';

/**
 * 대표 10/23 11:30 #475 업무 공동 배정 — 주 담당 = tasks.assignee_id(그대로), 공동 담당 = task_assignees(주 담당은 넣지 않음).
 * 공동 담당은 담당자와 같이 보고·내용을 고치고, 상태 대신 '내 몫 완료'(done_at)를 표시한다. 업무 상태(완료·검토 요청)는 주 담당이 —
 * 완료 규칙 'all' 이면 공동 담당이 모두 '내 몫 완료'를 해야 주 담당이 완료·검토 요청을 할 수 있다.
 */
export const MAX_CO = 20;

/** 이 사람이 담당(주·공동)인 업무 — 업무 별칭 t */
export const assignedSql = (sql: Sql, uid: string) =>
  sql`(t.assignee_id = ${uid} or exists (select 1 from task_assignees tas where tas.task_id = t.id and tas.user_id = ${uid}))`;
/** 담당이면서 아직 '내 몫'이 남은 업무(주 담당은 업무 상태로, 공동 담당은 내 몫 완료 전) — 리마인더·내 할 일 */
export const assignedOpenSql = (sql: Sql, uid: string) =>
  sql`(t.assignee_id = ${uid} or exists (select 1 from task_assignees tas where tas.task_id = t.id and tas.user_id = ${uid} and tas.done_at is null))`;
/** 목록·상세 칸: 공동 담당(이름·확인·내 몫 완료) */
export const coAssigneesCol = (sql: Sql) => sql`(select coalesce(json_agg(json_build_object('id', ta.user_id, 'name', cu.name, 'acked', ta.acked_at is not null, 'done', ta.done_at is not null, 'doneAt', ta.done_at) order by ta.added_at), '[]'::json)
    from task_assignees ta join users cu on cu.id = ta.user_id where ta.task_id = t.id) as co_assignees`;

export async function isCoAssignee(sql: Sql, taskId: string, uid: string) {
  return (await sql`select 1 from task_assignees where task_id = ${taskId} and user_id = ${uid}`).length > 0;
}
/** 공동 담당(활성 사용자) — open = 아직 내 몫 완료 전만 */
export async function coIds(sql: Sql, taskId: string, open = false): Promise<string[]> {
  return (await sql<{ user_id: string }[]>`select ta.user_id from task_assignees ta join users u on u.id = ta.user_id
    where ta.task_id = ${taskId} and u.status = 'active' ${open ? sql`and ta.done_at is null` : sql``} order by ta.added_at`).map((r) => r.user_id);
}
/** 여러 업무의 공동 담당(활성, 기본 = 내 몫 완료 전) — 리마인더 일괄 */
export async function coMap(sql: Sql, taskIds: string[], open = true): Promise<Map<string, string[]>> {
  const m = new Map<string, string[]>();
  if (!taskIds.length) return m;
  const rows = await sql<{ task_id: string; user_id: string }[]>`select ta.task_id, ta.user_id from task_assignees ta join users u on u.id = ta.user_id
    where ta.task_id = any(${[...new Set(taskIds)]}::uuid[]) and u.status = 'active' ${open ? sql`and ta.done_at is null` : sql``} order by ta.added_at`;
  for (const r of rows) m.set(r.task_id, [...(m.get(r.task_id) ?? []), r.user_id]);
  return m;
}

/** 공동 담당 목록 바꾸기(전체 교체) — 권한(요청자)은 부르는 쪽에서 확인. 새로 들어온 사람에게 배정 알림 */
export async function replaceCoAssignees(tx: Sql, u: SessionUser, task: { id: string; title: string; assignee_id: string | null }, ids: string[], version: number, opts: { quiet?: boolean; log?: boolean } = {}) {
  const want = [...new Set(ids)].filter((x) => x && x !== task.assignee_id);
  if (want.length > MAX_CO) throw badRequest(`공동 담당은 ${MAX_CO}명까지 지정할 수 있어요`);
  if (want.length) {
    const ok = await tx<{ id: string }[]>`select id from users where id = any(${want}::uuid[]) and status = 'active' and tenant = ${tenantOf(u)}`;
    if (ok.length !== want.length) throw badRequest('비활성 사용자이거나 없는 사용자입니다');
  }
  const before = (await tx<{ user_id: string }[]>`select user_id from task_assignees where task_id = ${task.id}`).map((r) => r.user_id);
  const added = want.filter((x) => !before.includes(x));
  const removed = before.filter((x) => !want.includes(x));
  if (removed.length) await tx`delete from task_assignees where task_id = ${task.id} and user_id = any(${removed}::uuid[])`;
  // added_at = clock_timestamp(): 같은 요청에서 넣은 순서 그대로(첫 사람 = 주 담당이 비면 올라갈 사람)
  for (const a of added) await tx`insert into task_assignees (task_id, user_id, added_by, acked_at, added_at) values (${task.id}, ${a}, ${u.id}, ${a === u.id ? new Date() : null}, clock_timestamp()) on conflict do nothing`;
  // 로컬 10/23: 새로 붙은 사람에게만 '배정' 알림, 빠진 사람에게는 조용히 — 활동 기록에 'OOO 담당 추가/빼기'
  if (added.length && !opts.quiet) {
    await notify(tx, { userIds: added, type: 'task_assigned', title: `업무 배정(공동 담당): ${task.title}`, body: `${u.name}님이 공동 담당으로 배정했습니다`,
      link: `/tasks/${task.id}`, entityType: 'task', entityId: task.id, actorId: u.id, dedupeKey: `coassign:${task.id}:${version}` });
  }
  if (opts.log !== false) {
    if (added.length) await activity(tx, 'task', task.id, u.id, 'assignee_added', { users: added });
    if (removed.length) await activity(tx, 'task', task.id, u.id, 'assignee_removed', { users: removed });
  }
  return { before, after: want, added, removed };
}

/** 공동 담당의 '내 몫 완료' 표시·취소. 'all' 규칙에서 마지막 사람이 끝내면 주 담당에게 "모두 완료 — 업무를 완료해 주세요" */
export async function setMyPart(tx: Sql, u: SessionUser, t: { id: string; title: string; assignee_id: string | null; complete_rule: string; version: number }, done: boolean) {
  const [r] = await tx<{ done_at: Date | null }[]>`update task_assignees set done_at = ${done ? new Date() : null}, acked_at = coalesce(acked_at, now())
    where task_id = ${t.id} and user_id = ${u.id} returning done_at`;
  if (!r) throw forbidden('공동 담당만 내 몫 완료를 표시할 수 있어요');
  await activity(tx, 'task', t.id, u.id, done ? 'part_done' : 'part_reopened', {});
  let allDone = false;
  if (done) {
    const [left] = await tx<{ n: number }[]>`select count(*)::int as n from task_assignees where task_id = ${t.id} and done_at is null`;
    allDone = left.n === 0;
    if (allDone && t.assignee_id && t.complete_rule === 'all') {
      await notify(tx, { userIds: [t.assignee_id], type: 'task_assigned', title: `공동 담당 모두 완료: ${t.title}`, body: `${u.name}님까지 모두 내 몫을 마쳤습니다 — 업무를 완료(또는 검토 요청)해 주세요`,
        link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id, actorId: u.id, dedupeKey: `coalldone:${t.id}:${t.version}` });
    }
  }
  return { part: done ? 'done' as const : 'open' as const, allDone };
}

/** 'all' 규칙: 주 담당이 완료·검토 요청하기 전에 공동 담당이 모두 내 몫을 끝냈는지 */
export async function pendingCoNames(tx: Sql, taskId: string): Promise<string[]> {
  return (await tx<{ name: string }[]>`select u.name from task_assignees ta join users u on u.id = ta.user_id where ta.task_id = ${taskId} and ta.done_at is null and u.status = 'active' order by ta.added_at`).map((r) => r.name);
}
