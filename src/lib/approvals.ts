import { z } from 'zod';
import { db, type Sql } from './db';
import { accessibleUnitIds, isAdmin, loadTaskForUser } from './access';
import { badRequest, forbidden, notFound } from './errors';
import { activity, audit } from './log';
import { notify } from './notifications';
import { tenantOf, type SessionUser } from './types';
import { zUuid } from './api';

/** 결재선 단계: 역할(해당 업무 조직과 상위 조직의 그 역할 사용자) 또는 지정 사용자 */
export const stepSchema = z.object({
  label: z.string().trim().min(1).max(40),
  type: z.enum(['role', 'user']),
  role: z.enum(['site_manager', 'dept_lead', 'admin', 'owner']).optional(),
  userId: zUuid.optional(),
}).refine((s) => (s.type === 'role' ? !!s.role : !!s.userId), '역할 또는 사용자를 지정하세요');
export const lineInput = z.object({
  name: z.string().trim().min(1).max(60),
  orgUnitId: zUuid.nullable().optional(),
  steps: z.array(stepSchema).min(1).max(6),
  active: z.boolean().optional(),
});
export type Step = z.infer<typeof stepSchema>;

export async function listLines(u: SessionUser) {
  const sql = db();
  const units = await accessibleUnitIds(u, sql);
  return sql`select l.id, l.name, l.org_unit_id, l.steps, l.active, o.name as org_unit_name from approval_lines l left join org_units o on o.id = l.org_unit_id
    where ((l.org_unit_id is null and l.tenant = ${tenantOf(u)}) or ${units === null ? sql`true` : sql`l.org_unit_id = any(${units}::uuid[])`}) order by l.org_unit_id nulls first, l.name`;
}

export async function saveLine(u: SessionUser, id: string | null, i: z.infer<typeof lineInput>, ip: string | null) {
  await (await import('./menuPerms')).requireMenu(u, 'ops', 'edit');
  const sql = db();
  if (id) {
    const r = await sql`update approval_lines set name = ${i.name}, org_unit_id = ${i.orgUnitId ?? null}, steps = ${sql.json(i.steps as never)},
      active = ${i.active ?? true} where id = ${id} returning id`;
    if (!r.length) throw notFound('결재선이 없습니다');
  } else {
    const [r] = await sql<{ id: string }[]>`insert into approval_lines (name, org_unit_id, steps, created_by)
      values (${i.name}, ${i.orgUnitId ?? null}, ${sql.json(i.steps as never)}, ${u.id}) returning id`;
    id = r.id;
  }
  await audit(sql, u.id, 'approval_line.save', 'approval_line', id, i, ip);
  return { id };
}

/** 단계별 결재자 목록 */
export async function stepApprovers(sql: Sql, orgUnitId: string, row: { approver_type: string; approver_role: string | null; approver_user_id: string | null }) {
  if (row.approver_type === 'user') {
    const r = await sql<{ id: string }[]>`select id from users where id = ${row.approver_user_id} and status = 'active'`;
    return r.map((x) => x.id);
  }
  if (row.approver_role === 'owner' || row.approver_role === 'admin') {
    const roles = row.approver_role === 'owner' ? ['owner'] : ['owner', 'admin'];
    return (await sql<{ id: string }[]>`select id from users where role = any(${roles}) and status = 'active'`).map((x) => x.id);
  }
  const r = await sql<{ id: string }[]>`
    with recursive up as (select id, parent_id from org_units where id = ${orgUnitId}
      union select o.id, o.parent_id from org_units o join up on o.id = up.parent_id)
    select distinct u.id from users u join memberships m on m.user_id = u.id
    where m.org_unit_id in (select id from up) and u.status = 'active' and u.role = ${row.approver_role}`;
  return r.map((x) => x.id);
}

/** 검토 요청 시 결재 회차 시작 (updateTask 트랜잭션 안에서 호출) */
export async function startApprovalRound(sql: Sql, taskId: string, lineId: string, orgUnitId: string, actorId: string, title: string) {
  const [line] = await sql<{ steps: Step[]; active: boolean }[]>`select steps, active from approval_lines where id = ${lineId}`;
  if (!line || !line.active) throw badRequest('사용할 수 없는 결재선입니다');
  const [{ r }] = await sql<{ r: number }[]>`select coalesce(max(round), 0) + 1 as r from task_approvals where task_id = ${taskId}`;
  let n = 1;
  for (const s of line.steps) {
    await sql`insert into task_approvals (task_id, round, step, label, approver_type, approver_role, approver_user_id, status)
      values (${taskId}, ${r}, ${n}, ${s.label}, ${s.type}, ${s.role ?? null}, ${s.userId ?? null}, ${n === 1 ? 'pending' : 'waiting'})`;
    n++;
  }
  const [first] = await sql`select * from task_approvals where task_id = ${taskId} and round = ${r} and step = 1`;
  const who = await stepApprovers(sql, orgUnitId, first as any);
  if (!who.length) throw badRequest(`결재선 1단계(${first.label}) 결재자가 없습니다. 결재선이나 조직 구성을 확인하세요.`);
  await notify(sql, { userIds: who, type: 'review_requested', title: `결재 요청 (${first.label}): ${title}`, body: `1/${line.steps.length} 단계`,
    link: `/tasks/${taskId}`, entityType: 'task', entityId: taskId, actorId, dedupeKey: `appr:${taskId}:${r}:1` });
  return r;
}

/** 진행 중인 결재 회차 취소 (상태를 직접 되돌릴 때) */
export async function cancelOpenRound(sql: Sql, taskId: string) {
  await sql`delete from task_approvals where task_id = ${taskId} and status in ('pending','waiting')
    and round = (select max(round) from task_approvals where task_id = ${taskId})`;
}

export async function openRound(sql: Sql, taskId: string) {
  return sql<any[]>`select a.*, d.name as decided_by_name from task_approvals a left join users d on d.id = a.decided_by
    where a.task_id = ${taskId} order by a.round desc, a.step`;
}

/** 결재: 승인 → 다음 단계, 마지막 단계면 최종 완료 / 반려(사유 필수) → 진행 중으로 */
export async function decide(u: SessionUser, taskId: string, decision: 'approve' | 'reject', comment: string | undefined, ip: string | null) {
  const sql = db();
  return sql.begin(async (tx) => {
    const { task } = await loadTaskForUser(u, taskId, tx);
    const [t] = await tx`select * from tasks where id = ${taskId} for update`;
    if (t.status !== 'review') throw badRequest('결재 대기 중인 업무가 아닙니다');
    const [cur] = await tx<any[]>`select * from task_approvals where task_id = ${taskId} and status = 'pending'
      and round = (select max(round) from task_approvals where task_id = ${taskId}) limit 1`;
    if (!cur) throw badRequest('진행 중인 결재 단계가 없습니다');
    const who = await stepApprovers(tx, task.org_unit_id, cur);
    if (!who.includes(u.id)) throw forbidden(`이 단계(${cur.label})의 결재자가 아닙니다`);
    if (decision === 'reject' && !comment?.trim()) throw badRequest('반려 사유를 입력하세요');
    await tx`update task_approvals set status = ${decision === 'approve' ? 'approved' : 'rejected'}, decided_by = ${u.id}, decided_at = now(),
      comment = ${comment?.trim() || null} where id = ${cur.id}`;
    await audit(tx, u.id, 'approval.decide', 'task', taskId, { round: cur.round, step: cur.step, label: cur.label, decision, comment: comment ?? null }, ip);
    const [{ total }] = await tx<{ total: number }[]>`select count(*)::int total from task_approvals where task_id = ${taskId} and round = ${cur.round}`;
    if (decision === 'reject') {
      await tx`update tasks set status = 'in_progress', version = version + 1, updated_at = now() where id = ${taskId}`;
      await tx`insert into comments (task_id, author_id, body) values (${taskId}, ${u.id}, ${`[반려 · ${cur.label}] ${comment!.trim()}`})`;
      await activity(tx, 'task', taskId, u.id, 'review_rejected', { status: { from: 'review', to: 'in_progress' }, note: comment, step: cur.label });
      await notify(tx, { userIds: [t.assignee_id, t.review_requested_by], type: 'review_result', title: `결재 반려 (${cur.label}): ${t.title}`,
        body: comment!.trim().slice(0, 120), link: `/tasks/${taskId}`, entityType: 'task', entityId: taskId, actorId: u.id,
        dedupeKey: `apprrej:${taskId}:${cur.round}:${cur.step}` });
      return { status: 'rejected' };
    }
    if (cur.step < total) {
      await tx`update task_approvals set status = 'pending' where task_id = ${taskId} and round = ${cur.round} and step = ${cur.step + 1}`;
      const [next] = await tx<any[]>`select * from task_approvals where task_id = ${taskId} and round = ${cur.round} and step = ${cur.step + 1}`;
      const nextWho = await stepApprovers(tx, task.org_unit_id, next);
      await activity(tx, 'task', taskId, u.id, 'approval_step', { step: cur.label, next: next.label });
      await notify(tx, { userIds: nextWho, type: 'review_requested', title: `결재 요청 (${next.label}): ${t.title}`, body: `${cur.step + 1}/${total} 단계 · 이전 단계 ${cur.label} 승인`,
        link: `/tasks/${taskId}`, entityType: 'task', entityId: taskId, actorId: u.id, dedupeKey: `appr:${taskId}:${cur.round}:${cur.step + 1}` });
      return { status: 'next', step: cur.step + 1 };
    }
    // 마지막 단계 승인 → 최종 완료
    await tx`update tasks set status = 'done', completed_at = now(), approved_at = now(), approved_by = ${u.id}, version = version + 1, updated_at = now() where id = ${taskId}`;
    await activity(tx, 'task', taskId, u.id, 'approved', { status: { from: 'review', to: 'done' }, step: cur.label });
    await notify(tx, { userIds: [t.assignee_id, t.review_requested_by], type: 'review_result', title: `최종 결재 완료: ${t.title}`,
      body: `${cur.label} 승인으로 완료되었습니다`, link: `/tasks/${taskId}`, entityType: 'task', entityId: taskId, actorId: u.id,
      dedupeKey: `apprdone:${taskId}:${cur.round}` });
    const { spawnNextRecurrence } = await import('./tasks');
    await spawnNextRecurrence(tx, taskId, u.id);
    const { runAutomations } = await import('./automation');
    await runAutomations(tx, { trigger: 'task_completed', taskId, actorId: u.id });
    return { status: 'done' };
  });
}

export function canManageLines(u: SessionUser) {
  return isAdmin(u);
}
