import { z } from 'zod';
import { db, type Sql } from './db';
import { accessibleUnitIds, isAdmin, loadTaskForUser } from './access';
import { badRequest, forbidden, notFound } from './errors';
import { activity, audit } from './log';
import { notify } from './notifications';
import { tenantOf, type SessionUser } from './types';
import { zUuid } from './api';
import { kstToday } from './away';

/**
 * 결재선 단계: 역할(해당 업무 조직과 상위 조직의 그 역할 사용자) · 지정 사용자 · 소속 장(#429: 요청자 부서·팀의 장, up=1 이면 한 단계 위 부서의 장 — 본부장)
 * #429 조건 단계: when 이 있으면 결재 요청 값이 조건에 맞을 때만 이 단계를 넣는다(예: 휴가 3일 이상이면 대표 추가). 결재 양식이 아닌 일반 업무는 조건을 따질 값이 없어 넣는다(더 엄격하게).
 */
export const stepSchema = z.object({
  label: z.string().trim().min(1).max(40),
  type: z.enum(['role', 'user', 'lead']),
  role: z.enum(['site_manager', 'dept_lead', 'admin', 'owner']).optional(),
  userId: zUuid.optional(),
  up: z.number().int().min(0).max(3).optional(),
  when: z.object({ minDays: z.number().min(0.5).max(365).optional(), minAmount: z.number().int().min(1).max(1e12).optional() })
    .refine((w) => w.minDays !== undefined || w.minAmount !== undefined, '조건(일수 또는 금액)을 넣으세요').optional(),
}).refine((s) => (s.type === 'role' ? !!s.role : s.type === 'user' ? !!s.userId : true), '역할 또는 사용자를 지정하세요');
export const lineInput = z.object({
  name: z.string().trim().min(1).max(60),
  orgUnitId: zUuid.nullable().optional(),
  steps: z.array(stepSchema).min(1).max(6).refine((s) => s.some((x) => !x.when), '조건 없이 항상 거치는 단계가 하나 이상 있어야 합니다'),
  active: z.boolean().optional(),
});
export type Step = z.infer<typeof stepSchema>;
export const LEAD_LABEL = ['소속 장(팀장)', '상위 부서장(본부장)', '2단계 위 부서장', '3단계 위 부서장'];
const lineScope = (sql: Sql, t: string) => sql`(l.tenant = ${t} or l.org_unit_id in (select id from org_units where tenant = ${t}))`;

export async function listLines(u: SessionUser) {
  const sql = db(); const t = tenantOf(u);
  const units = await accessibleUnitIds(u, sql);
  return sql`select l.id, l.name, l.org_unit_id, l.steps, l.active, o.name as org_unit_name,
      (select count(*)::int from approval_line_assignments a where a.line_id = l.id) as assigned
    from approval_lines l left join org_units o on o.id = l.org_unit_id
    where ((l.org_unit_id is null and l.tenant = ${t}) or ${units === null ? sql`l.org_unit_id in (select id from org_units where tenant = ${t})` : sql`l.org_unit_id = any(${units}::uuid[])`})
    order by l.org_unit_id nulls first, l.name`;
}

/** 저장: 회사는 만든 사람의 회사(예전엔 빠져서 'default' 로 들어갔다 — 165 에서 바로잡음), 고치기는 이 회사 결재선만(다른 회사 404) */
export async function saveLine(u: SessionUser, id: string | null, i: z.infer<typeof lineInput>, ip: string | null) {
  await (await import('./menuPerms')).requireMenu(u, 'ops', 'edit');
  const sql = db(); const t = tenantOf(u);
  if (i.orgUnitId) { const [o] = await sql`select 1 from org_units where id = ${i.orgUnitId} and tenant = ${t}`; if (!o) throw notFound('조직이 없습니다'); }
  const userIds = [...new Set(i.steps.filter((s) => s.type === 'user').map((s) => s.userId!))];
  if (userIds.length) { const ok = await sql`select id from users where id = any(${userIds}::uuid[]) and tenant = ${t} and status = 'active'`; if (ok.length !== userIds.length) throw notFound('결재자를 찾을 수 없습니다'); }
  const steps = i.steps.map((s) => ({ label: s.label, type: s.type, ...(s.type === 'role' ? { role: s.role } : s.type === 'user' ? { userId: s.userId } : { up: s.up ?? 0 }), ...(s.when ? { when: s.when } : {}) }));
  if (id) {
    const r = await sql`update approval_lines l set name = ${i.name}, org_unit_id = ${i.orgUnitId ?? null}, steps = ${sql.json(steps as never)},
      active = ${i.active ?? true} where l.id = ${id} and ${lineScope(sql, t)} returning id`;
    if (!r.length) throw notFound('결재선이 없습니다');
  } else {
    const [r] = await sql<{ id: string }[]>`insert into approval_lines (tenant, name, org_unit_id, steps, created_by)
      values (${t}, ${i.name}, ${i.orgUnitId ?? null}, ${sql.json(steps as never)}, ${u.id}) returning id`;
    id = r.id;
  }
  await audit(sql, u.id, 'approval_line.save', 'approval_line', id, i, ip);
  return { id };
}

/** #429 예시 결재선(빈 회사도 바로): 2단계 = 팀장 → 대표, 3단계 = 팀장 → 본부장(상위 부서장) → 대표, 휴가 = 팀장 → (3일 이상이면) 대표 */
export const TEMPLATES: Record<string, { name: string; steps: Step[] }> = {
  two: { name: '2단계(팀장 → 대표)', steps: [{ label: '팀장', type: 'lead', up: 0 }, { label: '대표', type: 'role', role: 'owner' }] },
  three: { name: '3단계(팀장 → 본부장 → 대표)', steps: [{ label: '팀장', type: 'lead', up: 0 }, { label: '본부장', type: 'lead', up: 1 }, { label: '대표', type: 'role', role: 'owner' }] },
  leave3: { name: '휴가(팀장, 3일 이상 대표)', steps: [{ label: '팀장', type: 'lead', up: 0 }, { label: '대표', type: 'role', role: 'owner', when: { minDays: 3 } }] },
};
export async function createTemplate(u: SessionUser, key: string, ip: string | null) {
  const tpl = TEMPLATES[key];
  if (!tpl) throw badRequest('없는 예시입니다');
  const [{ n }] = await db()<{ n: number }[]>`select count(*)::int n from approval_lines where tenant = ${tenantOf(u)} and name like ${tpl.name + '%'}`;
  return saveLine(u, null, { name: n ? `${tpl.name} ${n + 1}` : tpl.name, orgUnitId: null, steps: tpl.steps, active: true }, ip);
}

// ───────── #429 (양식 종류 × 부서·팀) → 결재선 배정 ─────────
export const ASSIGN_KINDS = ['*', 'leave', 'expense', 'general', 'trip', 'purchase', 'family'] as const;
export const assignInput = z.object({ kind: z.enum(ASSIGN_KINDS), teamId: zUuid.nullable(), lineId: zUuid.nullable() });

/** 요청자 부서·팀 사슬: 주 소속 팀 → 상위 부서 → … (가까운 순). 소속이 없으면 빈 배열 */
export async function teamChain(sql: Sql, tenant: string, userId: string) {
  return sql<{ id: string; name: string; parent_id: string | null; lead_id: string | null; depth: number }[]>`
    with recursive start as (
      select t.id from team_members m join teams t on t.id = m.team_id where m.user_id = ${userId} and t.tenant = ${tenant} and not t.archived
      order by m.is_primary desc, case t.kind when 'team' then 0 when 'dept' then 1 when 'division' then 2 else 3 end, t.name limit 1
    ), chain as (
      select t.id, t.name, t.parent_id, 0 as depth from teams t where t.id in (select id from start)
      union all
      select p.id, p.name, p.parent_id, c.depth + 1 from teams p join chain c on p.id = c.parent_id where not p.archived and c.depth < 10
    )
    select c.id, c.name, c.parent_id, c.depth,
      (select m.user_id from team_members m join users x on x.id = m.user_id where m.team_id = c.id and m.is_lead and x.status = 'active' order by m.added_at limit 1) as lead_id
    from chain c order by c.depth`;
}
/** 소속 장 단계의 결재자: 사슬에서 up 칸 위부터 장이 있는 첫 부서·팀(본인이 장이면 그 위로 — 자기 결재는 하지 않음) */
export function leadFor(chain: { lead_id: string | null; name: string }[], up: number, requesterId: string) {
  for (let k = up; k < chain.length; k++) if (chain[k].lead_id && chain[k].lead_id !== requesterId) return { userId: chain[k].lead_id!, unit: chain[k].name };
  return null;
}

export type LineSource = 'chosen' | 'kind_team' | 'form' | 'team' | 'company' | 'legacy';
export const SOURCE_LABEL: Record<LineSource, string> = { chosen: '직접 고름', kind_team: '양식 × 팀 배정', form: '양식 기본', team: '팀 기본', company: '회사 기본', legacy: '조직 결재선' };
/**
 * #429 결재선 고르기 — 작성자 지정 > 양식×요청자 팀(없으면 상위 부서) > 양식 기본(양식×회사 전체 · 예전 양식 칸) > 팀 기본(모든 양식×팀) > 회사 기본(모든 양식×회사 전체)
 * > 예전 방식(요청자 조직·상위 조직의 결재선, 회사 공통 결재선 — 오래된 것부터). 사용 안 함인 결재선은 건너뜀. 지정한 결재선은 이 회사 것이어야 한다(다른 회사 404)
 */
export async function resolveLine(sql: Sql, t: string, c: { userId: string; orgUnitId: string | null; kind: string; given?: string | null; formLine?: string | null }) {
  if (c.given) {
    const [l] = await sql<{ id: string }[]>`select l.id from approval_lines l where l.id = ${c.given} and l.active and ${lineScope(sql, t)}`;
    if (!l) throw notFound('결재선이 없습니다');
    return { lineId: l.id, source: 'chosen' as LineSource, via: null as string | null };
  }
  const chain = await teamChain(sql, t, c.userId);
  const rows = await sql<{ kind: string; team_id: string | null; line_id: string }[]>`select a.kind, a.team_id, a.line_id from approval_line_assignments a join approval_lines l on l.id = a.line_id
    where a.tenant = ${t} and l.active and a.kind in (${c.kind}, '*') and (a.team_id is null or a.team_id = any(${chain.map((x) => x.id)}::uuid[]))`;
  const pick = (kind: string, teamId: string | null) => rows.find((r) => r.kind === kind && r.team_id === teamId)?.line_id ?? null;
  for (const tm of chain) { const id = pick(c.kind, tm.id); if (id) return { lineId: id, source: 'kind_team' as LineSource, via: tm.name }; }
  const formDefault = pick(c.kind, null);
  if (formDefault) return { lineId: formDefault, source: 'form' as LineSource, via: null };
  if (c.formLine) { const [l] = await sql<{ id: string }[]>`select l.id from approval_lines l where l.id = ${c.formLine} and l.active and ${lineScope(sql, t)}`; if (l) return { lineId: l.id, source: 'form' as LineSource, via: null }; }
  for (const tm of chain) { const id = pick('*', tm.id); if (id) return { lineId: id, source: 'team' as LineSource, via: tm.name }; }
  const company = pick('*', null);
  if (company) return { lineId: company, source: 'company' as LineSource, via: null };
  if (!c.orgUnitId) return { lineId: null, source: null, via: null };
  const [l] = await sql<{ id: string }[]>`with recursive up as (select id, parent_id, 0 as d from org_units where id = ${c.orgUnitId} union select o.id, o.parent_id, up.d + 1 from org_units o join up on o.id = up.parent_id where up.d < 20)
    select l.id from approval_lines l left join up on up.id = l.org_unit_id where l.active and (up.id is not null or (l.org_unit_id is null and l.tenant = ${t}))
    order by up.d nulls last, l.created_at limit 1`;
  return l ? { lineId: l.id, source: 'legacy' as LineSource, via: null } : { lineId: null, source: null, via: null };
}

export async function listAssignments(u: SessionUser) {
  const sql = db(); const t = tenantOf(u);
  const { menuLevel } = await import('./menuPerms');
  if (!isAdmin(u) && (await menuLevel(u, 'ops')) === 'none') throw notFound();
  const assignments = await sql`select a.id, a.kind, a.team_id, a.line_id, l.name as line_name, l.steps, l.active, tm.name as team_name
    from approval_line_assignments a join approval_lines l on l.id = a.line_id left join teams tm on tm.id = a.team_id
    where a.tenant = ${t} order by a.team_id nulls first, tm.name, a.kind`;
  const teams = await sql`with recursive tr as (
      select id, name, parent_id, kind, name::text as path, 0 as depth from teams where tenant = ${t} and not archived and parent_id is null
      union all select c.id, c.name, c.parent_id, c.kind, tr.path || ' › ' || c.name, tr.depth + 1 from teams c join tr on c.parent_id = tr.id where not c.archived and tr.depth < 10)
    select tr.id, tr.name, tr.path, tr.kind, tr.depth, (select u2.name from team_members m join users u2 on u2.id = m.user_id where m.team_id = tr.id and m.is_lead and u2.status = 'active' limit 1) as lead_name,
      (select count(*)::int from team_members m where m.team_id = tr.id) as members
    from tr order by tr.path`;
  return { assignments, teams };
}
/** 배정 저장(lineId null = 지우기) — 운영 상태 편집 권한. 양식×회사 전체 = 양식 기본이라 양식 칸(approval_forms.line_id)도 같이 맞춘다 */
export async function saveAssignment(u: SessionUser, i: z.infer<typeof assignInput>, ip: string | null) {
  await (await import('./menuPerms')).requireMenu(u, 'ops', 'edit');
  const sql = db(); const t = tenantOf(u);
  if (i.teamId) { const [tm] = await sql`select 1 from teams where id = ${i.teamId} and tenant = ${t}`; if (!tm) throw notFound('부서·팀이 없습니다'); }
  if (i.lineId) { const [l] = await sql`select 1 from approval_lines l where l.id = ${i.lineId} and l.active and ${lineScope(sql, t)}`; if (!l) throw notFound('결재선이 없습니다'); }
  await sql.begin(async (tx) => {
    await tx`delete from approval_line_assignments where tenant = ${t} and kind = ${i.kind} and team_id is not distinct from ${i.teamId}`;
    if (i.lineId) await tx`insert into approval_line_assignments (tenant, kind, team_id, line_id, created_by) values (${t}, ${i.kind}, ${i.teamId}, ${i.lineId}, ${u.id})`;
    if (i.kind !== '*' && !i.teamId) await tx`update approval_forms set line_id = ${i.lineId}, updated_at = now() where tenant = ${t} and kind = ${i.kind} and active`;
  });
  await audit(sql, u.id, 'approval_line.assign', 'approval_line', i.lineId, { kind: i.kind, teamId: i.teamId }, ip);
  return { ok: true };
}

/** #429 '누구에게 어떻게 적용되나': 한 사람이 양식마다 올리면 어떤 결재선·어디서 정해졌는지·1차·2차·3차 결재자 */
export async function resolveForMember(u: SessionUser, userId: string) {
  const { menuLevel } = await import('./menuPerms');
  if (!isAdmin(u) && (await menuLevel(u, 'ops')) === 'none') throw notFound();
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw notFound('사람이 없습니다');
  const sql = db(); const t = tenantOf(u);
  const [who] = await sql<{ id: string; name: string }[]>`select id, name from users where id = ${userId} and tenant = ${t} and status = 'active'`;
  if (!who) throw notFound('사람이 없습니다');
  const [m] = await sql<{ org_unit_id: string }[]>`select m.org_unit_id from memberships m join org_units o on o.id = m.org_unit_id where m.user_id = ${userId} and o.tenant = ${t} order by o.type = 'hq' desc limit 1`;
  const [hq] = await sql<{ id: string }[]>`select id from org_units where tenant = ${t} and type = 'hq' order by created_at limit 1`;
  const orgUnitId = m?.org_unit_id ?? hq?.id ?? null;
  const chain = await teamChain(sql, t, userId);
  const formLines = await sql<{ kind: string; line_id: string | null }[]>`select distinct on (kind) kind, line_id from approval_forms where tenant = ${t} and active order by kind, updated_at desc`;
  const results = [];
  for (const kind of ASSIGN_KINDS.filter((k) => k !== '*')) {
    const r = await resolveLine(sql, t, { userId, orgUnitId, kind, formLine: formLines.find((f) => f.kind === kind)?.line_id ?? null });
    let lineName: string | null = null; let steps: { label: string; names: string[]; cond: string | null }[] = [];
    if (r.lineId && orgUnitId) {
      const [line] = await sql<{ name: string; steps: Step[] }[]>`select name, steps from approval_lines where id = ${r.lineId}`;
      lineName = line?.name ?? null;
      steps = await Promise.all((line?.steps ?? []).map(async (st) => {
        let ids: string[] = [];
        if (st.type === 'lead') { const l = leadFor(chain, st.up ?? 0, userId); ids = l ? [l.userId] : []; }
        else ids = await stepApprovers(sql, orgUnitId, { approver_type: st.type, approver_role: st.role ?? null, approver_user_id: st.userId ?? null }, { deputies: false });
        const names = ids.length ? (await sql<{ name: string }[]>`select name from users where id = any(${ids}::uuid[]) order by name`).map((x) => x.name) : [];
        return { label: st.label, names, cond: st.when ? whenText(st.when) : null };
      }));
    }
    results.push({ kind, lineId: r.lineId, lineName, source: r.source, sourceLabel: r.source ? SOURCE_LABEL[r.source] : null, via: r.via, steps });
  }
  return { user: who, path: chain.length ? chain.map((c) => c.name).reverse().join(' › ') : null, results };
}

// ───────── 결재 진행 ─────────
/** #429 대결: 오늘 부재(직접 설정·연차) 중이고 대리인을 정한 결재자는 대리인도 결재할 수 있다 */
async function withDeputies(sql: Sql, ids: string[], tenant: string | null) {
  if (!ids.length) return ids;
  const today = kstToday();
  const dep = await sql<{ id: string }[]>`select s.away_deputy_id as id from user_settings s join users d on d.id = s.away_deputy_id
    where s.user_id = any(${ids}::uuid[]) and s.away_deputy_id is not null and s.away_from <= ${today} and s.away_to >= ${today} and d.status = 'active' ${tenant ? sql`and d.tenant = ${tenant}` : sql``}`;
  return [...new Set([...ids, ...dep.map((x) => x.id)])];
}
/** 단계별 결재자 목록(대리인 포함) — 대표·관리자 역할은 이 업무 조직의 회사 안에서만(예전엔 회사 구분이 없어 다른 회사 대표에게도 알림이 갔다) */
export async function stepApprovers(sql: Sql, orgUnitId: string, row: { approver_type: string; approver_role: string | null; approver_user_id: string | null }, opt: { deputies?: boolean } = {}) {
  const [o] = await sql<{ tenant: string }[]>`select tenant from org_units where id = ${orgUnitId}`;
  const tenant = o?.tenant ?? null;
  let ids: string[];
  if (row.approver_type === 'user') {
    ids = (await sql<{ id: string }[]>`select id from users where id = ${row.approver_user_id} and status = 'active' ${tenant ? sql`and tenant = ${tenant}` : sql``}`).map((x) => x.id);
  } else if (row.approver_role === 'owner' || row.approver_role === 'admin') {
    const roles = row.approver_role === 'owner' ? ['owner'] : ['owner', 'admin'];
    ids = tenant ? (await sql<{ id: string }[]>`select id from users where role = any(${roles}) and status = 'active' and tenant = ${tenant}`).map((x) => x.id) : [];
  } else {
    ids = (await sql<{ id: string }[]>`
      with recursive up as (select id, parent_id from org_units where id = ${orgUnitId}
        union select o.id, o.parent_id from org_units o join up on o.id = up.parent_id)
      select distinct u.id from users u join memberships m on m.user_id = u.id
      where m.org_unit_id in (select id from up) and u.status = 'active' and u.role = ${row.approver_role}`).map((x) => x.id);
  }
  return opt.deputies === false ? ids : withDeputies(sql, ids, tenant);
}

/** 결재 요청 값으로 조건 판단: 기간 일수(주말 제외, 반차 0.5) · 금액 */
export function requestMetrics(kind: string, data: Record<string, any> | null | undefined, amount: number | null | undefined) {
  const d = data ?? {};
  let days: number | null = null;
  const p = d.period as { from?: string; to?: string } | undefined;
  if (p?.from && p?.to && /^\d{4}-\d{2}-\d{2}$/.test(p.from) && /^\d{4}-\d{2}-\d{2}$/.test(p.to) && p.to >= p.from) {
    if (kind === 'leave' && String(d.leave_type ?? '').startsWith('반차')) days = 0.5;
    else {
      days = 0;
      for (let t = new Date(`${p.from}T00:00:00Z`), end = new Date(`${p.to}T00:00:00Z`); t <= end && days < 400; t.setUTCDate(t.getUTCDate() + 1)) if (t.getUTCDay() % 6 !== 0) days++;
    }
  } else if (kind === 'family' && Number(d.leave_days) > 0) days = Number(d.leave_days);
  const amt = amount ?? (Number.isFinite(Number(d.amount)) && d.amount !== '' && d.amount !== undefined && d.amount !== null ? Number(String(d.amount).replace(/[^0-9.-]/g, '')) : null);
  return { days, amount: amt !== null && Number.isFinite(amt) ? amt : null };
}
/** 조건 단계를 넣을지: 조건이 없으면 항상. 일수·금액 중 하나라도 맞으면 넣고, 따질 값이 하나도 없으면(일반 업무·값 없음) 넣는다(더 엄격하게) */
export function stepApplies(when: Step['when'] | undefined, m: { days: number | null; amount: number | null } | null) {
  if (!when || !m) return true;
  const checks: (boolean | null)[] = [];
  if (when.minDays !== undefined) checks.push(m.days === null ? null : m.days >= when.minDays);
  if (when.minAmount !== undefined) checks.push(m.amount === null ? null : m.amount >= when.minAmount);
  return checks.some((c) => c === true) || checks.every((c) => c === null);
}
export const whenText = (w: Step['when']) => (!w ? '' : [w.minDays !== undefined ? `${w.minDays}일 이상` : '', w.minAmount !== undefined ? `${Number(w.minAmount).toLocaleString('ko-KR')}원 이상` : ''].filter(Boolean).join(' 또는 ') + '일 때');

/** 결재 요청을 만들기 전에 넣을 단계마다 결재자가 있는지(소속 장·역할·지정 사람) — 없으면 업무를 만들지 않고 이유를 보여 준다(예전엔 업무만 생기고 멈췄다) */
export async function assertLineUsable(sql: Sql, t: string, lineId: string, c: { requesterId: string; orgUnitId: string; kind: string; data: Record<string, unknown>; amount: number | null }) {
  const [line] = await sql<{ steps: Step[]; active: boolean }[]>`select steps, active from approval_lines where id = ${lineId}`;
  if (!line?.active) throw badRequest('사용할 수 없는 결재선입니다');
  const steps = line.steps.filter((s) => stepApplies(s.when, requestMetrics(c.kind, c.data, c.amount)));
  const chain = steps.some((s) => s.type === 'lead') ? await teamChain(sql, t, c.requesterId) : [];
  for (const [k, s] of steps.entries()) {
    const ids = s.type === 'lead' ? (leadFor(chain, s.up ?? 0, c.requesterId) ? [1] : [])
      : await stepApprovers(sql, c.orgUnitId, { approver_type: s.type, approver_role: s.role ?? null, approver_user_id: s.userId ?? null }, { deputies: false });
    if (!ids.length) throw badRequest(`결재선 ${k + 1}차(${s.label}) 결재자가 없습니다 — ${s.type === 'lead' ? (chain.length ? '소속 부서·팀(또는 상위 부서)에 장을 지정하세요' : '주 소속 부서·팀이 없습니다(사용자 관리 › 소속)') : '그 역할·사람이 조직에 있는지 확인하세요'}`);
  }
}

/** 검토 요청 시 결재 회차 시작 (updateTask 트랜잭션 안에서 호출) — 조건 단계 거르기 · 소속 장 단계는 이때 사람으로 정해 둔다(중간에 장이 바뀌어도 그대로) */
export async function startApprovalRound(sql: Sql, taskId: string, lineId: string, orgUnitId: string, actorId: string, title: string) {
  const [line] = await sql<{ steps: Step[]; active: boolean }[]>`select steps, active from approval_lines where id = ${lineId}`;
  if (!line || !line.active) throw badRequest('사용할 수 없는 결재선입니다');
  const [req] = await sql<{ kind: string; data: any; amount: string | null; requester_id: string; tenant: string }[]>`select kind, data, amount, requester_id, tenant from approval_requests where task_id = ${taskId} limit 1`;
  const metrics = req ? requestMetrics(req.kind, req.data, req.amount === null ? null : Number(req.amount)) : null;
  const requesterId = req?.requester_id ?? actorId;
  const steps = line.steps.filter((s) => stepApplies(s.when, metrics));
  const [o] = await sql<{ tenant: string }[]>`select tenant from org_units where id = ${orgUnitId}`;
  const chain = steps.some((s) => s.type === 'lead') ? await teamChain(sql, req?.tenant ?? o?.tenant ?? '', requesterId) : [];
  const [{ r }] = await sql<{ r: number }[]>`select coalesce(max(round), 0) + 1 as r from task_approvals where task_id = ${taskId}`;
  let n = 1;
  for (const s of steps) {
    let type: string = s.type, role = s.role ?? null, userId = s.userId ?? null;
    if (s.type === 'lead') {
      const lead = leadFor(chain, s.up ?? 0, requesterId);
      if (!lead) throw badRequest(`결재선 ${n}차(${s.label}) 결재자가 없습니다 — ${chain.length ? '소속 부서·팀(또는 상위 부서)에 장을 지정하세요' : '주 소속 부서·팀이 없습니다(사용자 관리 › 소속)'}`);
      type = 'user'; role = null; userId = lead.userId;
    }
    await sql`insert into task_approvals (task_id, round, step, label, approver_type, approver_role, approver_user_id, status)
      values (${taskId}, ${r}, ${n}, ${s.label}, ${type}, ${role}, ${userId}, ${n === 1 ? 'pending' : 'waiting'})`;
    n++;
  }
  const [first] = await sql`select * from task_approvals where task_id = ${taskId} and round = ${r} and step = 1`;
  const who = await stepApprovers(sql, orgUnitId, first as any);
  if (!who.length) throw badRequest(`결재선 1차(${first.label}) 결재자가 없습니다. 결재선이나 조직 구성을 확인하세요.`);
  await notify(sql, { userIds: who, type: 'review_requested', title: `결재 요청 (${first.label}): ${title}`, body: `1차 결재 · 총 ${steps.length}단계`,
    link: `/tasks/${taskId}`, entityType: 'task', entityId: taskId, actorId, dedupeKey: `appr:${taskId}:${r}:1`, meta: { kind: 'approval' } });
  return r;
}

/** 진행 중인 결재 회차 취소 (상태를 직접 되돌릴 때) */
export async function cancelOpenRound(sql: Sql, taskId: string) {
  await sql`delete from task_approvals where task_id = ${taskId} and status in ('pending','waiting')
    and round = (select max(round) from task_approvals where task_id = ${taskId})`;
}

export async function openRound(sql: Sql, taskId: string) {
  return sql<any[]>`select a.*, d.name as decided_by_name, au.name as approver_name from task_approvals a left join users d on d.id = a.decided_by left join users au on au.id = a.approver_user_id
    where a.task_id = ${taskId} order by a.round desc, a.step`;
}

/** 결재: 승인 → 다음 단계, 마지막 단계면 최종 완료 / 반려(사유 필수) → 진행 중으로. 지정 결재자가 부재면 대리인이 대결(기록에 남김) */
export async function decide(u: SessionUser, taskId: string, decision: 'approve' | 'reject', comment: string | undefined, ip: string | null) {
  const sql = db();
  return sql.begin(async (tx) => {
    const { task } = await loadTaskForUser(u, taskId, tx);
    const [t] = await tx`select * from tasks where id = ${taskId} for update`;
    if (t.status !== 'review') throw badRequest('결재 대기 중인 업무가 아닙니다');
    const [cur] = await tx<any[]>`select * from task_approvals where task_id = ${taskId} and status = 'pending'
      and round = (select max(round) from task_approvals where task_id = ${taskId}) limit 1`;
    if (!cur) throw badRequest('진행 중인 결재 단계가 없습니다');
    const own = await stepApprovers(tx, task.org_unit_id, cur, { deputies: false });
    const who = own.includes(u.id) ? own : await stepApprovers(tx, task.org_unit_id, cur);
    if (!who.includes(u.id)) throw forbidden(`이 단계(${cur.label})의 결재자가 아닙니다`);
    const proxy = !own.includes(u.id); // 대결
    if (decision === 'reject' && !comment?.trim()) throw badRequest('반려 사유를 입력하세요');
    const note = comment?.trim() ? (proxy ? `[대결] ${comment.trim()}` : comment.trim()) : (proxy ? '[대결]' : null);
    await tx`update task_approvals set status = ${decision === 'approve' ? 'approved' : 'rejected'}, decided_by = ${u.id}, decided_at = now(),
      comment = ${note} where id = ${cur.id}`;
    await audit(tx, u.id, 'approval.decide', 'task', taskId, { round: cur.round, step: cur.step, label: cur.label, decision, comment: comment ?? null, proxyFor: proxy ? own : undefined }, ip);
    const [{ total }] = await tx<{ total: number }[]>`select count(*)::int total from task_approvals where task_id = ${taskId} and round = ${cur.round}`;
    if (decision === 'reject') {
      await tx`update tasks set status = 'in_progress', version = version + 1, updated_at = now() where id = ${taskId}`;
      await tx`insert into comments (task_id, author_id, body) values (${taskId}, ${u.id}, ${`[반려 · ${cur.step}차 ${cur.label}${proxy ? ' · 대결' : ''}] ${comment!.trim()}`})`;
      await activity(tx, 'task', taskId, u.id, 'review_rejected', { status: { from: 'review', to: 'in_progress' }, note: comment, step: cur.label });
      await (await import('./approvalForms')).onApprovalTaskDecided(tx, taskId, 'rejected', u.id); // V30 ④ 결재 양식 요청이면 반려로
      await notify(tx, { userIds: [t.assignee_id, t.review_requested_by], type: 'review_result', title: `결재 반려 (${cur.step}차 ${cur.label}): ${t.title}`,
        body: comment!.trim().slice(0, 120), link: `/tasks/${taskId}`, entityType: 'task', entityId: taskId, actorId: u.id,
        dedupeKey: `apprrej:${taskId}:${cur.round}:${cur.step}` });
      return { status: 'rejected' };
    }
    if (cur.step < total) {
      await tx`update task_approvals set status = 'pending' where task_id = ${taskId} and round = ${cur.round} and step = ${cur.step + 1}`;
      const [next] = await tx<any[]>`select * from task_approvals where task_id = ${taskId} and round = ${cur.round} and step = ${cur.step + 1}`;
      const nextWho = await stepApprovers(tx, task.org_unit_id, next);
      await activity(tx, 'task', taskId, u.id, 'approval_step', { step: cur.label, next: next.label, ...(proxy ? { proxy: true } : {}) });
      await notify(tx, { userIds: nextWho, type: 'review_requested', title: `결재 요청 (${next.label}): ${t.title}`, body: `${cur.step + 1}차 결재 · 총 ${total}단계 · ${cur.step}차 ${cur.label} 승인`,
        link: `/tasks/${taskId}`, entityType: 'task', entityId: taskId, actorId: u.id, dedupeKey: `appr:${taskId}:${cur.round}:${cur.step + 1}`, meta: { kind: 'approval' } });
      return { status: 'next', step: cur.step + 1 };
    }
    // 마지막 단계 승인 → 최종 완료
    await tx`update tasks set status = 'done', completed_at = now(), approved_at = now(), approved_by = ${u.id}, version = version + 1, updated_at = now() where id = ${taskId}`;
    await activity(tx, 'task', taskId, u.id, 'approved', { status: { from: 'review', to: 'done' }, step: cur.label });
    await (await import('./approvalForms')).onApprovalTaskDecided(tx, taskId, 'approved', u.id); // V30 ④ 휴가면 부재 일정 자동 등록
    // 로컬 10/20 알림 다이어트: 최종 완료는 결재를 올린 사람에게 푸시, 담당자(올린 사람이 아니면)는 목록에만
    const base = { type: 'review_result' as const, title: `최종 결재 완료: ${t.title}`, body: `${cur.step}차 ${cur.label} 승인으로 완료되었습니다`, link: `/tasks/${taskId}`, entityType: 'task', entityId: taskId, actorId: u.id, dedupeKey: `apprdone:${taskId}:${cur.round}` };
    await notify(tx, { ...base, userIds: [t.review_requested_by] });
    if (t.assignee_id !== t.review_requested_by) await notify(tx, { ...base, userIds: [t.assignee_id], push: false });
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
