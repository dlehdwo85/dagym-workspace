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
  version: z.number().int().optional(),
  reviewNote: z.string().max(2000).optional(),
});
export type TaskInput = z.infer<typeof taskInput>;

const TASK_COLS = (sql: Sql) => sql`
  t.id, t.title, t.description, t.status, t.priority, t.project_id, t.parent_id, t.org_unit_id, t.brand_id,
  t.assignee_id, t.start_date, t.due_date, to_char(t.due_time, 'HH24:MI') as due_time, t.tags, t.approval_required,
  t.review_requested_at, t.approved_at, t.approved_by, t.completed_at, t.recurrence_rule, t.recurrence_stopped,
  t.version, t.created_by, t.created_at, t.updated_at, t.sort_order,
  au.name as assignee_name, p.name as project_name, p.color as project_color, o.name as org_unit_name,
  (select count(*)::int from tasks s where s.parent_id = t.id and s.deleted_at is null) as subtask_count,
  (select count(*)::int from tasks s where s.parent_id = t.id and s.deleted_at is null and s.status = 'done') as subtask_done,
  (select count(*)::int from task_checklist_items ci where ci.task_id = t.id) as checklist_total,
  (select count(*)::int from task_checklist_items ci where ci.task_id = t.id and ci.done) as checklist_done,
  (select count(*)::int from comments cm where cm.task_id = t.id and cm.deleted_at is null) as comment_count,
  (select count(*)::int from attachments at where at.task_id = t.id and at.deleted_at is null) as attachment_count,
  (select count(*)::int from task_dependencies d join tasks dt on dt.id = d.depends_on_id
     where d.task_id = t.id and dt.status <> 'done' and dt.deleted_at is null) as blocked_by_count`;

const TASK_FROM = (sql: Sql) => sql`
  from tasks t
  left join users au on au.id = t.assignee_id
  left join projects p on p.id = t.project_id
  left join org_units o on o.id = t.org_unit_id`;

export const listQuery = z.object({
  view: z.enum(['all', 'my', 'today', 'overdue', 'week', 'review']).default('all'),
  projectId: zUuid.optional(),
  orgUnitId: zUuid.optional(),
  brandId: z.string().optional(),
  assigneeId: zUuid.optional(),
  status: z.string().optional(), // 콤마 구분
  q: z.string().max(100).optional(),
  from: zDate.optional(),
  to: zDate.optional(),
  parentId: zUuid.optional(),
  includeSubtasks: z.enum(['0', '1']).optional(),
  includeDone: z.enum(['0', '1']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
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
  }
  const where = conds.reduce((a, c) => sql`${a} and ${c}`);
  return sql`select ${TASK_COLS(sql)} ${TASK_FROM(sql)} where ${where}
    order by t.due_date asc nulls last, t.priority = 'urgent' desc, t.priority = 'high' desc, t.sort_order, t.created_at
    limit ${q.limit}`;
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
  return { task: t, perms, collaborators, checklist, subtasks, dependencies: deps, comments, attachments, history, timeBlocks: blocks };
}

async function validateRefs(sql: Sql, u: SessionUser, i: TaskInput, orgUnitId: string) {
  await assertUnitAccess(u, orgUnitId, sql);
  if (i.projectId) {
    const p = await sql`select org_unit_id from projects where id = ${i.projectId}`;
    if (!p[0]) throw badRequest('프로젝트가 없습니다');
  }
  const ids = [i.assigneeId, ...(i.collaboratorIds ?? [])].filter(Boolean) as string[];
  if (ids.length) {
    const ok = await sql`select id from users where id = any(${ids}::uuid[]) and status = 'active'`;
    if (ok.length !== new Set(ids).size) throw badRequest('비활성 사용자이거나 없는 사용자입니다');
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
  const status = i.status ?? 'todo';
  if (status === 'done') throw badRequest('새 업무를 완료 상태로 만들 수 없습니다');

  return sql.begin(async (tx) => {
    const [t] = await tx<{ id: string }[]>`
      insert into tasks (project_id, parent_id, org_unit_id, brand_id, title, description, status, priority, assignee_id,
        start_date, due_date, due_time, tags, approval_required, recurrence_rule, created_by, sort_order)
      values (${i.projectId ?? null}, ${i.parentId ?? null}, ${orgUnitId}, ${brandId ?? null}, ${i.title}, ${i.description ?? ''},
        ${status}, ${i.priority ?? 'normal'}, ${i.assigneeId ?? null}, ${i.startDate ?? null}, ${i.dueDate ?? null},
        ${i.dueTime ?? null}, ${i.tags ?? []}, ${i.approvalRequired ?? true}, ${rule}, ${u.id}, extract(epoch from now()))
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
      ['tags', 'tags'], ['approvalRequired', 'approval_required'], ['orgUnitId', 'org_unit_id'],
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
    if ('approval_required' in set && !perms.approve) throw forbidden('검토 필요 여부는 관리자만 바꿀 수 있습니다');
    const start = (set.start_date ?? cur.start_date) as string | null;
    const due = (set.due_date ?? cur.due_date) as string | null;
    if (start && due && start > due) throw badRequest('시작일이 마감일보다 늦습니다');
    if (set.assignee_id) await validateRefs(tx, u, { assigneeId: set.assignee_id as string } as TaskInput, cur.org_unit_id);

    // 상태 변경
    let statusEvent: string | null = null;
    if (i.status && i.status !== cur.status) {
      const to = i.status as TaskStatus;
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
      await notify(tx, { userIds: [cur.assignee_id, ...(await collabIds(tx, id))], type: 'event_changed', title: `마감일 변경: ${title}`,
        body: `${cur.due_date ?? '없음'} → ${set.due_date ?? cur.due_date ?? '없음'}`, link: `/tasks/${id}`, entityType: 'task',
        entityId: id, actorId: u.id, dedupeKey: `due:${id}:${upd.version}` });
    }
    if (statusEvent === 'review_requested') {
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
    let spawned: string | null = null;
    if (set.status === 'done') spawned = await spawnNextRecurrence(tx, id, u.id);
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
