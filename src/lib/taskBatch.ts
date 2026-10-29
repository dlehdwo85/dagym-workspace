import { db, type Sql } from './db';
import { isUuid, loadTaskForUser, type TaskAccessRow } from './access';
import { notify } from './notifications';
import type { SessionUser } from './types';

/**
 * 대표 #794: '각자 1건씩'(같은 batch_id) 묶음 업무끼리 댓글·첨부·체크리스트를 서로 본다.
 * 묶음의 다른 업무를 볼 수 있는 사람은 이 업무의 댓글·반응·첨부 보기·내려받기까지 — 고치기·지우기 권한은 넓히지 않는다.
 */
export async function batchMateIds(sql: Sql, taskId: string): Promise<string[]> {
  if (!isUuid(taskId)) return [];
  const rows = await sql<{ id: string }[]>`select b.id from tasks t join tasks b on b.batch_id = t.batch_id and b.id <> t.id and b.deleted_at is null
    where t.id = ${taskId} and t.batch_id is not null and t.deleted_at is null order by b.created_at`;
  return rows.map((r) => r.id);
}

/** 이 업무를 볼 수 있으면 그대로, 못 보면 같은 묶음의 다른 업무를 볼 수 있을 때만 '보기 전용'(mate) — 둘 다 아니면 404 그대로 */
export async function loadTaskOrBatchMate(u: SessionUser, taskId: string, sql: Sql = db()) {
  try {
    return { ...(await loadTaskForUser(u, taskId, sql)), mate: false };
  } catch (e) {
    if ((e as { status?: number }).status !== 404) throw e;
    for (const m of await batchMateIds(sql, taskId)) {
      if (!(await loadTaskForUser(u, m, sql).catch(() => null))) continue;
      const [t] = await sql<TaskAccessRow[]>`select id, org_unit_id, assignee_id, created_by, project_id, requested_by, team_id from tasks where id = ${taskId}`;
      return { task: t, perms: { view: true, edit: false, approve: false, delete: false }, mate: true };
    }
    throw e;
  }
}

/** 묶음의 다른 업무 담당·공동 담당 → 그 사람의 업무 id (알림은 자기 업무로 연결) */
export async function batchMatePeople(sql: Sql, taskId: string): Promise<Map<string, string>> {
  const ids = await batchMateIds(sql, taskId);
  if (!ids.length) return new Map();
  const rows = await sql<{ task_id: string; user_id: string }[]>`
    select b.id as task_id, b.assignee_id as user_id from tasks b where b.id = any(${ids}::uuid[]) and b.assignee_id is not null
    union all select ta.task_id, ta.user_id from task_assignees ta where ta.task_id = any(${ids}::uuid[])`;
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.user_id)) out.set(r.user_id, r.task_id);
  return out;
}

/**
 * #794 새 첨부 알림 — 같은 업무의 다른 담당(주·공동)과 묶음 형제 업무의 담당에게. 올린 사람은 빼고,
 * 아직 안 읽은 같은 업무 첨부 알림이 있으면 새로 보내지 않고 "새 첨부 n개"로 고친다(사진 여러 장을 올려도 알림 1건).
 */
export async function notifyTaskFile(sql: Sql, u: SessionUser, taskId: string, name: string, key: string) {
  const [t] = await sql<{ title: string; assignee_id: string | null; assignee_name: string | null }[]>`select t.title, t.assignee_id, au.name as assignee_name
    from tasks t left join users au on au.id = t.assignee_id where t.id = ${taskId} and t.deleted_at is null`;
  if (!t) return;
  const target = new Map<string, string>();
  for (const [uid, tid] of await batchMatePeople(sql, taskId)) target.set(uid, tid);
  const co = await sql<{ user_id: string }[]>`select user_id from task_assignees where task_id = ${taskId}`;
  for (const x of [t.assignee_id, ...co.map((r) => r.user_id)]) if (x) target.set(x, taskId);
  target.delete(u.id);
  const byTask = new Map<string, string[]>();
  for (const [uid, tid] of target) byTask.set(tid, [...(byTask.get(tid) ?? []), uid]);
  const from = ` · ${t.assignee_name ?? '담당자 없음'} 업무에서`;
  for (const [tid, uids] of byTask) {
    const shared = tid !== taskId;
    const pending = await sql<{ id: string; user_id: string }[]>`select id, user_id from notifications
      where user_id = any(${uids}::uuid[]) and type = 'task_file' and entity_type = 'task' and entity_id = ${tid} and read_at is null`;
    for (const r of pending) {
      await sql`update notifications set count = count + 1, title = ${'새 첨부 '} || (count + 1)::text || ${`개: ${t.title}`}, body = ${`${u.name}: ${name}${shared ? from : ''}`},
        actor_id = ${u.id}, created_at = now() where id = ${r.id}`;
    }
    const waiting = new Set(pending.map((r) => r.user_id));
    await notify(sql, { userIds: uids.filter((x) => !waiting.has(x)), type: 'task_file', title: `새 첨부: ${t.title}`, body: `${u.name}: ${name}${shared ? from : ''}`,
      link: `/tasks/${tid}#attach-section`, entityType: 'task', entityId: tid, actorId: u.id, dedupeKey: `task_file:${key}`, meta: { kind: 'attachment', fromTask: taskId } });
  }
}
