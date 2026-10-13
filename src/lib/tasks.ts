import { z } from 'zod';
import { db, type Sql } from './db';
import { accessibleUnitIds, assertUnitAccess, loadTaskForUser, taskVisibleSql, atLeast } from './access';
import { badRequest, conflict, forbidden, notFound } from './errors';
import { activity } from './log';
import { notify } from './notifications';
import { nextDate, normalizeRule } from './recurrence';
import { addDays, todaySeoul, weekRangeSeoul } from './time';
import { STATUS_LABEL, type SessionUser, type TaskStatus } from './types';
import { zDate, zTime, zUuid } from './api';

export const taskInput = z.object({
  title: z.string().trim().min(1, '제목을 입력하세요').max(200),
  description: z.string().max(20000).optional(),
  projectId: zUuid.nullable().optional(),
  parentId: zUuid.nullable().optional(),
  orgUnitId: zUuid.optional(),
  brandId: z.enum(['dagym', 'hilink', 'bodylab']).nullable().optional(),
  assigneeId: zUuid.nullable().optional(),
  /** WORKIN_V3 지시자(업무를 부여한 사람). 기본 = 만든 사람 */
  requestedById: zUuid.nullable().optional(),
  collaboratorIds: z.array(zUuid).max(30).optional(),
  status: z.enum(['todo', 'in_progress', 'review', 'on_hold', 'done']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  startDate: zDate.nullable().optional(),
  dueDate: zDate.nullable().optional(),
  dueTime: zTime.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  approvalRequired: z.boolean().optional(),
  recurrenceRule: z.string().max(300).nullable().optional(),
  checklist: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
  dependsOn: z.array(zUuid).max(30).optional(),
  sectionId: zUuid.nullable().optional(),
  taskType: z.enum(['normal', 'milestone', 'approval', 'inspection']).optional(),
  photoRequired: z.number().int().min(0).max(20).optional(),
  approvalLineId: zUuid.nullable().optional(),
  /** S-6 예상 소요 시간(분) */
  estimateMinutes: z.number().int().min(0).max(100000).nullable().optional(),
  /** 캘린더에 표시 (기본 켜짐) */
  showOnCalendar: z.boolean().optional(),
  sortOrder: z.number().optional(),
  version: z.number().int().optional(),
  reviewNote: z.string().max(2000).optional(),
});
export type TaskInput = z.infer<typeof taskInput>;

export const TASK_COLS = (sql: Sql) => sql`
  t.id, t.title, t.description, t.status, t.priority, t.project_id, t.parent_id, t.org_unit_id, t.brand_id,
  t.assignee_id, t.start_date, t.due_date, to_char(t.due_time, 'HH24:MI') as due_time, t.tags, t.approval_required,
  t.review_requested_at, t.approved_at, t.approved_by, t.completed_at, t.recurrence_rule, t.recurrence_stopped,
  t.version, t.created_by, t.created_at, t.updated_at, t.sort_order, t.section_id, t.assignee_ack_at, t.task_type, t.photo_required, t.approval_line_id,
  t.estimate_minutes, t.show_on_calendar, t.requested_by, rq.name as requested_by_name,
  (select coalesce(sum(extract(epoch from (be.end_at - be.start_at)) / 60), 0)::int from events be
    where be.deleted_at is null and be.kind = 'task_block' and (be.task_id = t.id or be.id in (select event_id from event_tasks where task_id = t.id and role = 'block'))) as scheduled_minutes,
  (select count(*)::int from event_tasks lk where lk.task_id = t.id) as event_count,
  (select count(*)::int from attachments ph where ph.task_id = t.id and ph.deleted_at is null and ph.upload_status = 'ready' and ph.kind = 'file' and ph.mime_type like 'image/%') as photo_count,
  (select coalesce(jsonb_object_agg(fv.field_id, fv.value), '{}'::jsonb) from task_field_values fv where fv.task_id = t.id) as fields,
  au.name as assignee_name, p.name as project_name, p.color as project_color, o.name as org_unit_name,
  (select count(*)::int from tasks s where s.parent_id = t.id and s.deleted_at is null) as subtask_count,
  (select count(*)::int from tasks s where s.parent_id = t.id and s.deleted_at is null and s.status = 'done') as subtask_done,
  (select count(*)::int from task_checklist_items ci where ci.task_id = t.id) as checklist_total,
  (select count(*)::int from task_checklist_items ci where ci.task_id = t.id and ci.done) as checklist_done,
  (select count(*)::int from comments cm where cm.task_id = t.id and cm.deleted_at is null) as comment_count,
  (select count(*)::int from attachments at where at.task_id = t.id and at.deleted_at is null) as attachment_count,
  (select count(*)::int from task_dependencies d join tasks dt on dt.id = d.depends_on_id
     where d.task_id = t.id and dt.status <> 'done' and dt.deleted_at is null) as blocked_by_count,
  (select max(a.created_at) from activities a where a.entity_type = 'task' and a.entity_id = t.id
     and (a.action = 'created' or a.changes ? 'assigneeId')) as assigned_at`;

export const TASK_FROM = (sql: Sql) => sql`
  from tasks t
  left join users au on au.id = t.assignee_id
  left join users rq on rq.id = t.requested_by
  left join projects p on p.id = t.project_id
  left join org_units o on o.id = t.org_unit_id`;

export const listQuery = z.object({
  // U-0a 주소창 값은 사람이 고칠 수 있다 — 모르는 보기·옵션 값은 오류 대신 기본값으로
  view: z.enum(['all', 'my', 'today', 'overdue', 'week', 'review', 'risk', 'requested']).catch('all'),
  projectId: zUuid.optional(),
  orgUnitId: zUuid.optional(),
  brandId: z.string().optional(),
  assigneeId: zUuid.optional(),
  requestedById: zUuid.optional(),
  status: z.string().optional(), // 콤마 구분
  q: z.string().max(100).optional(),
  from: zDate.optional().catch(undefined),
  to: zDate.optional().catch(undefined),
  parentId: zUuid.optional(),
  includeSubtasks: z.enum(['0', '1']).optional().catch(undefined),
  includeDone: z.enum(['0', '1']).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(1000).catch(500),
});

export async function listTasks(u: SessionUser, q: z.infer<typeof listQuery>) {
  const sql = db();
  const units = await accessibleUnitIds(u, sql);
  const today = todaySeoul();
  const conds = [sql`t.deleted_at is null`, taskVisibleSql(sql, u, units)];
  if (q.parentId) conds.push(sql`t.parent_id = ${q.parentId}`);
  else if (q.includeSubtasks !== '1') conds.push(sql`t.parent_id is null`);
  if (q.projectId) conds.push(sql`t.project_id = ${q.projectId}`);
  if (q.orgUnitId) {
    conds.push(sql`t.org_unit_id in (with recursive s as (select id from org_units where id = ${q.orgUnitId}
      union select c.id from org_units c join s on c.parent_id = s.id) select id from s)`);
  }
  if (q.brandId) conds.push(sql`t.brand_id = ${q.brandId}`);
  if (q.assigneeId) conds.push(sql`t.assignee_id = ${q.assigneeId}`);
  if (q.requestedById) conds.push(sql`t.requested_by = ${q.requestedById}`);
  if (q.status) {
    const st = q.status.split(',').filter((s) => s in STATUS_LABEL);
    if (st.length) conds.push(sql`t.status = any(${st})`);
  } else if (q.includeDone === '0') conds.push(sql`t.status <> 'done'`);
  if (q.q) {
    const like = '%' + q.q.replace(/[%_\\]/g, (m) => '\\' + m) + '%';
    conds.push(sql`(t.title ilike ${like} or t.description ilike ${like} or exists (select 1 from unnest(t.tags) tg where tg ilike ${like}))`);
  }
  if (q.from) conds.push(sql`coalesce(t.due_date, t.start_date) >= ${q.from}`);
  if (q.to) conds.push(sql`coalesce(t.start_date, t.due_date) <= ${q.to}`);
  switch (q.view) {
    case 'my':
      conds.push(sql`(t.assignee_id = ${u.id} or exists (select 1 from task_collaborators tc where tc.task_id = t.id and tc.user_id = ${u.id}))`);
      conds.push(sql`t.status <> 'done'`);
      break;
    case 'requested': // 내가 지시한 업무 (Asana "내가 배정한 작업")
      conds.push(sql`t.requested_by = ${u.id}`);
      break;
    case 'today':
      conds.push(sql`t.assignee_id = ${u.id} and t.status <> 'done' and (t.due_date <= ${today} or t.start_date <= ${today})`);
      break;
    case 'overdue':
      conds.push(sql`t.status <> 'done' and t.due_date < ${today}`);
      break;
    case 'week': {
      const w = weekRangeSeoul();
      conds.push(sql`t.status <> 'done' and t.due_date between ${w.start} and ${w.end}`);
      break;
    }
    case 'review':
      conds.push(sql`t.status = 'review'`);
      if (units !== null) conds.push(sql`t.org_unit_id = any(${units}::uuid[])`);
      if (!atLeast(u, 'site_manager')) conds.push(sql`false`);
      break;
    case 'risk': // S-6 마감 위험 후보: 예상 시간이 있고 2주 안에 마감인 미완료 업무 → 아래에서 가용 시간으로 거른다
      conds.push(sql`t.status <> 'done' and t.estimate_minutes > 0 and t.assignee_id is not null and t.due_date <= ${addDays(today, 14)}`);
      break;
  }
  const where = conds.reduce((a, c) => sql`${a} and ${c}`);
  const rows = await sql<any[]>`select ${TASK_COLS(sql)} ${TASK_FROM(sql)} where ${where}
    order by t.due_date asc nulls last, t.priority = 'urgent' desc, t.priority = 'high' desc, t.sort_order, t.created_at
    limit ${q.limit}`;
  if (q.view !== 'risk') return rows;
  const { deadlineRisk } = await import('./availability');
  const out = [];
  for (const r of rows) {
    const risk = await deadlineRisk(r);
    if (risk?.risk) out.push({ ...r, risk });
  }
  return out;
}

export async function getTaskDetail(u: SessionUser, id: string) {
  const sql = db();
  const { perms } = await loadTaskForUser(u, id, sql);
  const [t] = await sql`select ${TASK_COLS(sql)}, cu.name as created_by_name, apu.name as approved_by_name,
      parent.title as parent_title
    ${TASK_FROM(sql)}
    left join users cu on cu.id = t.created_by
    left join users apu on apu.id = t.approved_by
    left join tasks parent on parent.id = t.parent_id
    where t.id = ${id}`;
  const units = await accessibleUnitIds(u, sql);
  const [collaborators, checklist, subtasks, deps, comments, attachments, history, blocks] = await Promise.all([
    sql`select u.id, u.name from task_collaborators c join users u on u.id = c.user_id where c.task_id = ${id} order by u.name`,
    sql`select id, text, done, sort, done_at from task_checklist_items where task_id = ${id} order by sort, id`,
    sql`select ${TASK_COLS(sql)} ${TASK_FROM(sql)} where t.parent_id = ${id} and t.deleted_at is null
        and ${taskVisibleSql(sql, u, units)} order by t.sort_order, t.created_at`,
    sql`select dt.id, dt.title, dt.status, dt.due_date from task_dependencies d join tasks dt on dt.id = d.depends_on_id
        where d.task_id = ${id} and dt.deleted_at is null`,
    sql`select c.id, c.body, c.mentions, c.created_at, c.edited_at, c.author_id, u.name as author_name
        from comments c join users u on u.id = c.author_id where c.task_id = ${id} and c.deleted_at is null order by c.created_at`,
    sql`select a.*, u.name as created_by_name from attachments a join users u on u.id = a.created_by
        where a.task_id = ${id} and a.deleted_at is null and a.upload_status = 'ready' order by a.created_at`,
    sql`select a.id, a.action, a.changes, a.created_at, u.name as actor_name from activities a left join users u on u.id = a.actor_id
        where a.entity_type = 'task' and a.entity_id = ${id} order by a.created_at desc limit 100`,
    sql`select id, start_at, end_at, title from events where task_id = ${id} and deleted_at is null order by start_at`,
  ]);
  const { openRound, stepApprovers } = await import('./approvals');
  const approvals = await openRound(sql, id);
  const pending = t.status === 'review' ? approvals.find((a) => a.status === 'pending' && a.round === approvals[0]?.round) : null;
  const canDecide = pending ? (await stepApprovers(sql, t.org_unit_id, pending)).includes(u.id) : false;
  const fields = t.project_id ? await sql`select id, name, type, options, aggregate from project_fields where project_id = ${t.project_id} order by sort, created_at` : [];
  const { deadlineRisk } = await import('./availability');
  const risk = await deadlineRisk(t as never).catch(() => null);
  return { task: t, perms: { ...perms, decide: canDecide }, collaborators, checklist, subtasks, dependencies: deps, comments, attachments, history, timeBlocks: blocks, approvals, fields, risk };
}

async function validateRefs(sql: Sql, u: SessionUser, i: TaskInput, orgUnitId: string) {
  await assertUnitAccess(u, orgUnitId, sql);
  if (i.projectId) {
    const p = await sql`select org_unit_id from projects where id = ${i.projectId}`;
    if (!p[0]) throw badRequest('프로젝트가 없습니다');
    if (u.isDemo) await assertUnitAccess(u, p[0].org_unit_id, sql); // 체험 계정은 데모 조직 프로젝트만
  }
  const ids = [i.assigneeId, i.requestedById, ...(i.collaboratorIds ?? [])].filter(Boolean) as string[];
  if (ids.length) {
    const ok = await sql`select id from users where id = any(${ids}::uuid[]) and status = 'active' and (is_demo or ${!u.isDemo})`;
    if (ok.length !== new Set(ids).size) throw badRequest('비활성 사용자이거나 없는 사용자입니다');
  }
  if (u.isDemo && i.dependsOn?.length) { // 체험 계정은 데모 조직 업무만 선행으로
    const ok = await sql`select t.id from tasks t join org_units o on o.id = t.org_unit_id where t.id = any(${i.dependsOn}::uuid[]) and o.is_demo`;
    if (ok.length !== new Set(i.dependsOn).size) throw badRequest('선행 업무를 찾을 수 없습니다');
  }
  if (i.startDate && i.dueDate && i.startDate > i.dueDate) throw badRequest('시작일이 마감일보다 늦습니다');
}

export async function createTask(u: SessionUser, i: TaskInput) {
  const sql = db();
  let orgUnitId = i.orgUnitId;
  let brandId = i.brandId;
  if (i.parentId) {
    const { task: parent } = await loadTaskForUser(u, i.parentId, sql);
    orgUnitId ??= parent.org_unit_id;
    i.projectId ??= parent.project_id;
  }
  if (i.projectId && !orgUnitId) {
    const p = await sql<{ org_unit_id: string; brand_id: string | null }[]>`select org_unit_id, brand_id from projects where id = ${i.projectId}`;
    if (!p[0]) throw badRequest('프로젝트가 없습니다');
    orgUnitId = p[0].org_unit_id;
    brandId ??= p[0].brand_id as never;
  }
  if (!orgUnitId) {
    const m = await sql<{ org_unit_id: string }[]>`select org_unit_id from memberships where user_id = ${u.id} limit 1`;
    orgUnitId = m[0]?.org_unit_id ?? '00000000-0000-0000-0000-000000000001';
  }
  if (brandId === undefined) {
    const o = await sql<{ brand_id: string | null }[]>`select brand_id from org_units where id = ${orgUnitId}`;
    brandId = (o[0]?.brand_id as never) ?? null;
  }
  await validateRefs(sql, u, i, orgUnitId);
  const rule = normalizeRule(i.recurrenceRule);
  if (rule && !i.dueDate) throw badRequest('반복 업무는 마감일이 필요합니다');
  const sectionId = i.sectionId ? await checkSection(sql, i.sectionId, i.projectId ?? null) : null;
  if (i.taskType === 'milestone') i.startDate = null; // 마일스톤은 기간 없이 하루
  if (i.approvalLineId) await checkLine(sql, i.approvalLineId);
  const status = i.status ?? 'todo';
  if (status === 'done') throw badRequest('새 업무를 완료 상태로 만들 수 없습니다');

  return sql.begin(async (tx) => {
    const [t] = await tx<{ id: string }[]>`
      insert into tasks (project_id, parent_id, org_unit_id, brand_id, title, description, status, priority, assignee_id,
        start_date, due_date, due_time, tags, approval_required, recurrence_rule, created_by, sort_order, section_id, assignee_ack_at,
        task_type, photo_required, approval_line_id, estimate_minutes, requested_by)
      values (${i.projectId ?? null}, ${i.parentId ?? null}, ${orgUnitId}, ${brandId ?? null}, ${i.title}, ${i.description ?? ''},
        ${status}, ${i.priority ?? 'normal'}, ${i.assigneeId ?? null}, ${i.startDate ?? null}, ${i.dueDate ?? null},
        ${i.dueTime ?? null}, ${i.tags ?? []}, ${i.approvalRequired ?? true}, ${rule}, ${u.id}, extract(epoch from now()),
        ${sectionId}, ${i.assigneeId && i.assigneeId === u.id ? new Date() : null},
        ${i.taskType ?? 'normal'}, ${i.photoRequired ?? (i.taskType === 'inspection' ? 1 : 0)}, ${i.approvalLineId ?? null}, ${i.estimateMinutes ?? null}, ${i.requestedById ?? u.id})
      returning id`;
    for (const c of new Set(i.collaboratorIds ?? [])) {
      await tx`insert into task_collaborators (task_id, user_id) values (${t.id}, ${c}) on conflict do nothing`;
    }
    let n = 0;
    for (const text of i.checklist ?? []) {
      await tx`insert into task_checklist_items (task_id, text, sort) values (${t.id}, ${text}, ${n++})`;
    }
    for (const d of i.dependsOn ?? []) {
      await tx`insert into task_dependencies (task_id, depends_on_id) values (${t.id}, ${d}) on conflict do nothing`;
    }
    await activity(tx, 'task', t.id, u.id, 'created', { title: i.title, assigneeId: i.assigneeId ?? null, dueDate: i.dueDate ?? null });
    if (i.assigneeId) {
      await notify(tx, {
        userIds: [i.assigneeId], type: 'task_assigned', title: `새 업무 배정: ${i.title}`,
        body: `${u.name}님이 업무를 배정했습니다${i.dueDate ? ` · 마감 ${i.dueDate}` : ''}`,
        link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id, actorId: u.id, dedupeKey: `assign:${t.id}:${i.assigneeId}`,
      });
    }
    if (i.collaboratorIds?.length) {
      await notify(tx, {
        userIds: i.collaboratorIds, type: 'task_assigned', title: `협업 요청: ${i.title}`, body: `${u.name}님이 협업자로 추가했습니다`,
        link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id, actorId: u.id, dedupeKey: `collab:${t.id}`,
      });
    }
    const { runAutomations } = await import('./automation');
    await runAutomations(tx, { trigger: 'task_created', taskId: t.id, actorId: u.id });
    return { id: t.id };
  });
}

async function approverIds(sql: Sql, orgUnitId: string, projectId: string | null): Promise<string[]> {
  // 업무 소속 단위(및 상위 단위)의 현장 관리자 이상 + 프로젝트 담당자. 없으면 본사 관리자·대표.
  const rows = await sql<{ id: string }[]>`
    with recursive up as (
      select id, parent_id from org_units where id = ${orgUnitId}
      union select o.id, o.parent_id from org_units o join up on o.id = up.parent_id
    )
    select distinct u.id from users u join memberships m on m.user_id = u.id
    where m.org_unit_id in (select id from up) and u.status = 'active' and u.role in ('dept_lead','site_manager')
    union
    select owner_id from projects where id = ${projectId} and owner_id is not null`;
  if (rows.length) return rows.map((r) => r.id);
  const admins = await sql<{ id: string }[]>`select id from users where role in ('owner','admin') and status = 'active'`;
  return admins.map((r) => r.id);
}

export async function updateTask(u: SessionUser, id: string, i: Partial<TaskInput>) {
  const sql = db();
  return sql.begin(async (tx) => {
    const { perms } = await loadTaskForUser(u, id, tx);
    const [cur] = await tx`select * , to_char(due_time,'HH24:MI') as due_time_s from tasks where id = ${id} for update`;
    if (i.version !== undefined && i.version !== cur.version) {
      throw conflict('다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.', { currentVersion: cur.version });
    }
    if (!perms.edit) throw forbidden('이 업무를 수정할 권한이 없습니다');
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const set: Record<string, unknown> = {};
    const fields: [keyof TaskInput, string][] = [
      ['title', 'title'], ['description', 'description'], ['projectId', 'project_id'], ['brandId', 'brand_id'],
      ['assigneeId', 'assignee_id'], ['priority', 'priority'], ['startDate', 'start_date'], ['dueDate', 'due_date'],
      ['tags', 'tags'], ['approvalRequired', 'approval_required'], ['orgUnitId', 'org_unit_id'], ['sectionId', 'section_id'], ['sortOrder', 'sort_order'], ['taskType', 'task_type'], ['photoRequired', 'photo_required'], ['approvalLineId', 'approval_line_id'], ['estimateMinutes', 'estimate_minutes'], ['showOnCalendar', 'show_on_calendar'], ['requestedById', 'requested_by'],
    ];
    for (const [k, col] of fields) {
      if (i[k] === undefined) continue;
      const before = cur[col];
      const after = i[k];
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        set[col] = after;
        changes[k] = { from: before, to: after };
      }
    }
    if (i.dueTime !== undefined && (i.dueTime ?? null) !== (cur.due_time_s ?? null)) {
      set.due_time = i.dueTime;
      changes.dueTime = { from: cur.due_time_s, to: i.dueTime };
    }
    if (i.recurrenceRule !== undefined) {
      const rule = normalizeRule(i.recurrenceRule);
      if (rule !== cur.recurrence_rule) {
        if (rule && !(i.dueDate ?? cur.due_date)) throw badRequest('반복 업무는 마감일이 필요합니다');
        set.recurrence_rule = rule;
        set.recurrence_stopped = false;
        changes.recurrenceRule = { from: cur.recurrence_rule, to: rule };
      }
    }
    if (set.org_unit_id) await assertUnitAccess(u, set.org_unit_id as string, tx);
    // 섹션은 같은 프로젝트의 것만. 프로젝트를 옮기면 섹션은 비운다
    if ('project_id' in set && !('section_id' in set) && cur.section_id) { set.section_id = null; }
    if (set.section_id) await checkSection(tx, set.section_id as string, ('project_id' in set ? set.project_id : cur.project_id) as string | null);
    delete changes.sortOrder; // 순서 변경은 이력에 남기지 않는다
    // 담당자가 바뀌면 새 담당자의 '확인' 전 상태로 (본인에게 배정하면 확인 처리)
    if ('assignee_id' in set) set.assignee_ack_at = set.assignee_id === u.id ? new Date() : null;
    if ('approval_required' in set && !perms.approve) throw forbidden('검토 필요 여부는 관리자만 바꿀 수 있습니다');
    const start = (set.start_date ?? cur.start_date) as string | null;
    const due = (set.due_date ?? cur.due_date) as string | null;
    if (start && due && start > due) throw badRequest('시작일이 마감일보다 늦습니다');
    if (set.assignee_id) await validateRefs(tx, u, { assigneeId: set.assignee_id as string } as TaskInput, cur.org_unit_id);
    if (set.requested_by) await validateRefs(tx, u, { requestedById: set.requested_by as string } as TaskInput, cur.org_unit_id);
    if (u.isDemo) await validateRefs(tx, u, { projectId: (set.project_id as string) ?? undefined, collaboratorIds: i.collaboratorIds, dependsOn: i.dependsOn } as TaskInput, (set.org_unit_id as string) ?? cur.org_unit_id);
    if (('photo_required' in set || 'approval_line_id' in set) && !perms.approve) throw forbidden('사진 증빙·결재선은 관리자가 정합니다');
    if (set.approval_line_id) await checkLine(tx, set.approval_line_id as string);
    if (cur.status === 'review' && 'approval_line_id' in set) throw conflict('결재 진행 중에는 결재선을 바꿀 수 없습니다');
    if ((set.task_type ?? cur.task_type) === 'milestone' && (set.start_date ?? cur.start_date)) set.start_date = null;
    const lineId = ('approval_line_id' in set ? set.approval_line_id : cur.approval_line_id) as string | null;

    // 상태 변경
    let statusEvent: string | null = null;
    if (i.status && i.status !== cur.status) {
      const to = i.status as TaskStatus;
      // B-7 사진 증빙: 검토 요청·완료 전에 필요한 사진 수 확인
      const needPhotos = Number(set.photo_required ?? cur.photo_required ?? 0);
      if ((to === 'done' || to === 'review') && needPhotos > 0) {
        const [{ n }] = await tx<{ n: number }[]>`select count(*)::int n from attachments where task_id = ${id} and deleted_at is null
          and upload_status = 'ready' and kind = 'file' and mime_type like 'image/%'`;
        if (n < needPhotos) throw conflict(`완료 증빙 사진 ${needPhotos}장이 필요합니다 (현재 ${n}장). 사진 촬영으로 첨부해 주세요.`);
      }
      if (to === 'done' && lineId) throw forbidden('결재선이 지정된 업무입니다. "검토 요청"으로 결재를 올려 주세요.');
      if (to === 'done') {
        if (cur.approval_required && !perms.approve) {
          throw forbidden('이 업무는 관리자 확인이 필요합니다. "검토 요청"으로 바꿔 주세요.');
        }
        const blockers = await tx`select 1 from task_dependencies d join tasks dt on dt.id = d.depends_on_id
          where d.task_id = ${id} and dt.status <> 'done' and dt.deleted_at is null`;
        if (blockers.length) throw conflict('선행 업무가 아직 완료되지 않았습니다');
        set.completed_at = new Date();
        if (cur.approval_required) { set.approved_at = new Date(); set.approved_by = u.id; }
        statusEvent = cur.status === 'review' ? 'approved' : 'completed';
      } else if (to === 'review') {
        set.review_requested_at = new Date();
        set.review_requested_by = u.id;
        statusEvent = 'review_requested';
      } else {
        if (cur.status === 'review' && lineId) {
          const { cancelOpenRound } = await import('./approvals');
          await cancelOpenRound(tx, id);
        }
        if (cur.status === 'review' && perms.approve && cur.review_requested_by !== u.id) statusEvent = 'review_rejected';
        if (cur.status === 'done') { set.completed_at = null; set.approved_at = null; set.approved_by = null; statusEvent = 'reopened'; }
      }
      set.status = to;
      changes.status = { from: cur.status, to };
    }
    if (Object.keys(set).length === 0 && i.collaboratorIds === undefined && i.checklist === undefined && i.dependsOn === undefined) {
      return { id, version: cur.version, changed: false };
    }
    set.updated_at = new Date();
    const [upd] = await tx<{ version: number }[]>`
      update tasks set ${tx(set as never, ...(Object.keys(set) as never[]))}, version = version + 1 where id = ${id} returning version`;

    if (i.collaboratorIds) {
      const before = (await tx<{ user_id: string }[]>`select user_id from task_collaborators where task_id = ${id}`).map((r) => r.user_id);
      await tx`delete from task_collaborators where task_id = ${id}`;
      for (const c of new Set(i.collaboratorIds)) await tx`insert into task_collaborators (task_id, user_id) values (${id}, ${c})`;
      const added = i.collaboratorIds.filter((c) => !before.includes(c));
      if (added.length || before.length !== i.collaboratorIds.length) changes.collaborators = { from: before, to: i.collaboratorIds };
      if (added.length) {
        await notify(tx, { userIds: added, type: 'task_assigned', title: `협업 요청: ${set.title ?? cur.title}`, body: `${u.name}님이 협업자로 추가했습니다`,
          link: `/tasks/${id}`, entityType: 'task', entityId: id, actorId: u.id, dedupeKey: `collab:${id}:${upd.version}` });
      }
    }
    if (i.dependsOn) {
      for (const d of i.dependsOn) if (d === id) throw badRequest('자기 자신을 선행 업무로 지정할 수 없습니다');
      // 순환 방지
      for (const d of i.dependsOn) {
        const cyc = await tx`with recursive c as (select depends_on_id from task_dependencies where task_id = ${d}
          union select td.depends_on_id from task_dependencies td join c on td.task_id = c.depends_on_id)
          select 1 from c where depends_on_id = ${id}`;
        if (cyc.length) throw badRequest('업무 의존관계가 순환됩니다');
      }
      await tx`delete from task_dependencies where task_id = ${id}`;
      for (const d of new Set(i.dependsOn)) await tx`insert into task_dependencies (task_id, depends_on_id) values (${id}, ${d})`;
      changes.dependsOn = { from: null, to: i.dependsOn };
    }
    if (Object.keys(changes).length) {
      await activity(tx, 'task', id, u.id, statusEvent ?? 'updated', { ...changes, ...(i.reviewNote ? { note: i.reviewNote } : {}) });
    }

    const title = (set.title as string) ?? cur.title;
    if (set.assignee_id) {
      await notify(tx, { userIds: [set.assignee_id as string], type: 'task_assigned', title: `업무 배정: ${title}`,
        body: `${u.name}님이 업무를 배정했습니다`, link: `/tasks/${id}`, entityType: 'task', entityId: id, actorId: u.id,
        dedupeKey: `assign:${id}:${set.assignee_id}:${upd.version}` });
    }
    if ('due_date' in set || 'due_time' in set) {
      // V5 "업무에도 추가"로 연결된 일정도 같은 날짜·시각으로
      const { syncEventsFromTask } = await import('./eventtasks');
      await syncEventsFromTask(tx, id, ('due_date' in set ? set.due_date : cur.due_date) as string | null, ('due_time' in set ? set.due_time : cur.due_time_s) as string | null, u.id);
      await notify(tx, { userIds: [cur.assignee_id, ...(await collabIds(tx, id))], type: 'event_changed', title: `마감일 변경: ${title}`,
        body: `${cur.due_date ?? '없음'} → ${set.due_date ?? cur.due_date ?? '없음'}`, link: `/tasks/${id}`, entityType: 'task',
        entityId: id, actorId: u.id, dedupeKey: `due:${id}:${upd.version}` });
    }
    if (statusEvent === 'review_requested' && lineId) {
      const { startApprovalRound } = await import('./approvals');
      await startApprovalRound(tx, id, lineId, cur.org_unit_id, u.id, title);
    } else if (statusEvent === 'review_requested') {
      await notify(tx, { userIds: await approverIds(tx, cur.org_unit_id, cur.project_id), type: 'review_requested',
        title: `검토 요청: ${title}`, body: `${u.name}님이 완료 검토를 요청했습니다`, link: `/tasks/${id}`,
        entityType: 'task', entityId: id, actorId: u.id, dedupeKey: `review:${id}:${upd.version}` });
    }
    if (statusEvent === 'approved' || statusEvent === 'review_rejected') {
      await notify(tx, { userIds: [cur.assignee_id, cur.review_requested_by], type: 'review_result',
        title: `${statusEvent === 'approved' ? '최종 완료 확인' : '보완 요청'}: ${title}`,
        body: statusEvent === 'approved' ? `${u.name}님이 완료를 확인했습니다` : `${u.name}님이 보완을 요청했습니다${i.reviewNote ? `: ${i.reviewNote}` : ''}`,
        link: `/tasks/${id}`, entityType: 'task', entityId: id, actorId: u.id, dedupeKey: `reviewres:${id}:${upd.version}` });
    }
    // WORKIN_V3 지시자에게: 담당자가 완료하거나 검토를 요청하면 알림 (지시자 본인이 한 변경은 제외)
    const requester = (set.requested_by ?? cur.requested_by) as string | null;
    if (requester && requester !== u.id && (set.status === 'done' || statusEvent === 'review_requested')) {
      await notify(tx, { userIds: [requester], type: 'task_done_for_requester',
        title: `${set.status === 'done' ? '완료' : '검토 요청'}: ${title}`, body: `${u.name}님이 지시하신 업무를 ${set.status === 'done' ? '완료했습니다' : '완료하고 검토를 요청했습니다'}`,
        link: `/tasks/${id}`, entityType: 'task', entityId: id, actorId: u.id, dedupeKey: `reqdone:${id}:${upd.version}` });
    }
    let spawned: string | null = null;
    if (set.status === 'done') spawned = await spawnNextRecurrence(tx, id, u.id);
    // B-10 자동화 (사람이 한 변경에만 반응, 규칙이 한 변경은 다시 부르지 않음)
    const { runAutomations } = await import('./automation');
    if (set.status) await runAutomations(tx, { trigger: set.status === 'done' ? 'task_completed' : 'status_changed', taskId: id, actorId: u.id, fromStatus: cur.status });
    if ('section_id' in set && set.section_id) await runAutomations(tx, { trigger: 'section_moved', taskId: id, actorId: u.id });
    return { id, version: upd.version, changed: true, spawned };
  });
}

async function collabIds(sql: Sql, id: string) {
  return (await sql<{ user_id: string }[]>`select user_id from task_collaborators where task_id = ${id}`).map((r) => r.user_id);
}

/** 반복 업무의 다음 회차 생성 (완료 시 또는 스케줄러). 같은 회차는 한 번만 만든다. */
export async function spawnNextRecurrence(sql: Sql, taskId: string, actorId: string | null): Promise<string | null> {
  const [t] = await sql`select *, to_char(due_time,'HH24:MI') as due_time_s from tasks where id = ${taskId} for update`;
  if (!t || !t.recurrence_rule || t.recurrence_stopped || t.deleted_at || !t.due_date) return null;
  const root = t.recurrence_source_id ?? t.id;
  const next = nextDate(t.recurrence_rule, t.due_date, t.due_date);
  if (!next) {
    await sql`update tasks set recurrence_stopped = true where id = ${taskId}`;
    return null;
  }
  const exists = await sql`select id from tasks where (recurrence_source_id = ${root} or id = ${root}) and due_date = ${next} and deleted_at is null`;
  if (exists.length) {
    await sql`update tasks set recurrence_stopped = true where id = ${taskId}`;
    return null;
  }
  const offset = t.start_date ? Math.round((Date.parse(t.due_date) - Date.parse(t.start_date)) / 86400000) : null;
  const [n] = await sql<{ id: string }[]>`
    insert into tasks (project_id, parent_id, org_unit_id, brand_id, title, description, status, priority, assignee_id,
      start_date, due_date, due_time, tags, approval_required, recurrence_rule, recurrence_source_id, created_by, sort_order)
    values (${t.project_id}, ${t.parent_id}, ${t.org_unit_id}, ${t.brand_id}, ${t.title}, ${t.description}, 'todo', ${t.priority},
      ${t.assignee_id}, ${offset === null ? null : addDays(next, -offset)}, ${next}, ${t.due_time_s}, ${t.tags}, ${t.approval_required},
      ${t.recurrence_rule}, ${root}, ${t.created_by}, extract(epoch from now()))
    returning id`;
  await sql`insert into task_collaborators (task_id, user_id) select ${n.id}, user_id from task_collaborators where task_id = ${taskId}`;
  await sql`insert into task_checklist_items (task_id, text, sort) select ${n.id}, text, sort from task_checklist_items where task_id = ${taskId}`;
  await sql`update tasks set recurrence_stopped = true where id = ${taskId}`;
  await activity(sql, 'task', n.id, actorId, 'recurring_created', { from: taskId, dueDate: next });
  await notify(sql, { userIds: [t.assignee_id], type: 'recurring_created', title: `반복 업무 생성: ${t.title}`,
    body: `다음 회차 마감 ${next}`, link: `/tasks/${n.id}`, entityType: 'task', entityId: n.id, actorId: null,
    dedupeKey: `recur:${root}:${next}` });
  return n.id;
}

export async function deleteTask(u: SessionUser, id: string) {
  const sql = db();
  const { perms } = await loadTaskForUser(u, id, sql);
  if (!perms.delete) throw forbidden('삭제 권한이 없습니다 (작성자 또는 관리자)');
  await sql.begin(async (tx) => {
    await tx`update tasks set deleted_at = now(), updated_at = now(), version = version + 1 where id = ${id} or parent_id = ${id}`;
    await activity(tx, 'task', id, u.id, 'deleted');
  });
  return { ok: true };
}

// ---- 댓글 ----
export async function addComment(u: SessionUser, taskId: string, text: string) {
  const sql = db();
  const { task } = await loadTaskForUser(u, taskId, sql);
  const body = text.trim();
  if (!body) throw badRequest('내용을 입력하세요');
  // 멘션: @[이름](uuid) 형식
  const mentionIds = [...body.matchAll(/@\[[^\]]{1,50}\]\(([0-9a-f-]{36})\)/g)].map((m) => m[1]);
  return sql.begin(async (tx) => {
    const validMentions = mentionIds.length
      ? (await tx<{ id: string }[]>`select id from users where id = any(${mentionIds}::uuid[]) and status = 'active'`).map((r) => r.id)
      : [];
    const [c] = await tx<{ id: string; created_at: Date }[]>`
      insert into comments (task_id, author_id, body, mentions) values (${taskId}, ${u.id}, ${body}, ${validMentions})
      returning id, created_at`;
    const [t] = await tx<{ title: string }[]>`select title from tasks where id = ${taskId}`;
    const preview = body.replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/g, '@$1').slice(0, 120);
    // 멘션된 사람이 그 업무를 볼 수 없으면 협업자로 추가하지 않고 알림도 보내지 않는다 (권한 우회 방지)
    const visibleMentions: string[] = [];
    for (const m of validMentions) {
      const [mu] = await tx`select id, email, name, role, status, timezone from users where id = ${m}`;
      const { taskPerms } = await import('./access');
      const p = await taskPerms({ ...(mu as any), sessionId: '' }, task, tx);
      if (p.view) visibleMentions.push(m);
    }
    if (visibleMentions.length) {
      await notify(tx, { userIds: visibleMentions, type: 'mention', title: `${u.name}님이 언급했습니다: ${t.title}`, body: preview,
        link: `/tasks/${taskId}#c-${c.id}`, entityType: 'task', entityId: taskId, actorId: u.id, dedupeKey: `mention:${c.id}` });
    }
    const followers = [task.assignee_id, task.created_by, ...(await collabIds(tx, taskId))].filter((x) => x && !visibleMentions.includes(x));
    await notify(tx, { userIds: followers, type: 'comment', title: `새 댓글: ${t.title}`, body: `${u.name}: ${preview}`,
      link: `/tasks/${taskId}#c-${c.id}`, entityType: 'task', entityId: taskId, actorId: u.id, dedupeKey: `comment:${c.id}` });
    return { id: c.id, createdAt: c.created_at, mentions: visibleMentions };
  });
}

export async function getProjectOrThrow(u: SessionUser, projectId: string) {
  const sql = db();
  const [p]: any[] = await sql`select p.*, o.name as org_unit_name, ou.name as owner_name from projects p
    join org_units o on o.id = p.org_unit_id left join users ou on ou.id = p.owner_id where p.id = ${projectId}`;
  if (!p) throw notFound('프로젝트가 없습니다');
  const units = await accessibleUnitIds(u, sql);
  if (units !== null && !units.includes(p.org_unit_id)) {
    // 프로젝트 소속 밖이라도 배정된 업무가 있으면 프로젝트 이름은 볼 수 있다
    const mine = await sql`select 1 from tasks t where t.project_id = ${projectId} and t.deleted_at is null and ${taskVisibleSql(sql, u, units)} limit 1`;
    if (!mine.length) throw notFound('프로젝트가 없습니다');
    return { ...p, limited: true };
  }
  return { ...p, limited: false };
}

/** 멘션 대상: 요청자가 볼 수 있는 사용자 중 이 업무를 볼 수 있는 사람만 (서버 권한 기준) */
export async function mentionableUsers(u: SessionUser, taskId: string) {
  const sql = db();
  const { task } = await loadTaskForUser(u, taskId, sql);
  const { directory } = await import('./admin');
  const { taskPerms } = await import('./access');
  const dir = await directory(u, sql);
  const out: { id: string; name: string; title: string | null }[] = [];
  for (const cand of dir.users as any[]) {
    const p = await taskPerms({ id: cand.id, email: cand.email, name: cand.name, role: cand.role, status: 'active', timezone: 'Asia/Seoul', sessionId: '' }, task, sql);
    if (p.view) out.push({ id: cand.id, name: cand.name, title: cand.title });
  }
  return out;
}

async function checkSection(sql: Sql, sectionId: string, projectId: string | null) {
  const [s] = await sql<{ project_id: string }[]>`select project_id from project_sections where id = ${sectionId}`;
  if (!s || s.project_id !== projectId) throw badRequest('이 프로젝트의 섹션이 아닙니다');
  return sectionId;
}

/** B-2 담당자 확인: 새로 배정됨 묶음에서 빼낸다 (담당자 본인만) */
export async function ackTask(u: SessionUser, id: string) {
  const sql = db();
  const { task } = await loadTaskForUser(u, id, sql);
  if (task.assignee_id !== u.id) throw forbidden('담당자만 확인할 수 있습니다');
  await sql`update tasks set assignee_ack_at = coalesce(assignee_ack_at, now()) where id = ${id}`;
  return { ok: true };
}

async function checkLine(sql: Sql, lineId: string) {
  const [l] = await sql<{ active: boolean }[]>`select active from approval_lines where id = ${lineId}`;
  if (!l || !l.active) throw badRequest('사용할 수 없는 결재선입니다');
}

// ---- B-13 후속 업무 · 복제 · 중복 통합 ----
export async function followUpTask(u: SessionUser, id: string, title?: string) {
  const sql = db();
  const { perms } = await loadTaskForUser(u, id, sql);
  if (!perms.edit) throw forbidden();
  const [t] = await sql`select project_id, section_id, org_unit_id, brand_id, title, assignee_id, priority from tasks where id = ${id}`;
  const r = await createTask(u, { title: title?.trim() || `[후속] ${t.title}`, projectId: t.project_id, sectionId: t.section_id, orgUnitId: t.org_unit_id,
    brandId: t.brand_id, assigneeId: t.assignee_id, priority: t.priority, dependsOn: [id], description: `후속 업무 — 원 업무: ${t.title}` });
  await activity(sql, 'task', id, u.id, 'follow_up_created', { followUp: r.id });
  return r;
}

export async function duplicateTask(u: SessionUser, id: string, withSubtasks = true) {
  const sql = db();
  await loadTaskForUser(u, id, sql);
  const [t] = await sql`select *, to_char(due_time,'HH24:MI') as due_time_s from tasks where id = ${id}`;
  const cl = await sql<{ text: string }[]>`select text from task_checklist_items where task_id = ${id} order by sort`;
  const collab = (await sql<{ user_id: string }[]>`select user_id from task_collaborators where task_id = ${id}`).map((r) => r.user_id);
  const r = await createTask(u, { title: `${t.title} (복제)`, description: t.description, projectId: t.project_id, sectionId: t.section_id, orgUnitId: t.org_unit_id,
    brandId: t.brand_id, assigneeId: t.assignee_id, priority: t.priority, startDate: t.start_date, dueDate: t.due_date, dueTime: t.due_time_s, tags: t.tags,
    approvalRequired: t.approval_required, taskType: t.task_type, photoRequired: t.photo_required, approvalLineId: t.approval_line_id, estimateMinutes: t.estimate_minutes,
    collaboratorIds: collab, checklist: cl.map((c) => c.text) });
  if (withSubtasks) {
    const subs = await sql<{ title: string; assignee_id: string | null; due_date: string | null }[]>`select title, assignee_id, due_date from tasks where parent_id = ${id} and deleted_at is null order by sort_order`;
    for (const s of subs) await createTask(u, { title: s.title, parentId: r.id, assigneeId: s.assignee_id, dueDate: s.due_date, approvalRequired: false });
  }
  await sql`insert into task_field_values (task_id, field_id, value) select ${r.id}, field_id, value from task_field_values where task_id = ${id}`;
  return r;
}

/** 중복 업무 통합: 원본(id)의 댓글·첨부·협업자·하위 업무를 대상(intoId)으로 옮기고 원본은 삭제 처리 */
export async function mergeTask(u: SessionUser, id: string, intoId: string) {
  if (id === intoId) throw badRequest('같은 업무로는 통합할 수 없습니다');
  const sql = db();
  return sql.begin(async (tx) => {
    const a = await loadTaskForUser(u, id, tx);
    const b = await loadTaskForUser(u, intoId, tx);
    if (!a.perms.delete || !b.perms.edit) throw forbidden('통합하려면 원본 삭제 권한과 대상 수정 권한이 필요합니다');
    const [src] = await tx`select title from tasks where id = ${id}`;
    const [dst] = await tx`select title from tasks where id = ${intoId}`;
    await tx`update comments set task_id = ${intoId} where task_id = ${id}`;
    await tx`update attachments set task_id = ${intoId} where task_id = ${id}`;
    await tx`update tasks set parent_id = ${intoId} where parent_id = ${id} and deleted_at is null`;
    await tx`insert into task_collaborators (task_id, user_id) select ${intoId}, user_id from task_collaborators where task_id = ${id} on conflict do nothing`;
    await tx`insert into comments (task_id, author_id, body) values (${intoId}, ${u.id}, ${`[중복 통합] '${src.title}' 업무를 이 업무로 통합했습니다`})`;
    await tx`update tasks set deleted_at = now(), version = version + 1, updated_at = now() where id = ${id}`;
    await activity(tx, 'task', id, u.id, 'merged_into', { into: intoId, title: dst.title });
    await activity(tx, 'task', intoId, u.id, 'merged_from', { from: id, title: src.title });
    return { id: intoId };
  });
}

/**
 * WORKIN_V3 직접 순서: 화면에 보이는 순서대로 id 목록을 받아 sort_order 를 다시 매긴다(모든 화면 공통 순서).
 * 볼 수 있고 수정할 수 있는 업무만 바꾼다(나머지는 조용히 건너뜀).
 */
export async function reorderTasks(u: SessionUser, ids: string[]) {
  const sql = db();
  const units = await accessibleUnitIds(u, sql);
  const ok = await sql<{ id: string }[]>`select t.id from tasks t where t.id = any(${ids}::uuid[]) and t.deleted_at is null and ${taskVisibleSql(sql, u, units)}`;
  const allowed = new Set<string>();
  for (const r of ok) { const { perms } = await loadTaskForUser(u, r.id, sql).catch(() => ({ perms: { edit: false } as any })); if (perms.edit) allowed.add(r.id); }
  const rows = ids.map((id, i) => ({ id, i })).filter((x) => allowed.has(x.id));
  if (rows.length) {
    await sql`update tasks t set sort_order = v.ord from (select unnest(${rows.map((r) => r.id)}::uuid[]) as id, unnest(${rows.map((r) => r.i)}::float8[]) as ord) v where t.id = v.id`;
  }
  return { updated: rows.length };
}
