// 212차 #612(대표 결정 10/25 19:00 "매주 진행"): 영업 '준공·입주 시설'의 미확인 값 후속조사.
// ① 원천 다시 읽기 — K-apt 단지 기본정보를 주 1회 다시 읽어 빈 관리사무소 전화·부대시설·세대수를 채운다(collectors/kaptComplexes '빈 칸 다시 확인').
// ② 원천에 없는 값(현 위탁사·계약만료일·관리사무소 번호) — 월요일(KST) 08시 뒤 첫 정기 실행이 회사마다 '[후속조사] 시설 n곳 — 운영 상태·계약기간 확인(전화)'
//    업무 하나(큰 단지부터 n곳, 마감 7일, 담당 = 영업 담당 규칙(시설) → 없으면 대표·관리자). 묶인 시설은 sales_research 에 한 줄씩.
// ③ 카드는 '미확인 · 조사 예정 날짜(담당)', 업무 [완료] 때 곳마다 값을 적는 창 → 카드·계약만료·재입찰 탭이 읽음(전환 뒤면 회사 진행 기록에도).
import { z } from 'zod';
import { db, type Sql } from '../db';
import { isAdmin, loadTaskForUser } from '../access';
import { assertSpace } from '../spaces';
import { badRequest, forbidden, notFound } from '../errors';
import { audit } from '../log';
import { notify } from '../notifications';
import { tenantOf, type SessionUser } from '../types';
import { weekMonday } from './support';

const ymd = (d: Date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const addDays = (day: string, n: number) => ymd(new Date(Date.parse(`${day}T12:00:00+09:00`) + n * 864e5));
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
/** 한 주에 묶는 시설 수(SALES_RESEARCH_MAX, 기본 10) · 업무 마감 7일 · 조사한 시설(값 적음·확인 못함)은 12주 뒤 다시 후보 */
export const RESEARCH_MAX = () => Math.max(1, Math.min(50, Number(process.env.SALES_RESEARCH_MAX) || 10));
export const RESEARCH_DUE_DAYS = 7;
const AGAIN_DAYS = 84;
export type Missing = 'operator' | 'contract' | 'phone';
/** #758(대표 10/28): mode = 운영 방식(직영·위탁·미개관) · firstPick = 미개관이면 첫 운영사 선정 예정 시기(자유 글) */
export const RESEARCH_MODES = ['직영', '위탁', '미개관'] as const;
export type ResearchResult = { operator?: string | null; contractEnd?: string | null; phone?: string | null; note?: string | null; mode?: (typeof RESEARCH_MODES)[number] | null; firstPick?: string | null };
export type ResearchState = { id: number; week: string; status: 'open' | 'done' | 'none'; due: string | null; taskId: string | null; assignee: string | null; doneAt: string | null; missing: Missing[];
  /** 지금까지 적은 값(최근 것 먼저 — 칸마다) */ result: ResearchResult };

/** 시설 하나의 빈 값 — 화면(허브 카드)과 같은 규칙: 현 위탁사(진행 기록 → 원천 칸) · 계약만료일(진행 기록) · 관리사무소 전화(원천) */
export const missingOf = (x: { operator?: unknown; contractEnd?: unknown; phone?: unknown }): Missing[] =>
  ([!x.operator && 'operator', !x.contractEnd && 'contract', !x.phone && 'phone'].filter(Boolean) as Missing[]);

/**
 * 회사의 시설별 후속조사 상태(가장 최근 묶음 기준). 묶음 업무가 완료·삭제됐는데 값을 안 적은 곳은 '확인 못함'(그 업무 완료 시각).
 * 적은 값은 묶음마다 칸별로 최근 것을 합친다.
 */
export async function researchState(sql: Sql, t: string): Promise<Map<string, ResearchState>> {
  const rows = await sql<{ id: number; src_id: string; week: string; status: string; result: ResearchResult; missing: Missing[]; done_at: Date | null; task_id: string | null;
    task_status: string | null; deleted: boolean | null; completed_at: Date | null; due: string | null; assignee: string | null }[]>`
    select r.id, r.src_id, r.week::text as week, r.status, r.result, r.missing, r.done_at, r.task_id, tk.status as task_status, tk.deleted_at is not null as deleted, tk.completed_at,
      tk.due_date::text as due, a.name as assignee
    from sales_research r left join tasks tk on tk.id = r.task_id left join users a on a.id = tk.assignee_id
    where r.tenant = ${t} and r.kind = 'facility' order by r.src_id, r.week desc, r.id desc`;
  const out = new Map<string, ResearchState>();
  for (const r of rows) {
    const cur = out.get(r.src_id);
    if (cur) { for (const k of ['operator', 'contractEnd', 'phone', 'note', 'mode', 'firstPick'] as const) if (!cur.result[k] && r.result?.[k]) (cur.result as Record<string, unknown>)[k] = r.result[k]; continue; }
    const closed = r.status === 'open' && (!r.task_id || r.deleted || r.task_status === 'done');
    const doneAt = r.done_at ?? (closed ? r.completed_at ?? null : null);
    out.set(r.src_id, { id: r.id, week: r.week, status: closed ? 'none' : (r.status as ResearchState['status']), due: r.due, taskId: r.deleted ? null : r.task_id, assignee: r.assignee,
      doneAt: doneAt ? new Date(doneAt).toISOString() : null, missing: r.missing ?? [], result: { ...(r.result ?? {}) } });
  }
  return out;
}

/** 회사 관리자(대표 → 관리자 순) 한 명을 세션 없이 실행 주체로 — 업무를 만든 사람·요청자 */
async function adminActor(sql: Sql, t: string): Promise<SessionUser | null> {
  const [a] = await sql<{ id: string }[]>`select id from users where tenant = ${t} and status = 'active' and role in ('owner', 'admin') and not is_demo order by (role = 'owner') desc, created_at limit 1`;
  if (!a) return null;
  return (await import('../mktStudio')).actorFor(a.id).catch(() => null);
}

type FacilityItem = { id: string; name: string; region?: string | null; households?: unknown; date?: string | null; phone?: string | null; operator?: string | null; contractEnd?: string | null; leadId?: string | null; handoff?: boolean; notices?: number };
const nameKey = (v: unknown) => String(v ?? '').replace(/\s+/g, '');
/** #758(대표 10/28 '위 시설들은 커뮤니티 입찰이 올라온 곳이 맞는지?'): 단지(시설) 이름별 관련 공고 수 — 시설명(없으면 발주처) 띄어쓰기 무시, 같은 공고 두 줄(원본 복사·워크인 수집)은 한 번 */
export async function relatedNoticeCounts(sql: Sql) {
  const rows = await sql<{ k: string; n: number }[]>`select regexp_replace(coalesce(nullif(row->>'facility_name', ''), row->>'issuer', ''), '[[:space:]]+', '', 'g') as k,
      count(distinct coalesce(row->>'source_type', '') || '|' || coalesce(row->>'source_external_id', src_id))::int as n
    from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and not gone and coalesce(row->>'related', 'false') = 'true' group by 1`;
  return new Map(rows.filter((r) => r.k).map((r) => [r.k, r.n]));
}
export const noticeCountOf = (m: Map<string, number>, name: unknown) => m.get(nameKey(name)) ?? 0;
/**
 * 회사 하나의 이번 주 후속조사 묶음. 허브 '준공·입주 시설' 기본 목록(보관함·리드로 넘긴 곳 빼고, 큰 단지 먼저)에서 빈 값이 있는 곳 중
 * 조사 예정(지난 묶음 업무가 아직 열림)·최근 12주 안에 조사한 곳을 빼고 n곳 → 업무 하나 + 담당 알림 한 번. 주마다 한 번(force = 관리자 [지금 만들기]: 이번 주 묶음이 없을 때만)
 */
export async function researchWeekly(t: string, opt: { now?: Date; actor?: SessionUser } = {}) {
  const sql = db(); const today = ymd(opt.now ?? new Date()); const week = weekMonday(today);
  const [exists] = await sql<{ task_id: string | null }[]>`select task_id from sales_research_weekly where tenant = ${t} and week = ${week}::date`;
  if (exists) return { skipped: 'done' as const, week, taskId: exists.task_id };
  const actor = opt.actor ?? (await adminActor(sql, t));
  if (!actor) return { skipped: 'no_admin' as const, week };
  const { hubTabsOn } = await import('./hubTabs'); const { salesBidsOn, salesTerms } = await import('./options');
  if (!(await hubTabsOn(t, await salesBidsOn(t))).includes('facilities')) return { skipped: 'no_facilities' as const, week };
  const v = (await (await import('./srcViews')).salesView(actor, 'hub', { tab: 'facilities' })) as unknown as { items: FacilityItem[] };
  const state = await researchState(sql, t); const again = addDays(today, -AGAIN_DAYS);
  const picked = v.items.filter((x) => !x.leadId && !x.handoff).map((x) => ({ x, missing: missingOf(x) })).filter(({ x, missing }) => {
    if (!missing.length) return false;
    const s = state.get(String(x.id));
    if (!s) return true;
    if (s.status === 'open') return false;
    return !(s.doneAt && ymd(new Date(s.doneAt)) > again);
  }).slice(0, RESEARCH_MAX());
  if (!picked.length) {
    await sql`insert into sales_research_weekly (tenant, week, items) values (${t}, ${week}::date, 0) on conflict do nothing`;
    return { week, items: 0, taskId: null };
  }
  const terms = await salesTerms(t);
  const label: Record<Missing, string> = { operator: `운영 방식(직영·위탁·미개관)·${terms.operator}`, contract: '계약 만료일(위탁이면)', phone: `${terms.office} 번호` };
  const counts = await relatedNoticeCounts(sql).catch(() => new Map<string, number>());
  const rule = await (await import('../assignees')).resolveAssignee(sql, t, 'sales_source', 'facility').catch(() => null);
  const assigneeId = rule?.userId ?? actor.id; const due = addDays(today, RESEARCH_DUE_DAYS);
  const hh = (n: unknown) => (Number(n) > 0 ? `${Number(n).toLocaleString('ko-KR')}세대` : null);
  const lines = picked.map(({ x, missing }, i) => `${i + 1}. ${x.name}${[x.region, hh(x.households), x.date && `준공 ${x.date}`].filter(Boolean).length ? ` (${[x.region, hh(x.households), x.date && `준공 ${x.date}`].filter(Boolean).join(' · ')})` : ''}`
    + ` — 확인할 것: ${missing.map((m) => label[m]).join(' · ')}${x.phone ? ` · ${terms.office} ${x.phone}` : ''}${noticeCountOf(counts, x.name) ? ` · 이 ${terms.kind.facility} 관련 공고 ${noticeCountOf(counts, x.name)}건` : ''}`
    + `\n   /s/sales/hub?tab=facilities&q=${encodeURIComponent(x.name)}`);
  // #758(대표 10/28 '어떤 계약인지? 커뮤니티 입찰이 올라온 곳이 맞는지?'): 무엇을 확인하는지(운영 방식 — 직영·위탁·미개관) · 고른 기준(입찰 공고가 아니라 큰 단지 순)을 업무에 적음
  const title = `[후속조사] ${terms.kind.facility} ${picked.length}곳 — ${terms.opCheck} 확인(전화)`;
  const description = `이번 주 후속조사 ${terms.facilitiesTab} ${picked.length}곳입니다 — ${terms.opCheck}을(를) 전화로 확인해 주세요: 직영 · 위탁 · 미개관.\n`
    + `위탁이면 ${terms.operator}·계약 만료일, 미개관이면 첫 운영사 선정 예정 시기를 적습니다. 입찰 공고가 난 곳이 아니라 ${terms.facilitiesTab} 중 빈 값이 있는 큰 곳부터 고른 목록입니다(관련 공고가 있는 곳은 줄 끝에 건수).\n`
    + `업무를 [완료]하면 곳마다 적는 창이 뜹니다(모르면 비워 두면 '확인 못함' — 12주 뒤 다시 묶음에 들어옵니다).\n\n${lines.join('\n')}`;
  const { createTask } = await import('../tasks');
  const task = await createTask(actor, { title, description, space: 'sales', assigneeId, requestedById: actor.id, dueDate: due, approvalRequired: false, tags: ['영업', '후속조사'] }, { quiet: true, skipQuota: true });
  await sql`update tasks set sales_ref = ${sql.json({ kind: 'research', id: `facility:${week}`, name: `${terms.facilitiesTab} 후속조사` })}, assigned_by_rule = ${rule?.ruleId ?? null} where id = ${task.id}`;
  for (const { x, missing } of picked) {
    await sql`insert into sales_research (tenant, kind, src_id, name, week, task_id, missing) values (${t}, 'facility', ${String(x.id)}, ${x.name.slice(0, 300)}, ${week}::date, ${task.id}, ${missing})
      on conflict (tenant, kind, src_id, week) do update set task_id = excluded.task_id, missing = excluded.missing, status = 'open', updated_at = now()`;
  }
  await sql`insert into sales_research_weekly (tenant, week, task_id, items) values (${t}, ${week}::date, ${task.id}, ${picked.length})
    on conflict (tenant, week) do update set task_id = excluded.task_id, items = excluded.items`;
  await notify(sql, { userIds: [assigneeId], type: 'sales_research_weekly', space: 'sales', title: `이번 주 후속조사 ${terms.kind.facility} ${picked.length}곳`,
    body: `${picked.slice(0, 3).map(({ x }) => x.name.slice(0, 30)).join(' · ')}${picked.length > 3 ? ` 외 ${picked.length - 3}곳` : ''} — ${md(due)}까지 ${terms.opCheck} 확인`,
    link: `/tasks/${task.id}`, entityType: 'task', entityId: task.id, dedupeKey: `sales_research:${t}:${week}`, push: true } as never).catch(() => []);
  return { week, items: picked.length, taskId: task.id, assigneeId, due };
}

/** 정기 실행: 월요일(KST) 08시 이후 첫 tick 에 영업 공간을 켠 회사마다 한 번(SALES_RESEARCH_WEEKLY = '요일-시' 기본 '1-8', 'any' = 늘, 'off' = 안 함) */
export async function researchWeeklyTick(opt: { now?: Date } = {}) {
  const now = opt.now ?? new Date(); const gate = process.env.SALES_RESEARCH_WEEKLY ?? '1-8';
  if (gate === 'off') return { skipped: 'off' };
  if (gate !== 'any') {
    const [dow, hour] = gate.split('-').map(Number);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(now);
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday')?.value ?? ''); const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
    if (wd !== dow || h < hour) return { skipped: 'time' };
  }
  const sql = db(); const week = weekMonday(ymd(now));
  const tenants = await sql<{ id: string }[]>`select t.id from tenants t where 'sales' = any(t.spaces) and t.status = 'active'
    and not exists (select 1 from sales_research_weekly w where w.tenant = t.id and w.week = ${week}::date) order by t.id limit 20`;
  const out: Record<string, unknown> = {};
  for (const t of tenants) out[t.id] = await researchWeekly(t.id, { now }).catch((e) => ({ error: String((e as Error)?.message ?? e).slice(0, 120) }));
  return { week, tenants: tenants.length, out };
}

/** 허브 '준공·입주 시설' 머리 줄: 이번 주 묶음(업무·담당·마감·조사한 수) — 관리자는 [지금 만들기] */
export async function researchOverview(u: SessionUser) {
  await assertSpace(u, 'sales');
  const sql = db(); const t = tenantOf(u); const week = weekMonday(ymd());
  const [w] = await sql<{ week: string; task_id: string | null; items: number; due: string | null; assignee: string | null; task_status: string | null; deleted: boolean | null }[]>`
    select w.week::text as week, w.task_id, w.items, tk.due_date::text as due, a.name as assignee, tk.status as task_status, tk.deleted_at is not null as deleted
    from sales_research_weekly w left join tasks tk on tk.id = w.task_id left join users a on a.id = tk.assignee_id where w.tenant = ${t} order by w.week desc limit 1`;
  const [n] = w?.task_id ? await sql<{ done: number; none: number }[]>`select count(*) filter (where status = 'done')::int as done, count(*) filter (where status = 'none')::int as none from sales_research where task_id = ${w.task_id}` : [{ done: 0, none: 0 }];
  const gate = process.env.SALES_RESEARCH_WEEKLY ?? '1-8';
  return { latest: w ? { week: w.week, thisWeek: w.week === week, taskId: w.deleted ? null : w.task_id, items: w.items, due: w.due, assignee: w.assignee, taskDone: w.task_status === 'done', done: n.done, none: n.none } : null,
    max: RESEARCH_MAX(), auto: gate !== 'off', canRun: isAdmin(u) && w?.week !== week };
}
/** [이번 주 후속조사 지금 만들기] — 관리자. 이번 주 묶음이 이미 있으면 그것을 돌려줌 */
export async function runResearchManual(u: SessionUser) {
  await assertSpace(u, 'sales');
  if (!isAdmin(u)) throw forbidden('후속조사 묶음은 관리자만 만들 수 있습니다');
  return researchWeekly(tenantOf(u), { actor: u });
}

/** 업무 [완료] 창: 이 업무에 묶인 시설과 지금 값(적은 값 먼저) */
export async function researchForTask(u: SessionUser, taskId: string) {
  await assertSpace(u, 'sales');
  await loadTaskForUser(u, taskId);
  const sql = db(); const t = tenantOf(u);
  const items = await sql<{ id: number; src_id: string; name: string; missing: Missing[]; status: string; result: ResearchResult }[]>`
    select id, src_id, name, missing, status, result from sales_research where tenant = ${t} and task_id = ${taskId} order by id`;
  if (!items.length) return { items: [] };
  const src = new Map((await sql<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where scope = 'global' and tbl = 'operating_facility_prospects' and src_id = any(${items.map((x) => x.src_id)}::text[])`).map((r) => [r.src_id, r.row]));
  const terms = await (await import('./options')).salesTerms(t);
  const counts = await relatedNoticeCounts(sql).catch(() => new Map<string, number>());
  return { terms: { operator: terms.operator, office: terms.office, opCheck: terms.opCheck, facility: terms.kind.facility },
    items: items.map((x) => { const r = src.get(x.src_id) ?? {};
      return { id: x.id, srcId: x.src_id, name: x.name, region: r.region ?? null, households: r.household_count ?? null, missing: x.missing, status: x.status, notices: noticeCountOf(counts, x.name),
        phone: r.office_phone ?? r.management_phone ?? r.phone ?? null, operator: communityOperator(x.result?.operator ?? r.current_operator, r.management_company), mgmt: r.management_company ?? null,
        // 246차 #775: 공개 자료로 미리 아는 것 — 입주·사용승인(준공) 시기
        moveIn: String(r.move_in_date ?? r.expected_move_in_date ?? '').slice(0, 10) || null, approval: String(r.approval_date ?? r.completion_date ?? r.expected_completion_date ?? '').slice(0, 10) || null,
        result: x.result ?? {} }; }) };
}

/** 242차 #760(대표 10/28 '위탁사가 관리주체 즉 관리사무소를 뜻하는건데? db에서 위탁이라는 단어를 전부 커뮤니티 위탁으로 착각?'): K-apt 주택관리업자(관리회사)는
 *  커뮤니티 운영사가 아님 — 운영사 칸에 관리회사 이름을 쓰지 않고, 예전에 같은 이름으로 채운 값도 운영사로 보지 않음(관리회사는 따로 '관리회사(주택관리업자)') */
const coName = (s: unknown) => String(s ?? '').replace(/\(주\)|㈜|주식회사|\s+/g, '').toLowerCase();
export function communityOperator(op: unknown, mgmt: unknown): string | null {
  const o = op == null ? '' : String(op).trim();
  if (!o) return null;
  return mgmt && coName(o) === coName(mgmt) ? null : o;
}
const ymdRe = /^\d{4}-\d{2}-\d{2}$/;
export const researchInput = z.object({ operator: z.string().trim().max(100).nullable().optional(), contractEnd: z.string().regex(ymdRe).nullable().optional().or(z.literal('').transform(() => null)),
  phone: z.string().trim().max(40).regex(/^[0-9+\-() ]*$/, '전화번호는 숫자와 - 만 적어 주세요').nullable().optional(), note: z.string().trim().max(500).nullable().optional(),
  mode: z.enum(RESEARCH_MODES).nullable().optional(), firstPick: z.string().trim().max(40).nullable().optional() });
/**
 * 시설 하나의 조사 결과 저장 — 값이 하나라도 있으면 '조사함', 모두 비면 '확인 못함'. 업무를 볼 수 있는 사람만(못 보면 404).
 * 전환 뒤(쓰기 열림)에는 현 위탁사·계약만료일을 회사 진행 기록에도 — 계약만료·재입찰 탭·시설 보관함과 같은 값
 */
export async function saveResearch(u: SessionUser, id: number, i: z.infer<typeof researchInput>) {
  await assertSpace(u, 'sales');
  const sql = db(); const t = tenantOf(u);
  if (!Number.isInteger(id) || id <= 0) throw notFound('후속조사 건을 찾을 수 없습니다');
  const [r] = await sql<{ id: number; src_id: string; name: string; task_id: string | null }[]>`select id, src_id, name, task_id from sales_research where id = ${id} and tenant = ${t}`;
  if (!r) throw notFound('후속조사 건을 찾을 수 없습니다');
  if (r.task_id) await loadTaskForUser(u, r.task_id); else if (!isAdmin(u)) throw notFound('후속조사 건을 찾을 수 없습니다');
  const result: ResearchResult = { operator: i.operator?.trim() || null, contractEnd: i.contractEnd || null, phone: i.phone?.trim() || null, note: i.note?.trim() || null,
    mode: i.mode ?? null, firstPick: i.mode === '미개관' ? i.firstPick?.trim() || null : null }; // #758 첫 운영사 선정 예정 시기는 미개관일 때만
  if (result.contractEnd && Number.isNaN(Date.parse(`${result.contractEnd}T00:00:00Z`))) throw badRequest('계약만료일이 올바르지 않습니다');
  const status = result.operator || result.contractEnd || result.phone || result.mode ? 'done' : 'none';
  await sql`update sales_research set status = ${status}, result = ${sql.json(result as never)}, done_by = ${u.id}, done_at = now(), updated_at = now() where id = ${r.id}`;
  let saved = false;
  if (result.operator || result.contractEnd) {
    const { writesOpen } = await import('./cutover');
    if (await writesOpen(t)) {
      const { saveWork } = await import('./work');
      saved = await saveWork(u, { kind: 'facility', id: r.src_id, ...(result.operator ? { operator: result.operator } : {}), ...(result.contractEnd ? { contractEnd: result.contractEnd } : {}) }).then(() => true).catch(() => false);
    }
  }
  await audit(sql, u.id, 'sales_research.save', 'facility', r.src_id, { status, fields: Object.entries(result).filter(([, v]) => v).map(([k]) => k) }).catch(() => {});
  return { ok: true, status, result, progress: saved };
}
