/**
 * 대표 10/20 15:00 (#100) 담당자 지정 — 관리 › 사용자 관리 '담당자 지정'.
 * 규칙(회사별): 마케팅 담당(브랜드별) · 영업 담당(원천별) · 업무 배정 담당(부서/팀별) · 승인자(마케팅). 각 규칙에 주 담당 + 부 담당.
 * 자동으로 생기는 업무·카드·알림은 resolveAssignee() 로 담당자를 고른다 — 주 담당이 오늘 연차·출장(하루 부재)이면 부 담당, 둘 다 부재면 주 담당(복귀 후 확인).
 * 규칙으로 배정된 업무는 tasks.assigned_by_rule 에 규칙 id 를 남겨 화면에 '규칙 배정' 표시.
 */
import { z } from 'zod';
import { db, type Sql } from './db';
import { isAdmin } from './access';
import { badRequest, forbidden, notFound } from './errors';
import { audit } from './log';
import { zUuid } from './api';
import { tenantOf, type SessionUser } from './types';

export const RULE_KINDS = ['marketing_brand', 'sales_source', 'task_unit', 'approver'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
export const RULE_KIND_LABEL: Record<RuleKind, string> = { marketing_brand: '마케팅 담당(브랜드별)', sales_source: '영업 담당(원천별)', task_unit: '업무 배정 담당(부서·팀별)', approver: '승인자(마케팅)' };
export const SALES_SOURCES = ['bid', 'building', 'facility', 'vendor', 'lead'] as const;
export type Resolved = { userId: string; ruleId: string; primaryUserId: string; backupUsed: boolean };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 지금 하루 부재(연차·출장)인 사람 — 반차·외근은 자리만 비우는 것이라 대체하지 않음(presence 와 같은 기준) */
async function awayNow(sql: Sql, ids: string[], now = new Date()): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await sql<{ created_by: string }[]>`select distinct e.created_by from events e where e.created_by = any(${ids}::uuid[]) and e.deleted_at is null and not e.cancelled and e.rrule is null
    and e.kind in ('vacation', 'business_trip') and e.start_at <= ${now} and e.end_at > ${now}`;
  const manual = await (await import('./away')).manualAwaySet(sql, ids, now); // #76 직접 설정한 부재도 대체
  return new Set([...rows.map((r) => r.created_by), ...manual]);
}

/** 규칙으로 담당자 고르기 — ref 가 있으면 그 규칙, 없으면 기본('') 규칙. 규칙이 없으면 null(호출한 쪽의 기존 기본값) */
export async function resolveAssignee(sql: Sql, tenant: string, kind: RuleKind, ref: string | null | undefined, now = new Date()): Promise<Resolved | null> {
  const r = String(ref ?? '');
  const [rule] = await sql<{ id: string; primary_user_id: string; backup_user_id: string | null }[]>`select id, primary_user_id, backup_user_id from assignee_rules
    where tenant = ${tenant} and kind = ${kind} and ref in (${r}, '') order by (ref = ${r}) desc limit 1`;
  if (!rule) return null;
  const ids = [rule.primary_user_id, rule.backup_user_id].filter(Boolean) as string[];
  const active = new Set((await sql<{ id: string }[]>`select id from users where id = any(${ids}::uuid[]) and tenant = ${tenant} and status = 'active'`).map((x) => x.id));
  const away = await awayNow(sql, ids, now);
  const ok = (id: string | null) => !!id && active.has(id) && !away.has(id);
  if (ok(rule.primary_user_id)) return { userId: rule.primary_user_id, ruleId: rule.id, primaryUserId: rule.primary_user_id, backupUsed: false };
  if (ok(rule.backup_user_id)) return { userId: rule.backup_user_id!, ruleId: rule.id, primaryUserId: rule.primary_user_id, backupUsed: true };
  if (active.has(rule.primary_user_id)) return { userId: rule.primary_user_id, ruleId: rule.id, primaryUserId: rule.primary_user_id, backupUsed: false }; // 둘 다 부재 → 주 담당(복귀 후 확인)
  return null;
}
/** 규칙으로 배정된 업무 표시 */
export async function markRuleTask(sql: Sql, taskId: string, ruleId: string) { await sql`update tasks set assigned_by_rule = ${ruleId} where id = ${taskId}`; }

export async function listRules(u: SessionUser) {
  if (!isAdmin(u)) throw forbidden('담당자 지정은 관리자만 볼 수 있습니다');
  const sql = db(); const t = tenantOf(u);
  const rules = await sql<any[]>`select r.id, r.kind, r.ref, r.primary_user_id, r.backup_user_id, r.note, p.name as primary_name, b.name as backup_name from assignee_rules r
    join users p on p.id = r.primary_user_id left join users b on b.id = r.backup_user_id where r.tenant = ${t} order by r.kind, r.ref`;
  const people = await sql<{ id: string; name: string; title: string | null; role: string }[]>`select id, name, title, role from users where tenant = ${t} and status = 'active' and not is_demo order by name`;
  const brands = await sql<{ id: string; name: string; color: string }[]>`select id, name, color from mkt_brands where tenant = ${t} order by name`;
  const units = await sql<{ id: string; parent_id: string | null; type: string; name: string }[]>`select id, parent_id, type, name from org_units where tenant = ${t} and active and not is_demo order by sort, name`;
  const terms = await (await import('./sales/options')).salesTerms(t);
  const sources = SALES_SOURCES.map((k) => ({ key: k, label: terms.kind[k] }));
  const pm = await (await import('./presence')).presenceMap(u).catch(() => ({} as Record<string, { label: string }>));
  return {
    rules: rules.map((r) => ({ id: r.id, kind: r.kind, ref: r.ref, primaryUserId: r.primary_user_id, backupUserId: r.backup_user_id, note: r.note, primaryName: r.primary_name, backupName: r.backup_name,
      primaryAway: pm[r.primary_user_id]?.label ?? null, backupAway: r.backup_user_id ? (pm[r.backup_user_id]?.label ?? null) : null })),
    options: { people, brands, units, sources }, labels: RULE_KIND_LABEL,
  };
}
export const ruleInput = z.object({ kind: z.enum(RULE_KINDS), ref: z.string().trim().max(100).default(''), primaryUserId: zUuid, backupUserId: zUuid.nullable().optional(), note: z.string().trim().max(300).nullable().optional() });
export async function upsertRule(u: SessionUser, i: z.infer<typeof ruleInput>) {
  if (!isAdmin(u)) throw forbidden('담당자 지정은 관리자만 바꿉니다');
  const sql = db(); const t = tenantOf(u);
  if (i.backupUserId && i.backupUserId === i.primaryUserId) throw badRequest('주 담당과 부 담당이 같습니다');
  const ids = [i.primaryUserId, ...(i.backupUserId ? [i.backupUserId] : [])];
  if ((await sql`select id from users where id = any(${ids}::uuid[]) and tenant = ${t} and status = 'active'`).length !== ids.length) throw badRequest('담당자는 우리 회사의 사용 중인 사람이어야 합니다');
  let ref = i.ref;
  if (i.kind === 'approver') ref = '';
  else if (i.kind === 'sales_source') { if (ref && !(SALES_SOURCES as readonly string[]).includes(ref)) throw badRequest('영업 원천이 올바르지 않습니다'); }
  else if (i.kind === 'marketing_brand') { if (ref && (!UUID.test(ref) || !(await sql`select 1 from mkt_brands where id = ${ref}::uuid and tenant = ${t}`).length)) throw badRequest('브랜드를 찾을 수 없습니다'); }
  else if (!ref || !UUID.test(ref) || !(await sql`select 1 from org_units where id = ${ref}::uuid and tenant = ${t}`).length) throw badRequest('부서·팀을 고르세요');
  const [r] = await sql<{ id: string }[]>`insert into assignee_rules (tenant, kind, ref, primary_user_id, backup_user_id, note) values (${t}, ${i.kind}, ${ref}, ${i.primaryUserId}, ${i.backupUserId ?? null}, ${i.note ?? null})
    on conflict (tenant, kind, ref) do update set primary_user_id = excluded.primary_user_id, backup_user_id = excluded.backup_user_id, note = excluded.note, updated_at = now() returning id`;
  await audit(sql, u.id, 'assignee_rule.set', 'assignee_rule', r.id, { kind: i.kind, ref, primaryUserId: i.primaryUserId, backupUserId: i.backupUserId ?? null }).catch(() => {});
  return listRules(u);
}
export async function deleteRule(u: SessionUser, id: string) {
  if (!isAdmin(u)) throw forbidden('담당자 지정은 관리자만 바꿉니다');
  if (!UUID.test(id)) throw notFound('규칙을 찾을 수 없습니다');
  const sql = db(); const t = tenantOf(u);
  const [r] = await sql<{ id: string; kind: string; ref: string }[]>`delete from assignee_rules where id = ${id}::uuid and tenant = ${t} returning id, kind, ref`;
  if (!r) throw notFound('규칙을 찾을 수 없습니다');
  await audit(sql, u.id, 'assignee_rule.delete', 'assignee_rule', r.id, { kind: r.kind, ref: r.ref }).catch(() => {});
  return listRules(u);
}
