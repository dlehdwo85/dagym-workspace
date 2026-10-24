import { type Sql } from './db';
import { badRequest, forbidden } from './errors';
import { activity } from './log';
import { notify } from './notifications';
import { tenantOf, type SessionUser } from './types';

/**
 * 대표 10/23 11:30 #475 업무 공동 배정 — 첫 담당자 = tasks.assignee_id(알림·통계 호환), 다른 담당자 = task_assignees(첫 담당자는 넣지 않음).
 * 대표 10/24 후속(다시 설계): 담당자가 여럿이면 모두 같은 무게 — 누구나 [완료] = '내 몫 완료'(첫 담당자 tasks.assignee_done_at, 다른 담당자 done_at),
 * 마지막 사람이 끝내면 업무가 완료(검토 필수면 검토 요청)된다. 내 몫을 끝내도 다른 담당자가 남아 있으면 업무는 그대로 내 업무 목록에 남는다.
 * (예전 완료 규칙 complete_rule 은 쓰지 않음)
 */
export const MAX_CO = 20;

/** 이 사람이 담당(주·공동)인 업무 — 업무 별칭 t */
export const assignedSql = (sql: Sql, uid: string) =>
  sql`(t.assignee_id = ${uid} or exists (select 1 from task_assignees tas where tas.task_id = t.id and tas.user_id = ${uid}))`;
/** 담당이면서 아직 '내 몫'이 남은 업무(내 몫 완료 전) — 리마인더·위젯 */
export const assignedOpenSql = (sql: Sql, uid: string) =>
  sql`((t.assignee_id = ${uid} and t.assignee_done_at is null) or exists (select 1 from task_assignees tas where tas.task_id = t.id and tas.user_id = ${uid} and tas.done_at is null))`;
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
  if (want.length > MAX_CO) throw badRequest(`담당자는 한 업무에 ${MAX_CO + 1}명까지 지정할 수 있어요`);
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
    await notify(tx, { userIds: added, type: 'task_assigned', title: `업무 배정(함께 담당): ${task.title}`, body: `${u.name}님이 담당자로 배정했습니다 — 담당자마다 [내 몫 완료], 모두 끝나면 업무 완료`,
      link: `/tasks/${task.id}`, entityType: 'task', entityId: task.id, actorId: u.id, dedupeKey: `coassign:${task.id}:${version}` });
  }
  if (opts.log !== false) {
    if (added.length) await activity(tx, 'task', task.id, u.id, 'assignee_added', { users: added });
    if (removed.length) await activity(tx, 'task', task.id, u.id, 'assignee_removed', { users: removed });
  }
  return { before, after: want, added, removed };
}

/** 담당자 전원(첫 담당자 + 활성 다른 담당자)과 각자 내 몫 완료 — 화면 'k/n'·마지막 사람 판정 */
export async function partsOf(tx: Sql, taskId: string): Promise<{ id: string; name: string; done: boolean }[]> {
  return tx<{ id: string; name: string; done: boolean }[]>`select id, name, done from (
      select u.id, u.name, t.assignee_done_at is not null as done, 0 as o, t.created_at as at from tasks t join users u on u.id = t.assignee_id where t.id = ${taskId}
      union all
      select u.id, u.name, ta.done_at is not null, 1, ta.added_at from task_assignees ta join users u on u.id = ta.user_id where ta.task_id = ${taskId} and u.status = 'active'
    ) x order by o, at`;
}

/** 담당자 한 사람의 '내 몫 완료' 표시·취소(첫 담당자·다른 담당자 모두) → 남은 사람 */
export async function setPart(tx: Sql, u: SessionUser, t: { id: string; assignee_id: string | null }, done: boolean) {
  const at = done ? new Date() : null;
  if (t.assignee_id === u.id) await tx`update tasks set assignee_done_at = ${at}, assignee_ack_at = coalesce(assignee_ack_at, now()) where id = ${t.id}`;
  else {
    const [r] = await tx`update task_assignees set done_at = ${at}, acked_at = coalesce(acked_at, now()) where task_id = ${t.id} and user_id = ${u.id} returning 1`;
    if (!r) throw forbidden('담당자만 내 몫 완료를 표시할 수 있어요');
  }
  await activity(tx, 'task', t.id, u.id, done ? 'part_done' : 'part_reopened', {});
  const parts = await partsOf(tx, t.id);
  return { part: done ? 'done' as const : 'open' as const, left: parts.filter((p) => !p.done).map((p) => p.name), partsDone: parts.filter((p) => p.done).length, partsTotal: parts.length };
}

/** 내 몫 완료 지우기 — uid 를 주면 그 사람만(다시 열기·검토 요청 취소), 없으면 모두(검토 반려 = 모두 다시) */
export async function clearParts(tx: Sql, taskId: string, uid: string | null = null) {
  if (uid) {
    await tx`update tasks set assignee_done_at = null where id = ${taskId} and assignee_id = ${uid}`;
    await tx`update task_assignees set done_at = null where task_id = ${taskId} and user_id = ${uid}`;
  } else {
    await tx`update tasks set assignee_done_at = null where id = ${taskId}`;
    await tx`update task_assignees set done_at = null where task_id = ${taskId}`;
  }
}
