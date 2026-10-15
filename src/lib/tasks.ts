import { z } from 'zod';
import { db, type Sql } from './db';
import { accessibleUnitIds, assertUnitAccess, loadTaskForUser, taskVisibleSql, atLeast, teamTaskLevel, subTeamsSql } from './access';
import { HttpError, badRequest, conflict, forbidden, notFound } from './errors';
import { activity } from './log';
import { notify } from './notifications';
import { nextDate, normalizeRule } from './recurrence';
import { addDays, todaySeoul, weekRangeSeoul } from './time';
import { STATUS_LABEL, tenantOf, type SessionUser, type TaskStatus } from './types';
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
  /** V8 8번: 미리 알림(분 전, 최대 3개). null = 각자 기본(시간 있는 업무 60분 전, 날짜만은 당일 09시) */
  reminderMinutes: z.array(z.number().int().min(0).max(10080)).max(3).nullable().optional(),
  /** V6 13번: 담당자 여러 명 → 각자 1건씩 (만들 때만) */
  assigneeIds: z.array(zUuid).max(50).optional(),
  /** V14 8번: 팀에 배정 — each = 팀원 모두에게 각각, lead = 팀장이 담당자 지정 */
  teamId: zUuid.nullable().optional(),
  teamMode: z.enum(['each', 'lead', 'tag']).optional(), // tag(R-16): 소속 팀만 붙이고 담당자는 그대로
  version: z.number().int().optional(),
  reviewNote: z.string().max(2000).optional(),
});
export type TaskInput = z.infer<typeof taskInput>;

export const TASK_COLS = (sql: Sql, uid: string | null = null) => sql`
  t.id, t.title, t.description, t.status, t.priority, t.project_id, t.parent_id, t.org_unit_id, t.brand_id,
  t.assignee_id, t.start_date, t.due_date, to_char(t.due_time, 'HH24:MI') as due_time, t.tags, t.approval_required,
  t.review_requested_at, t.approved_at, t.approved_by, t.completed_at, t.recurrence_rule, t.recurrence_stopped,
  t.version, t.created_by, t.created_at, t.updated_at, t.sort_order, t.section_id, t.assignee_ack_at, t.task_type, t.photo_required, t.approval_line_id, t.review_of,
  t.estimate_minutes, t.show_on_calendar, t.requested_by, rq.name as requested_by_name, t.batch_id, t.reminder_minutes,
  t.team_id, (select tm.name from teams tm where tm.id = t.team_id) as team_name, (select tm.color from teams tm where tm.id = t.team_id) as team_color,
  case when t.batch_id is null then null else (select json_build_object('total', count(*)::int, 'done', count(*) filter (where b.status = 'done')::int) from tasks b where b.batch_id = t.batch_id and b.deleted_at is null) end as batch,
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
  (select count(*)::int from task_checklist_items ci where ci.task_id = t.id and ci.assignee_id = ${uid} and not ci.done) as my_items,
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
  view: z.enum(['all', 'my', 'today', 'overdue', 'week', 'review', 'risk', 'requested', 'done']).catch('all'),
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
  teamId: zUuid.optional(),
  includeSubtasks: z.enum(['0', '1']).optional().catch(undefined),
  includeDone: z.enum(['0', '1', 'recent']).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(1000).catch(500),
  /** V20 완료 보관: 이 달(YYYY-MM, 서울 기준)에 완료한 업무만 */
  doneMonth: z.string().regex(/^\d{4}-\d{2}$/).optional().catch(undefined),
  /** V20 이월만 보기: 지난달 이전부터 이어진 진행 중 업무(마감일, 없으면 만든 날 기준) */
  carried: z.enum(['1']).optional().catch(undefined),
});

/** V20 완료 보관: 달별 완료 개수 (서울 기준 완료일, 볼 수 있는 업무만, 담당자 필터 선택) */
/** V14 42번: 보기 칩 건수(목록과 같은 조건·필터, 담당자 필터는 제외) — 0건은 화면에서 숨김 */
export const COUNT_VIEWS = ['my', 'requested', 'overdue', 'week', 'review'] as const;
export async function viewCounts(u: SessionUser, raw: Record<string, string>) {
  const sql = db();
  const units = await accessibleUnitIds(u, sql);
  const today = todaySeoul();
  const base = { ...raw }; delete base.view; delete base.assigneeId; delete base.limit; delete base.doneMonth; delete base.carried;
  const parts = COUNT_VIEWS.map((v) => sql`(select count(*)::int from tasks t where ${taskWhere(sql, u, listQuery.parse({ ...base, view: v }), units, today)}) as ${sql(v)}`);
  const [r] = await sql<Record<string, number>[]>`select ${parts.reduce((a, c) => sql`${a}, ${c}`)}`;
  return { counts: r };
}

export async function doneMonths(u: SessionUser, raw: Record<string, string>) {
  const q = z.object({ assigneeId: zUuid.optional().catch(undefined), projectId: zUuid.optional().catch(undefined), teamId: zUuid.optional().catch(undefined) }).parse(raw);
  const sql = db();
  const units = await accessibleUnitIds(u, sql);
  const rows = await sql<{ month: string; n: number }[]>`select to_char(t.completed_at at time zone 'Asia/Seoul', 'YYYY-MM') as month, count(*)::int n
    from tasks t where t.deleted_at is null and t.status = 'done' and t.parent_id is null and t.completed_at is not null and ${taskVisibleSql(sql, u, units)}
      ${q.assigneeId ? sql`and t.assignee_id = ${q.assigneeId}` : sql``} ${q.projectId ? sql`and t.project_id = ${q.projectId}` : sql``} ${q.teamId ? sql`and t.team_id = ${q.teamId}` : sql``}
    group by 1 order by 1 desc limit 60`;
  return { months: rows };
}

/** 목록 조건(보기·필터·권한) — 목록과 V14 42번 칩 건수가 같은 규칙을 쓴다 */
function taskWhere(sql: Sql, u: SessionUser, q: z.infer<typeof listQuery>, units: string[] | null, today: string) {
  const conds = [sql`t.deleted_at is null`, taskVisibleSql(sql, u, units)];
  if (q.parentId) conds.push(sql`t.parent_id = ${q.parentId}`);
  else if (q.includeSubtasks !== '1') conds.push(sql`t.parent_id is null`);
  if (q.projectId) conds.push(sql`t.project_id = ${q.projectId}`);
  if (q.orgUnitId) {
    conds.push(sql`t.org_unit_id in (with recursive s as (select id from org_units where id = ${q.orgUnitId}
      union select c.id from org_units c join s on c.parent_id = s.id) select id from s)`);
  }
  if (q.brandId) conds.push(sql`t.brand_id = ${q.brandId}`);
  if (q.teamId) conds.push(sql`t.team_id = ${q.teamId}`); // V14 8번
  if (q.assigneeId) conds.push(sql`t.assignee_id = ${q.assigneeId}`);
  if (q.requestedById) conds.push(sql`t.requested_by = ${q.requestedById}`);
  if (q.status) {
    const st = q.status.split(',').filter((s) => s in STATUS_LABEL);
    if (st.length) conds.push(sql`t.status = any(${st})`);
  } else if (q.includeDone === '0') conds.push(sql`t.status <> 'done'`);
  // V6 16번: 완료해도 오늘(서울 자정까지)은 목록에 남기고, 댓글이 달린 완료 업무는 7일 동안
  else if (q.includeDone === 'recent') conds.push(sql`(t.status <> 'done' or t.completed_at >= ${today}::date::timestamp at time zone 'Asia/Seoul'
    or (t.completed_at > now() - interval '7 days' and exists (select 1 from comments c where c.task_id = t.id and c.deleted_at is null)))`);
  if (q.q) {
    const like = '%' + q.q.replace(/[%_\\]/g, (m) => '\\' + m) + '%';
    conds.push(sql`(t.title ilike ${like} or t.description ilike ${like} or exists (select 1 from unnest(t.tags) tg where tg ilike ${like}))`);
  }
  if (q.doneMonth) conds.push(sql`t.completed_at >= (${q.doneMonth + '-01'}::date::timestamp at time zone 'Asia/Seoul') and t.completed_at < ((${q.doneMonth + '-01'}::date + interval '1 month')::timestamp at time zone 'Asia/Seoul')`);
  if (q.carried) conds.push(sql`t.status <> 'done' and coalesce(t.due_date, (t.created_at at time zone 'Asia/Seoul')::date) < date_trunc('month', (now() at time zone 'Asia/Seoul'))::date`);
  if (q.from) conds.push(sql`coalesce(t.due_date, t.start_date) >= ${q.from}`);
  if (q.to) conds.push(sql`coalesce(t.start_date, t.due_date) <= ${q.to}`);
  switch (q.view) {
    case 'my':
      conds.push(sql`(t.assignee_id = ${u.id} or exists (select 1 from task_collaborators tc where tc.task_id = t.id and tc.user_id = ${u.id})
        or exists (select 1 from task_checklist_items mi where mi.task_id = t.id and mi.assignee_id = ${u.id} and not mi.done))`); // R-15 6번: 내 몫 체크리스트가 남은 업무도
      conds.push(sql`t.status <> 'done'`);
      break;
    case 'done': // V6 5번 완료 보관: 완료일 기준 (화면에서 월별로 묶음)
      conds.push(sql`t.status = 'done'`);
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
  return conds.reduce((a, c) => sql`${a} and ${c}`);
}

export async function listTasks(u: SessionUser, q: z.infer<typeof listQuery>) {
  const sql = db();
  const units = await accessibleUnitIds(u, sql);
  const where = taskWhere(sql, u, q, units, todaySeoul());
  const rows = await sql<any[]>`select ${TASK_COLS(sql, u.id)} ${TASK_FROM(sql)} where ${where}
    order by ${q.view === 'done' ? sql`t.completed_at desc nulls last,` : sql``} t.due_date asc nulls last, t.priority = 'urgent' desc, t.priority = 'high' desc, t.sort_order, t.created_at
    limit ${q.limit}`;
  if (q.view !== 'risk') return rows;
  const { deadlineRisk } = await import('./availability');
  const risks = await Promise.all(rows.map((r) => deadlineRisk(r))); // 행마다 순서대로 기다리지 않게
  return rows.flatMap((r, i) => (risks[i]?.risk ? [{ ...r, risk: risks[i] }] : []));
}

export async function getTaskDetail(u: SessionUser, id: string) {
  const sql = db();
  const { perms } = await loadTaskForUser(u, id, sql);
  // 속도: 서로 기다릴 필요 없는 쿼리는 한 번에 (DB 왕복 횟수 줄이기)
  const [[t], units] = await Promise.all([sql`select ${TASK_COLS(sql)}, cu.name as created_by_name, apu.name as approved_by_name,
      parent.title as parent_title
    ${TASK_FROM(sql)}
    left join users cu on cu.id = t.created_by
    left join users apu on apu.id = t.approved_by
    left join tasks parent on parent.id = t.parent_id
    where t.id = ${id}`, accessibleUnitIds(u, sql)]);
  const { openRound, stepApprovers } = await import('./approvals');
  const { deadlineRisk } = await import('./availability');
  const [collaborators, checklist, subtasks, deps, comments, attachments, history, blocks, approvals, fields, risk, batchMates] = await Promise.all([
    sql`select u.id, u.name from task_collaborators c join users u on u.id = c.user_id where c.task_id = ${id} order by u.name`,
    sql`select ci.id, ci.text, ci.done, ci.sort, ci.done_at, ci.assignee_id, au.name as assignee_name from task_checklist_items ci left join users au on au.id = ci.assignee_id where ci.task_id = ${id} order by ci.sort, ci.id`,
    sql`select ${TASK_COLS(sql)} ${TASK_FROM(sql)} where t.parent_id = ${id} and t.deleted_at is null
        and ${taskVisibleSql(sql, u, units)} order by t.sort_order, t.created_at`,
    sql`select dt.id, dt.title, dt.status, dt.due_date from task_dependencies d join tasks dt on dt.id = d.depends_on_id
        where d.task_id = ${id} and dt.deleted_at is null`,
    // V13 8번: 답글(parent_id)·반응. 지운 댓글은 답글이 있을 때만 "삭제된 댓글"로 남긴다
    sql`select c.id, case when c.deleted_at is null then c.body else '' end as body, c.mentions, c.created_at, c.edited_at, c.author_id, u.name as author_name,
          c.parent_id, (c.deleted_at is not null) as deleted,
          coalesce((select json_agg(json_build_object('emoji', g.emoji, 'n', g.n, 'mine', g.mine, 'names', g.names) order by g.first)
            from (select r.emoji, count(*)::int n, bool_or(r.user_id = ${u.id}) mine, array_agg(ru.name order by r.created_at) names, min(r.created_at) first
              from comment_reactions r join users ru on ru.id = r.user_id where r.comment_id = c.id group by r.emoji) g), '[]') as reactions
        from comments c join users u on u.id = c.author_id where c.task_id = ${id}
          and (c.deleted_at is null or exists (select 1 from comments r where r.parent_id = c.id and r.deleted_at is null)) order by c.created_at`,
    sql`select a.*, u.name as created_by_name from attachments a join users u on u.id = a.created_by
        where a.task_id = ${id} and a.deleted_at is null and a.upload_status = 'ready' order by a.created_at`,
    sql`select a.id, a.action, a.changes, a.created_at, u.name as actor_name from activities a left join users u on u.id = a.actor_id
        where a.entity_type = 'task' and a.entity_id = ${id} order by a.created_at desc limit 100`,
    sql`select id, start_at, end_at, title from events where task_id = ${id} and deleted_at is null order by start_at`,
    openRound(sql, id),
    t.project_id ? sql`select id, name, type, options, aggregate from project_fields where project_id = ${t.project_id} order by sort, created_at` : Promise.resolve([]),
    deadlineRisk(t as never).catch(() => null),
    // V6 13번: 같이 받은 사람(담당자별 1건씩 만든 묶음)
    t.batch_id ? sql`select b.id, b.status, b.assignee_id, a.name as assignee_name from tasks b left join users a on a.id = b.assignee_id
      where b.batch_id = ${t.batch_id} and b.deleted_at is null order by a.name` : Promise.resolve([]),
  ]);
  const pending = t.status === 'review' ? approvals.find((a) => a.status === 'pending' && a.round === approvals[0]?.round) : null;
  const canDecide = pending ? (await stepApprovers(sql, t.org_unit_id, pending)).includes(u.id) : false;
  const { menuLevel } = await import('./menuPerms');
  const reassign = await canReassign(u, t, sql);
  const handoff = !reassign && t.assignee_id === u.id && (await menuLevel(u, 'reassign_handoff', sql)) === 'use';
  const [pendingHandoff] = await sql`select h.id, h.from_user, h.to_user, h.note, h.created_at, fu.name as from_name, tu.name as to_name
    from task_handoffs h join users fu on fu.id = h.from_user join users tu on tu.id = h.to_user where h.task_id = ${id} and h.status = 'pending' order by h.created_at desc limit 1`;
  const canDecideHandoff = !!pendingHandoff && ((t.requested_by ?? t.created_by) === u.id || reassign);
  // R-15 4번: 담당자의 최근 처리 속도 → 예상 처리 기간
  const speed = t.assignee_id && t.status !== 'done' ? (await (await import('./insights')).speedStats(u, [t.assignee_id]).catch(() => []))[0] ?? null : null;
  // V14 28번: 검토 업무면 원 업무(제목·상태·담당), 원 업무면 자기 검토 업무
  const [reviewTarget] = t.review_of ? await sql`select r.id, r.title, r.status, r.requested_by, r.created_by, au.name as assignee_name from tasks r left join users au on au.id = r.assignee_id where r.id = ${t.review_of} and r.deleted_at is null` : [];
  return { reviewTarget: reviewTarget ?? null, speed, task: t, perms: { ...perms, decide: canDecide, reassign: reassign || !t.assignee_id, handoff }, handoff: pendingHandoff ? { ...pendingHandoff, canDecide: canDecideHandoff } : null, collaborators, checklist, subtasks, dependencies: deps, comments, attachments, history, timeBlocks: blocks, approvals, fields, risk, batchMates };
}

async function validateRefs(sql: Sql, u: SessionUser, i: TaskInput, orgUnitId: string) {
  await assertUnitAccess(u, orgUnitId, sql);
  if (i.projectId) {
    const p = await sql`select org_unit_id from projects where id = ${i.projectId}`;
    if (!p[0]) throw badRequest('프로젝트가 없습니다');
    const [pt] = await sql`select 1 from org_units where id = ${p[0].org_unit_id} and tenant = ${tenantOf(u)}`; // 다른 회사·체험 조직 프로젝트 금지
    if (!pt) throw badRequest('프로젝트가 없습니다');
  }
  const ids = [i.assigneeId, i.requestedById, ...(i.collaboratorIds ?? [])].filter(Boolean) as string[];
  if (ids.length) {
    const ok = await sql`select id from users where id = any(${ids}::uuid[]) and status = 'active' and tenant = ${tenantOf(u)}`;
    if (ok.length !== new Set(ids).size) throw badRequest('비활성 사용자이거나 없는 사용자입니다');
  }
  if (i.dependsOn?.length) { // 같은 회사 업무만 선행으로
    const ok = await sql`select t.id from tasks t join org_units o on o.id = t.org_unit_id where t.id = any(${i.dependsOn}::uuid[]) and o.tenant = ${tenantOf(u)}`;
    if (ok.length !== new Set(i.dependsOn).size) throw badRequest('선행 업무를 찾을 수 없습니다');
  }
  if (i.startDate && i.dueDate && i.startDate > i.dueDate) throw badRequest('시작일이 마감일보다 늦습니다');
}

export async function createTask(u: SessionUser, i: TaskInput) {
  const sql = db();
  await (await import('./plans')).assertTaskQuota(u, 1, sql); // V29 3장 업무 총량(요금제에 있을 때만)
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
  if (i.teamId) await assertTeamAssign(u, i.teamId, sql);

  return sql.begin(async (tx) => {
    const [t] = await tx<{ id: string }[]>`
      insert into tasks (project_id, parent_id, org_unit_id, brand_id, title, description, status, priority, assignee_id,
        start_date, due_date, due_time, tags, approval_required, recurrence_rule, created_by, sort_order, section_id, assignee_ack_at,
        task_type, photo_required, approval_line_id, estimate_minutes, requested_by, batch_id, reminder_minutes, team_id)
      values (${i.projectId ?? null}, ${i.parentId ?? null}, ${orgUnitId}, ${brandId ?? null}, ${i.title}, ${i.description ?? ''},
        ${status}, ${i.priority ?? 'normal'}, ${i.assigneeId ?? null}, ${i.startDate ?? null}, ${i.dueDate ?? null},
        ${i.dueTime ?? null}, ${i.tags ?? []}, ${i.approvalRequired ?? true}, ${rule}, ${u.id}, extract(epoch from now()),
        ${sectionId}, ${i.assigneeId && i.assigneeId === u.id ? new Date() : null},
        ${i.taskType ?? 'normal'}, ${i.photoRequired ?? (i.taskType === 'inspection' ? 1 : 0)}, ${i.approvalLineId ?? null}, ${i.estimateMinutes ?? null}, ${i.requestedById ?? u.id}, ${(i as { batchId?: string }).batchId ?? null}, ${i.reminderMinutes ?? null}, ${i.teamId ?? null})
      returning id`;
    if (i.teamId && i.teamMode === 'lead' && !i.assigneeId) { // 팀에 배정 → 팀장이 담당자를 정한다
      const leads = await tx<{ user_id: string }[]>`select user_id from team_members where team_id = ${i.teamId} and is_lead`;
      await notify(tx, { userIds: leads.map((l) => l.user_id), type: 'task_assigned', title: `팀 업무 배정: ${i.title}`, body: `${u.name}님이 팀에 배정했습니다 — 담당자를 정해 주세요`,
        link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id, actorId: u.id, dedupeKey: `team_assign:${t.id}` });
    }
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
  const admins = await sql<{ id: string }[]>`select id from users where role in ('owner','admin') and status = 'active' and tenant = (select tenant from org_units where id = ${orgUnitId})`;
  return admins.map((r) => r.id);
}

/** V6 13번: 같은 업무를 담당자마다 1건씩 (같은 batch_id). 각 담당자에게 배정 알림은 createTask 가 보냄 */
export async function createTasksForAssignees(u: SessionUser, i: TaskInput) {
  if (i.teamId && i.teamMode === 'each') { // V14 8번: 팀원 모두에게 각각
    await assertTeamAssign(u, i.teamId);
    i = { ...i, assigneeIds: (await db()<{ user_id: string }[]>`select m.user_id from team_members m join users us on us.id = m.user_id where m.team_id = ${i.teamId} and us.status = 'active' order by m.is_lead desc, us.name`).map((r) => r.user_id) };
    if (!i.assigneeIds!.length) throw badRequest('팀원이 없습니다');
  }
  const ids = [...new Set(i.assigneeIds ?? [])];
  if (ids.length < 2) return createTask(u, { ...i, assigneeId: ids[0] ?? i.assigneeId });
  await (await import('./plans')).assertTaskQuota(u, ids.length); // 여러 명에게 각각: 다 만들 수 있을 때만
  const batchId = crypto.randomUUID();
  const out: string[] = [];
  for (const a of ids) out.push((await createTask(u, { ...i, assigneeId: a, batchId } as TaskInput)).id);
  return { id: out[0], ids: out, batchId };
}

/** 묶음 전체에 적용 (지시자·만든 사람·관리자만): 제목·마감·우선순위·설명 */
export async function updateBatch(u: SessionUser, batchId: string, i: Pick<Partial<TaskInput>, 'title' | 'dueDate' | 'dueTime' | 'priority' | 'description'>) {
  const sql = db();
  const rows = await sql<{ id: string; requested_by: string | null; created_by: string }[]>`select id, requested_by, created_by from tasks where batch_id = ${batchId} and deleted_at is null`;
  if (!rows.length) throw notFound('묶음이 없습니다');
  await loadTaskForUser(u, rows[0].id, sql);
  if (!(rows[0].requested_by === u.id || rows[0].created_by === u.id || atLeast(u, 'admin'))) throw forbidden('묶음 전체 수정은 지시자만 할 수 있습니다');
  for (const r of rows) await updateTask(u, r.id, i);
  return { updated: rows.length };
}
export async function deleteBatch(u: SessionUser, batchId: string) {
  const sql = db();
  const rows = await sql<{ id: string; requested_by: string | null; created_by: string }[]>`select id, requested_by, created_by from tasks where batch_id = ${batchId} and deleted_at is null`;
  if (!rows.length) throw notFound('묶음이 없습니다');
  await loadTaskForUser(u, rows[0].id, sql);
  if (!(rows[0].requested_by === u.id || rows[0].created_by === u.id || atLeast(u, 'admin'))) throw forbidden('묶음 전체 삭제는 지시자만 할 수 있습니다');
  await sql.begin(async (tx) => {
    await tx`update tasks set deleted_at = now(), updated_at = now(), version = version + 1 where batch_id = ${batchId} and deleted_at is null`;
    await hideTaskBlocks(tx, rows.map((r) => r.id));
    for (const r of rows) await activity(tx, 'task', r.id, u.id, 'deleted', { batch: batchId });
  });
  return { deleted: rows.length };
}

export async function updateTask(u: SessionUser, id: string, i: Partial<TaskInput>) {
  const sql = db();
  return sql.begin(async (tx) => {
    const { perms } = await loadTaskForUser(u, id, tx);
    const [cur] = await tx`select * , to_char(due_time,'HH24:MI') as due_time_s from tasks where id = ${id} for update`;
    if (i.version !== undefined && i.version !== cur.version) {
      throw conflict('다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요.', { currentVersion: cur.version });
    }
    // V14 8번 팀장 배정(팀 업무 "팀장이 담당 지정"): 담당이 비어 있는 팀 업무는 팀장이 처음 담당을 정할 수 있다(그 뒤 변경은 지시자만)
    const onlyAssign = Object.entries(i).every(([k, v]) => v === undefined || k === 'assigneeId' || k === 'version');
    const leadFirstAssign = !perms.edit && onlyAssign && !!i.assigneeId && !cur.assignee_id && !!cur.team_id
      && (await tx`select 1 from team_members where team_id = ${cur.team_id} and user_id = ${u.id} and is_lead`).length > 0;
    if (!perms.edit && !leadFirstAssign) {
      const onlyStatus = Object.entries(i).every(([k, v]) => v === undefined || ['status', 'version', 'reviewNote'].includes(k));
      throw forbidden(onlyStatus ? '상태는 담당자만 바꿀 수 있어요' : '이 업무를 수정할 권한이 없습니다 — 업무 내용·일정은 지시자·담당자만 바꿀 수 있습니다');
    }
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const set: Record<string, unknown> = {};
    const fields: [keyof TaskInput, string][] = [
      ['title', 'title'], ['description', 'description'], ['projectId', 'project_id'], ['brandId', 'brand_id'],
      ['assigneeId', 'assignee_id'], ['priority', 'priority'], ['startDate', 'start_date'], ['dueDate', 'due_date'],
      ['tags', 'tags'], ['approvalRequired', 'approval_required'], ['orgUnitId', 'org_unit_id'], ['sectionId', 'section_id'], ['sortOrder', 'sort_order'], ['taskType', 'task_type'], ['photoRequired', 'photo_required'], ['approvalLineId', 'approval_line_id'], ['estimateMinutes', 'estimate_minutes'], ['showOnCalendar', 'show_on_calendar'], ['requestedById', 'requested_by'], ['reminderMinutes', 'reminder_minutes'], ['teamId', 'team_id'],
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
    // V14 1번: 이미 담당자가 있는 업무의 담당자를 바꾸는 것(재배정)은 메뉴 권한으로
    const reassigned = 'assignee_id' in set && !!cur.assignee_id && set.assignee_id !== cur.assignee_id;
    if ('assignee_id' in set && !cur.assignee_id && !leadFirstAssign && !perms.edit) throw forbidden();
    if (reassigned && !(await canReassign(u, cur, tx))) {
      const { menuLevel } = await import('./menuPerms');
      if (cur.assignee_id === u.id && (await menuLevel(u, 'reassign_handoff', tx)) === 'use')
        throw new HttpError(403, 'handoff_required', '다른 사람에게 넘기려면 지시자 승인이 필요합니다 — "넘기기 요청"을 보내 주세요');
      throw forbidden('담당자를 바꿀 권한이 없습니다 — 대표가 메뉴 권한에서 열 수 있습니다');
    }
    if ('approval_required' in set && !perms.approve) throw forbidden('검토 필요 여부는 관리자만 바꿀 수 있습니다');
    const start = (set.start_date ?? cur.start_date) as string | null;
    const due = (set.due_date ?? cur.due_date) as string | null;
    if (start && due && start > due) throw badRequest('시작일이 마감일보다 늦습니다');
    if (set.assignee_id) await validateRefs(tx, u, { assigneeId: set.assignee_id as string } as TaskInput, cur.org_unit_id);
    if (set.team_id) await assertTeamAssign(u, set.team_id as string, tx);
    if (set.requested_by) await validateRefs(tx, u, { requestedById: set.requested_by as string } as TaskInput, cur.org_unit_id);
    if (set.project_id || i.collaboratorIds?.length || i.dependsOn?.length) await validateRefs(tx, u, { projectId: (set.project_id as string) ?? undefined, collaboratorIds: i.collaboratorIds, dependsOn: i.dependsOn } as TaskInput, (set.org_unit_id as string) ?? cur.org_unit_id);
    if (('photo_required' in set || 'approval_line_id' in set) && !perms.approve) throw forbidden('사진 증빙·결재선은 관리자가 정합니다');
    if (set.approval_line_id) await checkLine(tx, set.approval_line_id as string);
    if (cur.status === 'review' && 'approval_line_id' in set) throw conflict('결재 진행 중에는 결재선을 바꿀 수 없습니다');
    if ((set.task_type ?? cur.task_type) === 'milestone' && (set.start_date ?? cur.start_date)) set.start_date = null;
    const lineId = ('approval_line_id' in set ? set.approval_line_id : cur.approval_line_id) as string | null;

    // V12 11번: 상태는 담당자만(대표·관리자도 예외 없음). 예외는 하나 — 검토 요청된 업무를 그 업무의 지시자가 승인(완료)·반려(진행 중).
    // 담당자가 없는 업무는 만든 사람만. (결재선 업무의 결재는 approvals 의 결재 API 로 따로)
    if (i.status && i.status !== cur.status) {
      // V14 50(대표 결정): 상태는 배정된 담당자만(대표·관리자·지시자·협업자 모두 불가). 담당자가 없는 업무는 지시자(없으면 만든 사람).
      // 검토 중인 업무의 승인(완료)·반려(진행 중)는 검토 담당자만 — "[검토]" 업무가 있으면 그 담당자, 없으면 지시자. 담당자 본인은 자기 검토를 승인할 수 없다.
      const owner = cur.assignee_id ?? cur.requested_by ?? cur.created_by;
      if (cur.status === 'review' && !lineId) {
        const [rv] = await tx<{ assignee_id: string | null }[]>`select assignee_id from tasks where review_of = ${id} and deleted_at is null and status <> 'done' limit 1`;
        const reviewer = rv?.assignee_id ?? (cur.requested_by && cur.requested_by !== cur.assignee_id ? cur.requested_by : null);
        if (reviewer && reviewer !== u.id) {
          const [nm] = await tx<{ name: string }[]>`select name from users where id = ${reviewer}`;
          throw forbidden(`검토 중인 업무의 승인·반려는 검토 담당자 ${nm?.name ?? ''}님만 할 수 있습니다`);
        }
        if (reviewer && reviewer === u.id && i.status !== 'done' && i.status !== 'in_progress') throw forbidden('검토 담당자는 승인(완료)·반려(진행 중)만 할 수 있어요');
        if (!reviewer && owner !== u.id) throw forbidden('상태는 담당자만 바꿀 수 있어요');
      } else if (owner !== u.id) {
        const [nm] = cur.assignee_id ? await tx<{ name: string }[]>`select name from users where id = ${cur.assignee_id}` : [];
        throw forbidden(cur.assignee_id ? `상태는 담당자만 바꿀 수 있어요(담당 ${nm?.name ?? ''})` : '담당자가 없는 업무의 상태는 지시자(만든 사람)만 바꿀 수 있어요');
      }
    }
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
        if (cur.approval_required && !perms.approve && cur.status !== 'review') { // 검토 승인은 위에서 검토 담당자 확인
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
        if (cur.status === 'review' && cur.review_requested_by !== u.id) statusEvent = 'review_rejected';
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
    if (reassigned && changes.assigneeId) { // 이력: "재배정: 김민수 → 김소담 (바꾼 사람)"
      await activity(tx, 'task', id, u.id, 'reassigned', { assigneeId: changes.assigneeId });
      delete changes.assigneeId;
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
    if (reassigned) await notifyReassign(tx, u, { id, title, from: cur.assignee_id as string, to: (set.assignee_id as string | null) ?? null, requestedBy: cur.requested_by as string | null, version: upd.version });
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
      // V12 7번: 지시자(없으면 만든 사람)에게도 즉시 — 알림에서 바로 승인·반려
      const reqr = (set.requested_by ?? cur.requested_by ?? cur.created_by) as string | null;
      // 검수 12: 지시자(없으면 만든 사람)에게만. 지시자가 없고 만든 사람이 본인이면 승인권자에게
      const reviewTo = reqr && reqr !== u.id ? [reqr] : await approverIds(tx, cur.org_unit_id, cur.project_id);
      await notify(tx, { userIds: reviewTo, type: 'review_requested',
        title: `검토 요청: ${title}`, body: `${u.name}님이 검토를 요청했습니다 — 승인 또는 반려해 주세요`, link: `/tasks/${id}`,
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
    // 2026-10-15 대표: 알림은 중요한 것만 — 지시자에게는 완료·보류만(검토 요청은 위에서 따로). 시작·다시 진행·되돌림은 보내지 않음
    if (requester && requester !== u.id && set.status && set.status !== cur.status && statusEvent !== 'review_requested' && (set.status === 'done' || set.status === 'on_hold')) {
      const verb = set.status === 'done' ? '완료했습니다' : '보류했습니다';
      const head = set.status === 'done' ? '완료' : '보류';
      await notify(tx, { userIds: [requester], type: 'task_done_for_requester',
        title: `${head}: ${title}`, body: `${u.name}님이 '${title}'을(를) ${verb}`,
        link: `/tasks/${id}`, entityType: 'task', entityId: id, actorId: u.id, dedupeKey: `reqst:${id}:${upd.version}` });
    }
    if (set.status || 'requested_by' in set || (cur.status === 'review' && ('title' in set || 'due_date' in set || 'assignee_id' in set))) await syncReviewTask(tx, id, u.id);
    let spawned: string | null = null;
    if (set.status === 'done') spawned = await spawnNextRecurrence(tx, id, u.id);
    // B-10 자동화 (사람이 한 변경에만 반응, 규칙이 한 변경은 다시 부르지 않음)
    const { runAutomations } = await import('./automation');
    if (set.status) await runAutomations(tx, { trigger: set.status === 'done' ? 'task_completed' : 'status_changed', taskId: id, actorId: u.id, fromStatus: cur.status });
    if ('section_id' in set && set.section_id) await runAutomations(tx, { trigger: 'section_moved', taskId: id, actorId: u.id });
    return { id, version: upd.version, changed: true, spawned };
  });
}

/**
 * V14 28번: 검토 요청 → 지시자(없으면 만든 사람)에게 "[검토] 원 업무" 업무. 원 업무당 하나 — 다시 요청하면 다시 연다.
 * 원 업무가 검토에서 벗어나면(승인·반려·되돌림) 자동 완료, 삭제되면 같이 삭제. 지시자 = 담당자, 결재선 업무, 검토 업무 자체는 만들지 않는다.
 */
export async function syncReviewTask(sql: Sql, id: string, actorId: string | null) {
  const [o] = await sql<any[]>`select t.id, t.title, t.status, t.assignee_id, t.requested_by, t.created_by, t.org_unit_id, t.brand_id, t.due_date, t.deleted_at,
      t.approval_line_id, t.review_of, o.tenant from tasks t join org_units o on o.id = t.org_unit_id where t.id = ${id}`;
  if (!o || o.review_of) return;
  const reviewer: string | null = o.requested_by ?? o.created_by;
  const [rv] = await sql<{ id: string; status: string; deleted_at: Date | null; assignee_id: string | null }[]>`select id, status, deleted_at, assignee_id from tasks where review_of = ${id}`;
  const active = o.status === 'review' && !o.deleted_at && !o.approval_line_id && !!reviewer && reviewer !== o.assignee_id;
  if (active) {
    const today = todaySeoul();
    const hol = new Set((await sql<{ d: string }[]>`select to_char(date, 'YYYY-MM-DD') d from holidays where date between ${today} and ${addDays(today, 20)} and (tenant is null or tenant = ${o.tenant})`).map((h) => h.d));
    let biz = addDays(today, 1);
    for (let k = 0; k < 20; k++) { const w = new Date(biz + 'T00:00:00Z').getUTCDay(); if (w !== 0 && w !== 6 && !hol.has(biz)) break; biz = addDays(biz, 1); }
    const due = o.due_date && String(o.due_date) < biz ? String(o.due_date) : biz;
    const title = `[검토] ${o.title}`.slice(0, 200);
    const desc = `원 업무: ${o.title}\n위 "검토할 업무" 상자에서 [승인] 또는 [반려]를 눌러 주세요. 처리하면 이 검토 업무는 자동으로 완료됩니다.`;
    if (rv) {
      await sql`update tasks set status = 'todo', deleted_at = null, completed_at = null, title = ${title}, due_date = ${due}, assignee_id = ${reviewer},
        assignee_ack_at = ${reviewer === actorId ? new Date() : null}, updated_at = now(), version = version + 1 where id = ${rv.id}`;
      await activity(sql, 'task', rv.id, actorId, 'reopened', { reason: 'review_requested_again' });
    } else {
      await sql`insert into tasks (org_unit_id, brand_id, title, description, status, priority, assignee_id, due_date, created_by, requested_by, sort_order, approval_required, review_of, assignee_ack_at)
        values (${o.org_unit_id}, ${o.brand_id}, ${title}, ${desc}, 'todo', 'high', ${reviewer}, ${due}, ${actorId ?? reviewer}, ${o.assignee_id ?? actorId ?? reviewer},
          extract(epoch from now()), false, ${o.id}, ${reviewer === actorId ? new Date() : null})`;
    }
  } else if (rv && !rv.deleted_at && rv.status !== 'done') {
    if (o.deleted_at || !reviewer || reviewer === o.assignee_id) await sql`update tasks set deleted_at = now(), updated_at = now(), version = version + 1 where id = ${rv.id}`;
    else if (o.status !== 'review') await sql`update tasks set status = 'done', completed_at = now(), updated_at = now(), version = version + 1 where id = ${rv.id}`;
  }
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

/** 대표 지시(2026-10-15): 업무를 지우면 그 업무의 "업무 시간" 블록도 숨긴다(되살리면 함께 복원). "업무에도 추가"로 연결된 일반 일정은 일정이 주인이라 두고, 연결 업무가 없는 것으로 보인다 */
export async function hideTaskBlocks(tx: Sql, taskIds: string[]) {
  if (!taskIds.length) return;
  await tx`update events e set deleted_at = now(), hidden_by_task = coalesce(e.task_id, (select et.task_id from event_tasks et where et.event_id = e.id and et.role = 'block' and et.task_id = any(${taskIds}::uuid[]) limit 1)), updated_at = now(), version = version + 1
    where e.kind = 'task_block' and e.deleted_at is null
      and (e.task_id = any(${taskIds}::uuid[]) or exists (select 1 from event_tasks et where et.event_id = e.id and et.role = 'block' and et.task_id = any(${taskIds}::uuid[])))`;
}
export async function unhideTaskBlocks(tx: Sql, taskIds: string[]) {
  if (!taskIds.length) return;
  await tx`update events set deleted_at = null, hidden_by_task = null, updated_at = now(), version = version + 1 where hidden_by_task = any(${taskIds}::uuid[])`;
}

export async function deleteTask(u: SessionUser, id: string) {
  const sql = db();
  const { perms } = await loadTaskForUser(u, id, sql);
  if (!perms.delete) throw forbidden('삭제 권한이 없습니다 (작성자 또는 관리자)');
  await sql.begin(async (tx) => {
    const gone = await tx<{ id: string }[]>`update tasks set deleted_at = now(), updated_at = now(), version = version + 1 where id = ${id} or parent_id = ${id} returning id`;
    await hideTaskBlocks(tx, gone.map((g) => g.id));
    await activity(tx, 'task', id, u.id, 'deleted');
    await syncReviewTask(tx, id, u.id);
  });
  return { ok: true };
}

/** V6 11번 휴지통: 삭제 후 30일까지, 삭제 권한이 있었던 사람(만든 사람·지시자·관리자)에게 보임 */
export async function listTrash(u: SessionUser) {
  const sql = db();
  const units = await accessibleUnitIds(u, sql);
  return sql`select t.id, t.title, t.deleted_at, t.due_date, t.assignee_id, a.name as assignee_name, t.parent_id
    from tasks t left join users a on a.id = t.assignee_id
    where t.deleted_at > now() - interval '30 days' and t.parent_id is null and t.purged_at is null
      and (t.created_by = ${u.id} or t.requested_by = ${u.id} or ${atLeast(u, 'admin')})
      and ${units === null ? sql`true` : sql`t.org_unit_id = any(${units}::uuid[])`}
    order by t.deleted_at desc limit 200`;
}
/** 되살리기: 같은 때 함께 지운 하위 업무도 */
export async function restoreTask(u: SessionUser, id: string) {
  const sql = db();
  const [t] = await sql<{ id: string; deleted_at: Date | null; created_by: string; requested_by: string | null; org_unit_id: string }[]>`
    select id, deleted_at, created_by, requested_by, org_unit_id from tasks where id = ${id} and purged_at is null`;
  if (!t || !t.deleted_at) throw notFound('휴지통에 없는 업무입니다');
  await assertUnitAccess(u, t.org_unit_id, sql);
  if (!(t.created_by === u.id || t.requested_by === u.id || atLeast(u, 'admin'))) throw forbidden('만든 사람·지시자·관리자만 되살릴 수 있습니다');
  if (Date.now() - t.deleted_at.getTime() > 30 * 86400000) throw badRequest('30일이 지나 되살릴 수 없습니다');
  await sql.begin(async (tx) => {
    const back = await tx<{ id: string }[]>`update tasks set deleted_at = null, updated_at = now(), version = version + 1 where id = ${id} or (parent_id = ${id} and deleted_at = ${t.deleted_at}) returning id`;
    await unhideTaskBlocks(tx, back.map((b) => b.id));
    await activity(tx, 'task', id, u.id, 'restored');
    await syncReviewTask(tx, id, u.id);
  });
  return { ok: true };
}

// ---- 댓글 ----
export async function addComment(u: SessionUser, taskId: string, text: string, replyTo: string | null = null) {
  const sql = db();
  const { task } = await loadTaskForUser(u, taskId, sql);
  const body = text.trim();
  if (!body) throw badRequest('내용을 입력하세요');
  // V13 8번: 답글은 1단계 — 답글에 답하면 같은 스레드(원 댓글)에 붙는다
  let parent: { id: string; author_id: string } | null = null;
  if (replyTo) {
    const [p] = await sql<{ id: string; parent_id: string | null; author_id: string }[]>`select id, parent_id, author_id from comments where id = ${replyTo} and task_id = ${taskId}`;
    if (!p) throw notFound('댓글이 없습니다');
    parent = p.parent_id ? (await sql<{ id: string; author_id: string }[]>`select id, author_id from comments where id = ${p.parent_id}`)[0] : p;
  }
  // 멘션: @[이름](uuid) 형식
  const mentionIds = [...body.matchAll(/@\[[^\]]{1,50}\]\(([0-9a-f-]{36})\)/g)].map((m) => m[1]);
  return sql.begin(async (tx) => {
    const validMentions = mentionIds.length
      ? (await tx<{ id: string }[]>`select id from users where id = any(${mentionIds}::uuid[]) and status = 'active'`).map((r) => r.id)
      : [];
    const [c] = await tx<{ id: string; created_at: Date }[]>`
      insert into comments (task_id, author_id, body, mentions, parent_id) values (${taskId}, ${u.id}, ${body}, ${validMentions}, ${parent?.id ?? null})
      returning id, created_at`;
    const [t] = await tx<{ title: string }[]>`select title from tasks where id = ${taskId}`;
    const preview = body.replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/g, '@$1').slice(0, 120);
    // 멘션된 사람이 그 업무를 볼 수 없으면 협업자로 추가하지 않고 알림도 보내지 않는다 (권한 우회 방지)
    const visibleMentions: string[] = [];
    for (const m of validMentions) {
      const [mu] = await tx`select id, email, name, role, status, timezone, tenant, is_demo as "isDemo" from users where id = ${m}`;
      const { taskPerms } = await import('./access');
      const p = await taskPerms({ ...(mu as any), sessionId: '' }, task, tx);
      if (p.view) visibleMentions.push(m);
    }
    if (visibleMentions.length) {
      await notify(tx, { userIds: visibleMentions, type: 'mention', title: `${u.name}님이 댓글에서 회원님을 언급했습니다`, body: `${t.title} — ${preview}`,
        link: `/tasks/${taskId}#c-${c.id}`, entityType: 'task', entityId: taskId, actorId: u.id, dedupeKey: `mention:${c.id}` });
    }
    // V13 8번 알림 대상 — 새 댓글: 담당·지시·만든 사람·협업자·이 업무에 댓글 단 사람 / 답글: 원 댓글 작성자 + 그 스레드 참여자. 멘션된 사람은 멘션 알림 1건만
    let followers: string[];
    if (parent) {
      followers = [parent.author_id, ...(await tx<{ author_id: string }[]>`select distinct author_id from comments where parent_id = ${parent.id} and deleted_at is null`).map((r) => r.author_id)];
    } else {
      const commenters = (await tx<{ author_id: string }[]>`select distinct author_id from comments where task_id = ${taskId} and deleted_at is null`).map((r) => r.author_id);
      followers = [task.assignee_id, task.requested_by, task.created_by, ...(await collabIds(tx, taskId)), ...commenters].filter((x): x is string => !!x);
    }
    followers = [...new Set(followers.filter((x): x is string => !!x && x !== u.id && !visibleMentions.includes(x)))];
    // 업무를 더는 볼 수 없게 된 사람(예: 예전에 댓글 단 사람)에게는 보내지 않는다
    const { taskPerms } = await import('./access');
    const canSee: string[] = [];
    for (const f of followers) {
      const [fu] = await tx`select id, email, name, role, status, timezone, tenant, is_demo as "isDemo" from users where id = ${f} and status = 'active'`;
      if (fu && (await taskPerms({ ...(fu as any), sessionId: '' }, task, tx)).view) canSee.push(f);
    }
    await notify(tx, { userIds: canSee, type: 'comment', title: parent ? `답글: ${t.title}` : `새 댓글: ${t.title}`, body: `${u.name}: ${preview}`,
      link: `/tasks/${taskId}#c-${c.id}`, entityType: 'task', entityId: taskId, actorId: u.id, dedupeKey: `comment:${c.id}` });
    return { id: c.id, createdAt: c.created_at, mentions: visibleMentions, parentId: parent?.id ?? null, notified: canSee };
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
    const p = await taskPerms({ id: cand.id, email: cand.email, name: cand.name, role: cand.role, status: 'active', timezone: 'Asia/Seoul', sessionId: '', tenant: tenantOf(u) }, task, sql);
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
  await markAcked(u, id);
  return { ok: true };
}
/** V12 6번 "확인 완료": 담당자가 업무를 열거나 [확인]을 누르면 한 번만 기록하고 지시자(없으면 만든 사람)에게 알림 */
export async function markAcked(u: SessionUser, id: string) {
  const sql = db();
  const [t] = await sql<{ title: string; requested_by: string | null; created_by: string }[]>`update tasks set assignee_ack_at = now()
    where id = ${id} and assignee_id = ${u.id} and assignee_ack_at is null and deleted_at is null returning title, requested_by, created_by`;
  if (!t) return false;
  // 2026-10-15 대표: "확인함"은 알림으로 보내지 않고 목록·상세의 "확인함" 표시로만
  return true;
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
    await hideTaskBlocks(tx, [id]);
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

// ---------------- V14 1번 담당자 재배정 권한 ----------------
/** 재배정 가능: 메뉴 권한 "업무 담당자 재배정" 또는 (내가 지시자 + "지시자는 자기 업무 재배정 가능") */
export async function canReassign(u: SessionUser, t: { requested_by?: string | null; created_by?: string | null; team_id?: string | null }, _sql: Sql = db()) {
  // V14 50(대표 결정): 담당자 변경은 지시자(없으면 만든 사람)만 — 대표·관리자·팀장도 예외 없음. 담당자는 "넘기기 요청"
  return (t.requested_by ?? t.created_by ?? null) === u.id;
}
async function notifyReassign(tx: Sql, u: SessionUser, p: { id: string; title: string; from: string; to: string | null; requestedBy: string | null; version: number }) {
  const names = await tx<{ id: string; name: string }[]>`select id, name from users where id = any(${[p.from, p.to].filter(Boolean) as string[]}::uuid[])`;
  const nm = (id: string | null) => (id ? names.find((x) => x.id === id)?.name ?? '' : '없음');
  const body = `${nm(p.from)} → ${nm(p.to)} (${u.name})`;
  await notify(tx, { userIds: [p.from, p.requestedBy], type: 'task_assigned', title: `담당자 변경: ${p.title}`, body, link: `/tasks/${p.id}`,
    entityType: 'task', entityId: p.id, actorId: u.id, dedupeKey: `reassign:${p.id}:${p.version}` });
}
export const handoffInput = z.object({ toUserId: zUuid, note: z.string().trim().max(500).optional() });
/** 담당자 본인 → 지시자에게 "넘기기 요청" */
export async function requestHandoff(u: SessionUser, taskId: string, i: z.infer<typeof handoffInput>) {
  const sql = db();
  const { task } = await loadTaskForUser(u, taskId, sql);
  const [cur] = await sql<{ title: string; assignee_id: string | null; requested_by: string | null; created_by: string; org_unit_id: string }[]>`
    select title, assignee_id, requested_by, created_by, org_unit_id from tasks where id = ${task.id}`;
  if (cur.assignee_id !== u.id) throw forbidden('담당자 본인만 넘기기를 요청할 수 있습니다');
  const { menuLevel } = await import('./menuPerms');
  if ((await menuLevel(u, 'reassign_handoff', sql)) !== 'use') throw forbidden('넘기기 기능이 꺼져 있습니다 — 대표가 메뉴 권한에서 켤 수 있습니다');
  if (i.toUserId === u.id) throw badRequest('다른 사람을 고르세요');
  await validateRefs(sql, u, { assigneeId: i.toUserId } as TaskInput, cur.org_unit_id);
  await sql`update task_handoffs set status = 'cancelled' where task_id = ${task.id} and status = 'pending'`;
  const [h] = await sql<{ id: string }[]>`insert into task_handoffs (task_id, from_user, to_user, note) values (${task.id}, ${u.id}, ${i.toUserId}, ${i.note ?? null}) returning id`;
  const [to] = await sql<{ name: string }[]>`select name from users where id = ${i.toUserId}`;
  await activity(sql, 'task', task.id, u.id, 'handoff_requested', { to: to?.name, note: i.note ?? null });
  await notify(sql, { userIds: [cur.requested_by ?? cur.created_by], type: 'review_requested', title: `담당 넘기기 요청: ${cur.title}`,
    body: `${u.name} → ${to?.name ?? ''}${i.note ? ` · ${i.note}` : ''}`, link: `/tasks/${task.id}`, entityType: 'task', entityId: task.id, actorId: u.id, dedupeKey: `handoff:${h.id}` });
  return { id: h.id };
}
/** 지시자(또는 재배정 권한자)가 넘기기 요청을 승인·거절 */
export async function decideHandoff(u: SessionUser, taskId: string, handoffId: string, approve: boolean) {
  const sql = db();
  const { task } = await loadTaskForUser(u, taskId, sql);
  const [h] = await sql<{ id: string; from_user: string; to_user: string; status: string }[]>`select id, from_user, to_user, status from task_handoffs where id = ${handoffId} and task_id = ${task.id}`;
  if (!h) throw notFound('요청이 없습니다');
  if (h.status !== 'pending') throw conflict('이미 처리된 요청입니다');
  const [cur] = await sql<{ title: string; assignee_id: string | null; requested_by: string | null; created_by: string; version: number }[]>`
    select title, assignee_id, requested_by, created_by, version from tasks where id = ${task.id}`;
  const decider = (cur.requested_by ?? cur.created_by) === u.id || (await canReassign(u, cur, sql));
  if (!decider) throw forbidden('지시자만 승인할 수 있습니다');
  return sql.begin(async (tx) => {
    await tx`update task_handoffs set status = ${approve ? 'approved' : 'rejected'}, decided_by = ${u.id}, decided_at = now() where id = ${h.id}`;
    if (!approve) {
      await activity(tx as unknown as Sql, 'task', task.id, u.id, 'handoff_rejected', {});
      await notify(tx as unknown as Sql, { userIds: [h.from_user], type: 'review_result', title: `넘기기 요청 거절: ${cur.title}`, body: `${u.name}님이 거절했습니다`,
        link: `/tasks/${task.id}`, entityType: 'task', entityId: task.id, actorId: u.id, dedupeKey: `handoff_done:${h.id}` });
      return { ok: true, approved: false };
    }
    if (cur.assignee_id !== h.from_user) throw conflict('그사이 담당자가 바뀌었습니다');
    const [upd] = await tx<{ version: number }[]>`update tasks set assignee_id = ${h.to_user}, assignee_ack_at = null, updated_at = now(), version = version + 1 where id = ${task.id} returning version`;
    await activity(tx as unknown as Sql, 'task', task.id, u.id, 'reassigned', { assigneeId: { from: h.from_user, to: h.to_user }, handoff: true });
    await notify(tx as unknown as Sql, { userIds: [h.to_user], type: 'task_assigned', title: `업무 배정: ${cur.title}`, body: `${u.name}님이 넘기기 요청을 승인했습니다`,
      link: `/tasks/${task.id}`, entityType: 'task', entityId: task.id, actorId: u.id, dedupeKey: `assign:${task.id}:${h.to_user}:${upd.version}` });
    await notifyReassign(tx as unknown as Sql, u, { id: task.id, title: cur.title, from: h.from_user, to: h.to_user, requestedBy: cur.requested_by, version: upd.version });
    return { ok: true, approved: true };
  });
}

/** V14 8번: 이 팀에 업무를 배정할 수 있나 — 팀원(팀 업무 조회 이상)·대표/본사 관리자·"다른 팀 업무" 편집 권한 */
async function assertTeamAssign(u: SessionUser, teamId: string, sql: Sql = db()) {
  const [t] = await sql<{ id: string }[]>`select id from teams where id = ${teamId} and tenant = ${tenantOf(u)} and not archived`;
  if (!t) throw badRequest('팀이 없습니다');
  const lv = await teamTaskLevel(u, teamId, sql);
  const member = (await sql`select 1 from team_members where team_id = ${teamId} and user_id = ${u.id}`).length > 0;
  if (!(lv === 'edit' || (member && lv !== 'none'))) throw forbidden('이 팀에 업무를 배정할 권한이 없습니다');
}
