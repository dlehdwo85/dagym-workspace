import { z } from 'zod';
import { db, type Sql } from './db';
import { accessibleUnitIds, assertUnitAccess, atLeast, isAdmin } from './access';
import { badRequest, forbidden, notFound } from './errors';
import { activity, logError } from './log';
import { notify } from './notifications';
import { addDays, todaySeoul } from './time';
import type { SessionUser } from './types';
import { zUuid } from './api';

/**
 * B-10 자동화 규칙(간단형). 트리거 → 조건 → 작업.
 * 규칙이 만든 변경은 다시 규칙을 부르지 않는다(무한 반복 방지). 같은 업무·같은 변경에는 규칙당 1회만(dedupe).
 */
export const TRIGGERS = ['task_created', 'status_changed', 'task_completed', 'section_moved', 'due_soon'] as const;
const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('notify'), to: z.enum(['assignee', 'creator', 'unit_managers', 'user']), userId: zUuid.optional(), message: z.string().max(200).optional() }),
  z.object({ type: z.literal('set_assignee'), userId: zUuid }),
  z.object({ type: z.literal('set_priority'), priority: z.enum(['low', 'normal', 'high', 'urgent']) }),
  z.object({ type: z.literal('create_follow_up'), title: z.string().trim().min(1).max(200), dueInDays: z.number().int().min(0).max(365).optional(), assignTo: z.enum(['same', 'creator']).optional() }),
]);
export const ruleInput = z.object({
  name: z.string().trim().min(1).max(80),
  orgUnitId: zUuid.nullable().optional(),
  projectId: zUuid.nullable().optional(),
  trigger: z.enum(TRIGGERS),
  conditions: z.object({
    toStatus: z.enum(['todo', 'in_progress', 'review', 'on_hold', 'done']).optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    brandId: z.string().optional(),
    taskType: z.enum(['normal', 'milestone', 'approval', 'inspection']).optional(),
    sectionId: zUuid.optional(),
    hoursBefore: z.number().int().min(1).max(168).optional(),
  }).default({}),
  actions: z.array(actionSchema).min(1).max(5),
  enabled: z.boolean().optional(),
});
type Rule = { id: string; name: string; org_unit_id: string | null; project_id: string | null; trigger: string; conditions: any; actions: z.infer<typeof actionSchema>[] };

async function assertRuleScope(u: SessionUser, i: { orgUnitId?: string | null; projectId?: string | null }, sql: Sql) {
  if (!atLeast(u, 'site_manager')) throw forbidden('자동화 규칙은 현장 관리자 이상이 만듭니다');
  if (i.projectId) {
    const [p] = await sql<{ org_unit_id: string }[]>`select org_unit_id from projects where id = ${i.projectId}`;
    if (!p) throw badRequest('프로젝트가 없습니다');
    await assertUnitAccess(u, p.org_unit_id, sql);
  } else if (i.orgUnitId) await assertUnitAccess(u, i.orgUnitId, sql);
  else if (!isAdmin(u)) throw forbidden('전사 규칙은 관리자만 만들 수 있습니다. 조직이나 프로젝트를 지정하세요.');
}

export async function listRules(u: SessionUser) {
  const sql = db();
  const units = await accessibleUnitIds(u, sql);
  const rules = await sql`select r.*, o.name as org_unit_name, p.name as project_name,
      (select count(*)::int from automation_runs x where x.rule_id = r.id) as run_count,
      (select max(created_at) from automation_runs x where x.rule_id = r.id) as last_run
    from automation_rules r left join org_units o on o.id = r.org_unit_id left join projects p on p.id = r.project_id
    where ${units === null ? sql`true` : sql`(r.org_unit_id = any(${units}::uuid[]) or p.org_unit_id = any(${units}::uuid[]) or (r.org_unit_id is null and r.project_id is null))`}
    order by r.created_at desc`;
  const runs = await sql`select x.id, x.rule_id, x.task_id, x.status, x.detail, x.created_at, t.title as task_title, r.name as rule_name
    from automation_runs x join automation_rules r on r.id = x.rule_id left join tasks t on t.id = x.task_id
    where x.rule_id = any(${rules.map((r: any) => r.id)}::uuid[]) order by x.id desc limit 50`;
  return { rules, runs };
}

export async function saveRule(u: SessionUser, id: string | null, i: z.infer<typeof ruleInput>) {
  const sql = db();
  await assertRuleScope(u, i, sql);
  for (const a of i.actions) if ((a.type === 'set_assignee' || (a.type === 'notify' && a.to === 'user')) && !('userId' in a && a.userId)) throw badRequest('사용자를 지정하세요');
  if (id) {
    const [old] = await sql`select org_unit_id, project_id from automation_rules where id = ${id}`;
    if (!old) throw notFound('규칙이 없습니다');
    await assertRuleScope(u, { orgUnitId: old.org_unit_id, projectId: old.project_id }, sql);
    await sql`update automation_rules set name = ${i.name}, org_unit_id = ${i.orgUnitId ?? null}, project_id = ${i.projectId ?? null}, trigger = ${i.trigger},
      conditions = ${sql.json(i.conditions as never)}, actions = ${sql.json(i.actions as never)}, enabled = ${i.enabled ?? true} where id = ${id}`;
    return { id };
  }
  const [r] = await sql<{ id: string }[]>`insert into automation_rules (name, org_unit_id, project_id, trigger, conditions, actions, enabled, created_by)
    values (${i.name}, ${i.orgUnitId ?? null}, ${i.projectId ?? null}, ${i.trigger}, ${sql.json(i.conditions as never)}, ${sql.json(i.actions as never)}, ${i.enabled ?? true}, ${u.id})
    returning id`;
  return { id: r.id };
}

export async function deleteRule(u: SessionUser, id: string) {
  const sql = db();
  const [old] = await sql`select org_unit_id, project_id from automation_rules where id = ${id}`;
  if (!old) throw notFound('규칙이 없습니다');
  await assertRuleScope(u, { orgUnitId: old.org_unit_id, projectId: old.project_id }, sql);
  await sql`delete from automation_rules where id = ${id}`;
  return { ok: true };
}

export interface AutomationEvent {
  trigger: (typeof TRIGGERS)[number];
  taskId: string;
  actorId: string | null;
  fromStatus?: string;
  /** 같은 업무에 같은 트리거가 여러 번 생길 때 구분 (기본: 업무 version) */
  dedupe?: string;
  onlyRuleId?: string;
}

/** 업무 변경 트랜잭션 안에서 호출. 각 규칙은 savepoint 로 격리해 실패해도 원래 변경을 막지 않는다 */
export async function runAutomations(sql: Sql, ev: AutomationEvent) {
  const [t] = await sql<any[]>`select * from tasks where id = ${ev.taskId}`;
  if (!t || t.deleted_at) return 0;
  const rules = await sql<Rule[]>`
    select r.* from automation_rules r where r.enabled and r.trigger = ${ev.trigger} and (${ev.onlyRuleId ?? null}::uuid is null or r.id = ${ev.onlyRuleId ?? null})
      and (r.project_id is null or r.project_id = ${t.project_id})
      and (r.org_unit_id is null or ${t.org_unit_id} in (with recursive d as (select id from org_units where id = r.org_unit_id
           union select c.id from org_units c join d on c.parent_id = d.id) select id from d))`;
  let ran = 0;
  for (const r of rules) {
    const c = r.conditions ?? {};
    if (c.toStatus && c.toStatus !== t.status) continue;
    if (c.priority && c.priority !== t.priority) continue;
    if (c.brandId && c.brandId !== t.brand_id) continue;
    if (c.taskType && c.taskType !== t.task_type) continue;
    if (c.sectionId && c.sectionId !== t.section_id) continue;
    const key = `${ev.trigger}:${t.id}:${ev.dedupe ?? t.version}`;
    const claimed = await sql`insert into automation_runs (rule_id, task_id, dedupe_key, status) values (${r.id}, ${t.id}, ${key}, 'ok')
      on conflict (rule_id, dedupe_key) do nothing returning id`;
    if (!claimed.length) continue;
    const done: string[] = [];
    try {
      await (sql as any).savepoint(async (sp: Sql) => {
        for (const a of r.actions) done.push(await runAction(sp, r, a, t));
      });
      await sql`update automation_runs set detail = ${sql.json({ actions: done } as never)} where id = ${claimed[0].id}`;
      ran++;
    } catch (e) {
      await sql`update automation_runs set status = 'error', detail = ${sql.json({ error: (e as Error).message, actions: done } as never)} where id = ${claimed[0].id}`;
      await logError('automation', e, { ruleId: r.id, taskId: t.id });
    }
  }
  return ran;
}

async function unitManagers(sql: Sql, orgUnitId: string) {
  const r = await sql<{ id: string }[]>`with recursive up as (select id, parent_id from org_units where id = ${orgUnitId}
      union select o.id, o.parent_id from org_units o join up on o.id = up.parent_id)
    select distinct u.id from users u join memberships m on m.user_id = u.id
    where m.org_unit_id in (select id from up) and u.status = 'active' and u.role in ('site_manager','dept_lead')`;
  return r.map((x) => x.id);
}

async function runAction(sql: Sql, r: Rule, a: z.infer<typeof actionSchema>, t: any): Promise<string> {
  const link = `/tasks/${t.id}`;
  switch (a.type) {
    case 'notify': {
      const to = a.to === 'assignee' ? [t.assignee_id] : a.to === 'creator' ? [t.created_by] : a.to === 'user' ? [a.userId] : await unitManagers(sql, t.org_unit_id);
      await notify(sql, { userIds: to, type: 'task_assigned', title: `[자동화] ${a.message || r.name}: ${t.title}`, body: `규칙 '${r.name}'`,
        link, entityType: 'task', entityId: t.id, dedupeKey: `auto:${r.id}:${t.id}:${t.version}:${a.to}` });
      return `알림(${a.to})`;
    }
    case 'set_assignee': {
      const ok = await sql`select 1 from users where id = ${a.userId} and status = 'active'`;
      if (!ok.length) throw new Error('지정한 담당자가 비활성입니다');
      if (t.assignee_id === a.userId) return '담당자 동일(변경 없음)';
      await sql`update tasks set assignee_id = ${a.userId}, assignee_ack_at = null, version = version + 1, updated_at = now() where id = ${t.id}`;
      await activity(sql, 'task', t.id, null, 'updated', { assigneeId: { from: t.assignee_id, to: a.userId }, automation: r.name });
      await notify(sql, { userIds: [a.userId], type: 'task_assigned', title: `업무 배정(자동화): ${t.title}`, body: `규칙 '${r.name}'`, link,
        entityType: 'task', entityId: t.id, dedupeKey: `autoassign:${r.id}:${t.id}:${t.version}` });
      return '담당자 변경';
    }
    case 'set_priority': {
      await sql`update tasks set priority = ${a.priority}, version = version + 1, updated_at = now() where id = ${t.id}`;
      await activity(sql, 'task', t.id, null, 'updated', { priority: { from: t.priority, to: a.priority }, automation: r.name });
      return `우선순위 ${a.priority}`;
    }
    case 'create_follow_up': {
      const assignee = a.assignTo === 'creator' ? t.created_by : t.assignee_id;
      const [n] = await sql<{ id: string }[]>`insert into tasks (project_id, section_id, org_unit_id, brand_id, title, description, priority, assignee_id, due_date, created_by, sort_order)
        values (${t.project_id}, ${t.section_id}, ${t.org_unit_id}, ${t.brand_id}, ${a.title}, ${`자동화 규칙 '${r.name}' 이 만든 후속 업무 — 원 업무: ${t.title}`}, ${t.priority},
          ${assignee}, ${a.dueInDays !== undefined ? addDays(todaySeoul(), a.dueInDays) : null}, ${t.created_by}, extract(epoch from now())) returning id`;
      await sql`insert into task_dependencies (task_id, depends_on_id) values (${n.id}, ${t.id}) on conflict do nothing`;
      await activity(sql, 'task', n.id, null, 'created', { title: a.title, followUpOf: t.id, automation: r.name });
      await notify(sql, { userIds: [assignee], type: 'task_assigned', title: `후속 업무(자동화): ${a.title}`, body: `원 업무: ${t.title}`, link: `/tasks/${n.id}`,
        entityType: 'task', entityId: n.id, dedupeKey: `autofollow:${r.id}:${n.id}` });
      return '후속 업무 생성';
    }
  }
}

/** 정기 실행: 마감 N시간 전 규칙 */
export async function dueSoonAutomations() {
  const sql = db();
  const rules = await sql<Rule[]>`select * from automation_rules where enabled and trigger = 'due_soon'`;
  let n = 0;
  for (const r of rules) {
    const hours = r.conditions?.hoursBefore ?? 24;
    const tasks = await sql<{ id: string; due_date: string }[]>`select id, due_date from tasks
      where deleted_at is null and status <> 'done' and due_date is not null
        and ((due_date + coalesce(due_time, time '23:59')) at time zone 'Asia/Seoul') between now() and now() + make_interval(hours => ${hours})
        and (${r.project_id}::uuid is null or project_id = ${r.project_id})`;
    for (const t of tasks) {
      n += await sql.begin((tx) => runAutomations(tx, { trigger: 'due_soon', taskId: t.id, actorId: null, dedupe: t.due_date, onlyRuleId: r.id }));
    }
  }
  return { rules: rules.length, ran: n };
}
