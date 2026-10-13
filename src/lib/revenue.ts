import { z } from 'zod';
import { db, type Sql } from './db';
import { isAdmin } from './access';
import { badRequest, notFound } from './errors';
import { audit } from './log';
import type { SessionUser } from './types';

/** 매출은 본사만: 대표·본사 관리자, 또는 본사(hq) 조직 소속. 그 밖에는 화면·API 모두 없는 것처럼(404) */
export async function canSeeRevenue(u: SessionUser, sql: Sql = db()) {
  if (isAdmin(u)) return true;
  const r = await sql`select 1 from memberships m join org_units o on o.id = m.org_unit_id where m.user_id = ${u.id} and o.type = 'hq' limit 1`;
  return r.length > 0;
}
export async function requireRevenue(u: SessionUser, sql: Sql = db()) {
  if (!(await canSeeRevenue(u, sql))) throw notFound();
}

const won = z.coerce.number().int('원 단위 정수로 입력하세요').min(0, '0 이상이어야 합니다').max(1e13, '값이 너무 큽니다');
export const revenueInput = z.object({
  orgUnitId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM 형식이어야 합니다'),
  revenue: won,
  expense: won.default(0),
  members: z.coerce.number().int().min(0).max(1e7).nullable().optional(),
  target: won.nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type RevenueInput = z.infer<typeof revenueInput>;

export async function listRevenue(u: SessionUser, year: number) {
  const sql = db();
  await requireRevenue(u, sql);
  const [units, rows] = await Promise.all([
    sql`select o.id, o.name, o.type, o.brand_id from org_units o where o.active and o.type in ('branch', 'site') order by o.brand_id nulls last, o.sort, o.name`,
    sql`select r.id, r.org_unit_id, to_char(r.month, 'YYYY-MM') as month, r.revenue::float8 as revenue, r.expense::float8 as expense, r.members,
          r.target::float8 as target, r.note, r.source, r.source_file, r.updated_at, u.name as updated_by_name
        from revenue_entries r left join users u on u.id = r.updated_by
        where r.month >= ${`${year - 1}-01-01`} and r.month <= ${`${year}-12-01`} order by r.month`,
  ]);
  return { year, units, rows };
}

async function upsert(sql: Sql, u: SessionUser, i: RevenueInput, source: 'manual' | 'csv' | 'gpt', file: string | null) {
  const unit = await sql`select id from org_units where id = ${i.orgUnitId}`;
  if (!unit.length) throw badRequest('현장을 찾을 수 없습니다');
  await sql`insert into revenue_entries (org_unit_id, month, revenue, expense, members, target, note, source, source_file, created_by, updated_by)
    values (${i.orgUnitId}, ${i.month + '-01'}, ${i.revenue}, ${i.expense ?? 0}, ${i.members ?? null}, ${i.target ?? null}, ${i.note ?? null}, ${source}, ${file}, ${u.id}, ${u.id})
    on conflict (org_unit_id, month) do update set revenue = excluded.revenue, expense = excluded.expense, members = excluded.members,
      target = excluded.target, note = excluded.note, source = excluded.source, source_file = excluded.source_file, updated_by = excluded.updated_by, updated_at = now()`;
}

export async function saveRevenue(u: SessionUser, i: RevenueInput, ip: string | null) {
  const sql = db();
  await requireRevenue(u, sql);
  await upsert(sql, u, i, 'manual', null);
  await audit(sql, u.id, 'revenue.save', 'org_unit', i.orgUnitId, { month: i.month, revenue: i.revenue, expense: i.expense }, ip);
}

export async function deleteRevenue(u: SessionUser, orgUnitId: string, month: string, ip: string | null) {
  const sql = db();
  await requireRevenue(u, sql);
  if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest('YYYY-MM 형식이어야 합니다');
  await sql`delete from revenue_entries where org_unit_id = ${orgUnitId} and month = ${month + '-01'}`;
  await audit(sql, u.id, 'revenue.delete', 'org_unit', orgUnitId, { month }, ip);
}

/** CSV 한 줄을 칸으로 (따옴표·쉼표 포함 칸 지원) */
function splitCsvLine(line: string) {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
const HEAD: Record<string, string> = {
  현장: 'unit', 지점: 'unit', org: 'unit', site: 'unit', 월: 'month', month: 'month', 기준월: 'month',
  매출: 'revenue', revenue: 'revenue', 지출: 'expense', expense: 'expense', 회원수: 'members', '회원 수': 'members', members: 'members',
  목표: 'target', target: 'target', 메모: 'note', note: 'note', 근거: 'note',
};
const num = (s: string) => (s === '' ? null : Number(s.replace(/[,원\s]/g, '')));

/**
 * CSV 가져오기: 머리글 현장,월,매출,지출[,회원수,목표,메모]. 현장은 조직 이름과 정확히 일치해야 한다.
 * 오류가 하나라도 있으면 아무것도 저장하지 않고 줄 번호와 이유를 돌려준다. dryRun 이면 검사만.
 */
export async function importRevenueCsv(u: SessionUser, csv: string, fileName: string | null, dryRun: boolean, ip: string | null) {
  const sql = db();
  await requireRevenue(u, sql);
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw badRequest('머리글과 한 줄 이상의 자료가 필요합니다');
  const cols = splitCsvLine(lines[0]).map((h) => HEAD[h.replace(/\s*\(.*\)$/, '')] ?? HEAD[h] ?? '');
  for (const need of ['unit', 'month', 'revenue']) if (!cols.includes(need)) throw badRequest(`머리글에 ${({ unit: '현장', month: '월', revenue: '매출' } as Record<string, string>)[need]} 칸이 없습니다`);
  const units = await sql<{ id: string; name: string }[]>`select id, name from org_units`;
  const byName = new Map(units.map((x) => [x.name.trim(), x.id]));
  const rows: RevenueInput[] = []; const errors: { line: number; message: string }[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = splitCsvLine(lines[li]);
    const rec: Record<string, string> = {};
    cols.forEach((c, i) => { if (c) rec[c] = cells[i] ?? ''; });
    const unitId = byName.get(rec.unit ?? '');
    if (!unitId) { errors.push({ line: li + 1, message: `현장 '${rec.unit ?? ''}' 을(를) 찾을 수 없습니다` }); continue; }
    const m = (rec.month ?? '').replace(/[./]/g, '-').replace(/^(\d{4})-(\d)$/, '$1-0$2').slice(0, 7);
    const p = revenueInput.safeParse({ orgUnitId: unitId, month: m, revenue: num(rec.revenue ?? '') ?? undefined, expense: num(rec.expense ?? '') ?? 0,
      members: rec.members !== undefined ? num(rec.members) : null, target: rec.target !== undefined ? num(rec.target) : null, note: rec.note || null });
    if (!p.success) { errors.push({ line: li + 1, message: p.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join(', ') }); continue; }
    rows.push(p.data);
  }
  if (errors.length || dryRun) return { ok: !errors.length, count: rows.length, errors, preview: rows.slice(0, 50) };
  await sql.begin(async (tx) => { for (const r of rows) await upsert(tx as unknown as Sql, u, r, 'csv', fileName); });
  await audit(sql, u.id, 'revenue.import', null, null, { count: rows.length, file: fileName }, ip);
  return { ok: true, count: rows.length, errors: [] };
}
