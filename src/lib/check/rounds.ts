/**
 * 점검 2단계 — 점검하기 · 보완 흐름 (docs/check-feature-design.md 3-3 · 11절)
 * - 점검 코스: 공간 유형을 도는 순서. 항목은 그때의 가이드에서(그 공간 유형에 걸린 사용 중 항목 + 그 곳에 적용되는 것)
 * - 점검 1회(round): 항목마다 양호(ok) · 보완 필요(fix) · 해당 없음(na) + 메모 + 사진
 * - 끝내기: 보완 필요 건마다 보완 요청 = **업무 1건**(사진 증빙 1장, 정중한 요청형 글) + 외부 연락 기록 + 같은 항목 N회 연속이면 개선 과제
 * - 보완 확인: 업무의 검토 기능에 기대지 않는다(대표 11/18 "검토는 완료의 조건이 아니다"). 담당자가 업무를 [완료]하면 보완 요청이 '확인 대기'로 보이고,
 *   점검자가 여기서 [양호 확인](닫힘) 또는 [다시 보완](같은 담당자에게 새 업무 · 회차 +1 — 업무의 상태는 담당자만 바꾸는 규칙이라 끝낸 업무를 다시 열지 않는다).
 * 권한: 메뉴 권한 '점검하기·보완 확인'(check_run). 볼 수 있는 조직(accessibleUnitIds) 안에서만. 다른 회사·범위 밖은 없는 것처럼(404).
 */
import { z } from 'zod';
import { db, type Sql } from '../db';
import { accessibleUnitIds } from '../access';
import { badRequest, conflict, notFound } from '../errors';
import { requireMenu } from '../menuPerms';
import { notify } from '../notifications';
import { addDays, todaySeoul } from '../time';
import { tenantOf, type SessionUser } from '../types';
import { METHODS } from './guide';
import { itemPhotos } from './photos';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const VERDICTS = { ok: '양호', fix: '보완 필요', na: '해당 없음' } as const;
export type Verdict = keyof typeof VERDICTS;
export const ROUND_KINDS = { regular: '정기', sample: '표본', adhoc: '수시' } as const;
/** 같은 항목·같은 곳이 이만큼 연속 보완 필요면 개선 과제(회사 설정으로 바꿀 수 있게 한곳에) */
export const IMPROVE_STREAK = 3;
export const FOLLOWUP_TAG = '점검 보완';
export const IMPROVE_TAG = '개선 과제';

async function myUnits(u: SessionUser, sql: Sql) { return accessibleUnitIds(u, sql); }
async function assertUnit(u: SessionUser, unitId: string, sql: Sql) {
  const [o] = await sql`select 1 from org_units where id = ${unitId} and tenant = ${tenantOf(u)}`;
  const mine = await myUnits(u, sql);
  if (!o || (mine !== null && !mine.includes(unitId))) throw notFound();
}

// ---------------- 점검 코스 ----------------
export const courseInput = z.object({
  name: z.string().trim().min(1).max(60),
  orgUnitId: uuid.nullable().optional(),
  placeTypeIds: z.array(uuid).max(40),
  includeGeneral: z.boolean().optional(),
  active: z.boolean().optional(),
});
type CourseRow = { id: string; name: string; org_unit_id: string | null; steps: { placeTypeId: string }[]; include_general: boolean; active: boolean };
/** 공통 기본 템플릿을 받은 회사에 코스가 하나도 없으면 '기본 매장 점검'(출입구·로비 → 고객 이용 공간 → 화장실 → 직원 공간 → 창고)을 한 번 만든다 */
async function ensureBasicCourse(tenant: string, byUser: string | null, sql: Sql) {
  if ((await sql`select 1 from chk_installs where tenant = ${tenant} and tpl = 'course:basic'`).length) return;
  const order = ['p:entrance', 'p:customer', 'p:restroom', 'p:staff', 'p:storage'];
  const rows = await sql<{ id: string; tpl_key: string }[]>`select id, tpl_key from chk_place_types where tenant = ${tenant} and tpl_key = any(${order}) and active`;
  const steps = order.map((k) => rows.find((r) => r.tpl_key === k)?.id).filter((x): x is string => !!x).map((placeTypeId) => ({ placeTypeId }));
  await sql`insert into chk_installs (tenant, tpl, by_user) values (${tenant}, 'course:basic', ${byUser}) on conflict do nothing`;
  if (!steps.length) return;
  await sql`insert into chk_courses (tenant, name, steps, include_general, tpl_key, created_by) values (${tenant}, '기본 매장 점검', ${sql.json(steps as never)}, true, 'course:basic', ${byUser})
    on conflict (tenant, tpl_key) where tpl_key is not null do nothing`;
}
export async function listCourses(u: SessionUser, opt: { all?: boolean } = {}) {
  await requireMenu(u, 'check_run', 'use');
  const sql = db(); const t = tenantOf(u);
  await (await import('./install')).ensureCheckTemplates(t, u.id);
  await ensureBasicCourse(t, u.id, sql);
  const mine = await myUnits(u, sql);
  const rows = await sql<CourseRow[]>`select id, name, org_unit_id, steps, include_general, active from chk_courses where tenant = ${t} ${opt.all ? sql`` : sql`and active`}
    ${mine === null ? sql`` : sql`and (org_unit_id is null or org_unit_id = any(${mine}::uuid[]))`} order by (org_unit_id is null) desc, name`;
  return { courses: rows.map((c) => ({ id: c.id, name: c.name, orgUnitId: c.org_unit_id, placeTypeIds: c.steps.map((s) => s.placeTypeId), includeGeneral: c.include_general, active: c.active })) };
}
async function assertPlaceTypes(t: string, ids: string[], sql: Sql) {
  if (!ids.length) return;
  const rows = await sql`select id from chk_place_types where tenant = ${t} and id = any(${ids}::uuid[])`;
  if (rows.length !== new Set(ids).size) throw notFound();
}
/** 코스 만들기·고치기 — 가이드 편집 권한(무엇을 어떤 순서로 볼지는 가이드의 일) */
export async function saveCourse(u: SessionUser, id: string | null, i: z.infer<typeof courseInput>) {
  await requireMenu(u, 'check_guide', 'edit');
  const sql = db(); const t = tenantOf(u);
  if (i.orgUnitId) await assertUnit(u, i.orgUnitId, sql);
  await assertPlaceTypes(t, i.placeTypeIds, sql);
  const steps = [...new Set(i.placeTypeIds)].map((placeTypeId) => ({ placeTypeId }));
  if (!id) {
    const [r] = await sql<{ id: string }[]>`insert into chk_courses (tenant, name, org_unit_id, steps, include_general, active, created_by)
      values (${t}, ${i.name}, ${i.orgUnitId ?? null}, ${sql.json(steps as never)}, ${i.includeGeneral ?? true}, ${i.active ?? true}, ${u.id}) returning id`;
    return { id: r.id };
  }
  const [r] = await sql<{ id: string }[]>`update chk_courses set name = ${i.name}, org_unit_id = ${i.orgUnitId === undefined ? sql`org_unit_id` : i.orgUnitId}, steps = ${sql.json(steps as never)},
      include_general = ${i.includeGeneral === undefined ? sql`include_general` : i.includeGeneral}, active = ${i.active === undefined ? sql`active` : i.active}, updated_at = now()
    where id = ${id} and tenant = ${t} returning id`;
  if (!r) throw notFound();
  return { id: r.id };
}

// ---------------- 점검 1회 ----------------
export const roundInput = z.object({ orgUnitId: uuid, courseId: uuid.nullable().optional(), kind: z.enum(['regular', 'sample', 'adhoc']).optional(), note: z.string().trim().max(300).optional() });
type RoundRow = { id: string; org_unit_id: string; org_unit_name: string; checker_id: string | null; checker_name: string | null; course_id: string | null; course_name: string | null; kind: keyof typeof ROUND_KINDS; note: string | null; started_at: Date; ended_at: Date | null };
async function loadRound(u: SessionUser, id: string, sql: Sql): Promise<RoundRow> {
  const [r] = await sql<RoundRow[]>`select r.id, r.org_unit_id, o.name as org_unit_name, r.checker_id, us.name as checker_name, r.course_id, r.course_name, r.kind, r.note, r.started_at, r.ended_at
    from chk_rounds r join org_units o on o.id = r.org_unit_id left join users us on us.id = r.checker_id where r.id = ${id} and r.tenant = ${tenantOf(u)}`;
  const mine = await myUnits(u, sql);
  if (!r || (mine !== null && !mine.includes(r.org_unit_id))) throw notFound();
  return r;
}
/** 점검 시작 — 코스를 고르면 정기(또는 표본), 코스 없이 시작하면 수시 점검 */
export async function startRound(u: SessionUser, i: z.infer<typeof roundInput>) {
  await requireMenu(u, 'check_run', 'use');
  const sql = db(); const t = tenantOf(u);
  await assertUnit(u, i.orgUnitId, sql);
  let courseName: string | null = null;
  if (i.courseId) {
    const [c] = await sql<{ name: string; org_unit_id: string | null }[]>`select name, org_unit_id from chk_courses where id = ${i.courseId} and tenant = ${t} and active`;
    if (!c || (c.org_unit_id && c.org_unit_id !== i.orgUnitId)) throw notFound();
    courseName = c.name;
  }
  const kind = i.courseId ? (i.kind === 'sample' ? 'sample' : 'regular') : 'adhoc';
  const [r] = await sql<{ id: string }[]>`insert into chk_rounds (tenant, org_unit_id, checker_id, course_id, course_name, kind, note)
    values (${t}, ${i.orgUnitId}, ${u.id}, ${i.courseId ?? null}, ${courseName}, ${kind}, ${i.note ?? null}) returning id`;
  return { id: r.id, kind };
}
type GuideItem = { id: string; title: string; category_name: string | null; place_type_ids: string[]; method: keyof typeof METHODS; method_note: string | null; pass_criteria: string; blind_spots: string[];
  fix_action: { note?: string; role?: string; dueDays?: number; external?: boolean }; version: number };
const ITEM_COLS = (sql: Sql) => sql`i.id, i.title, c.name as category_name, i.place_type_ids, i.method, i.method_note, i.pass_criteria, i.blind_spots, i.fix_action, i.version`;
/** 이 곳에 적용되는 사용 중 항목 */
async function unitItems(t: string, unitId: string, sql: Sql) {
  return sql<GuideItem[]>`select ${ITEM_COLS(sql)} from chk_items i left join chk_categories c on c.id = i.category_id
    where i.tenant = ${t} and i.active and (i.unit_scope = 'all' or ${unitId}::uuid = any(i.org_unit_ids)) order by c.sort nulls last, i.title`;
}
type ResultRow = { id: string; item_id: string; item_title: string; pass_criteria: string; place_type_id: string | null; verdict: Verdict; memo: string | null };
/** 점검 화면: 코스 순서대로(공간 유형마다 항목) + 지금까지 적은 결과. 수시 점검은 적은 결과만(항목은 찾아서 더함) */
export async function getRound(u: SessionUser, id: string) {
  await requireMenu(u, 'check_run', 'use');
  const sql = db(); const t = tenantOf(u);
  const r = await loadRound(u, id, sql);
  const results = await sql<ResultRow[]>`select id, item_id, item_title, pass_criteria, place_type_id, verdict, memo from chk_results where round_id = ${id} and tenant = ${t} order by created_at`;
  const items = await unitItems(t, r.org_unit_id, sql);
  const byId = new Map(items.map((x) => [x.id, x]));
  const ref = await itemPhotos(t, items.map((x) => x.id));
  const resPhotos = await sql<{ id: string; owner_id: string }[]>`select id, owner_id from chk_photos where tenant = ${t} and owner_kind = 'result' and owner_id = any(${results.map((x) => x.id)}::uuid[]) and upload_status = 'ready' order by created_at`;
  const types = await sql<{ id: string; name: string }[]>`select id, name from chk_place_types where tenant = ${t}`;
  const typeName = new Map(types.map((x) => [x.id, x.name]));
  const view = (it: GuideItem, placeTypeId: string | null) => {
    const res = results.find((x) => x.item_id === it.id && (x.place_type_id ?? null) === placeTypeId);
    return { id: it.id, title: it.title, categoryName: it.category_name, method: it.method, methodNote: it.method_note, passCriteria: it.pass_criteria, blindSpots: it.blind_spots,
      fixAction: it.fix_action, refPhotos: ref.get(it.id) ?? [], result: res ? { id: res.id, verdict: res.verdict, memo: res.memo, photos: resPhotos.filter((p) => p.owner_id === res.id).map((p) => ({ id: p.id })) } : null };
  };
  let steps: { placeTypeId: string | null; name: string; items: ReturnType<typeof view>[] }[] = [];
  if (r.course_id) {
    const [c] = await sql<CourseRow[]>`select id, name, org_unit_id, steps, include_general, active from chk_courses where id = ${r.course_id} and tenant = ${t}`;
    for (const s of c?.steps ?? []) {
      const its = items.filter((x) => x.place_type_ids.includes(s.placeTypeId));
      if (its.length) steps.push({ placeTypeId: s.placeTypeId, name: typeName.get(s.placeTypeId) ?? '', items: its.map((x) => view(x, s.placeTypeId)) });
    }
    if (c?.include_general ?? true) {
      const its = items.filter((x) => !x.place_type_ids.length);
      if (its.length) steps.push({ placeTypeId: null, name: '공간 없이 보는 항목', items: its.map((x) => view(x, null)) });
    }
  } else {
    // 수시 점검: 적은 것만 한 묶음으로
    const its = results.map((x) => byId.get(x.item_id) && view(byId.get(x.item_id)!, x.place_type_id ?? null)).filter((x): x is ReturnType<typeof view> => !!x);
    steps = [{ placeTypeId: null, name: ROUND_KINDS.adhoc + ' 점검', items: its }];
  }
  const count = { ok: 0, fix: 0, na: 0 }; for (const x of results) count[x.verdict]++;
  const total = r.course_id ? steps.reduce((n, s) => n + s.items.length, 0) : results.length;
  return { round: { id: r.id, orgUnitId: r.org_unit_id, orgUnitName: r.org_unit_name, checkerId: r.checker_id, checkerName: r.checker_name, courseName: r.course_name, kind: r.kind, kindLabel: ROUND_KINDS[r.kind], startedAt: r.started_at, endedAt: r.ended_at },
    steps, count, total, done: results.length, methods: METHODS, verdicts: VERDICTS };
}
/** 수시 점검에서 항목 찾기(이 곳에 적용되는 사용 중 항목) */
export async function roundItemSearch(u: SessionUser, id: string, q: string | null) {
  await requireMenu(u, 'check_run', 'use');
  const sql = db(); const t = tenantOf(u);
  const r = await loadRound(u, id, sql);
  const k = (q ?? '').trim().toLowerCase().slice(0, 60);
  const items = (await unitItems(t, r.org_unit_id, sql)).filter((x) => !k || x.title.toLowerCase().includes(k) || x.pass_criteria.toLowerCase().includes(k)).slice(0, 50);
  return { items: items.map((x) => ({ id: x.id, title: x.title, categoryName: x.category_name, passCriteria: x.pass_criteria })) };
}
export const resultInput = z.object({ itemId: uuid, placeTypeId: uuid.nullable().optional(), verdict: z.enum(['ok', 'fix', 'na']), memo: z.string().trim().max(1000).nullable().optional() });
/** 항목 하나의 결과 적기(다시 적으면 고침) — 점검이 끝나기 전까지, 점검자 본인만 */
export async function saveResult(u: SessionUser, roundId: string, i: z.infer<typeof resultInput>) {
  await requireMenu(u, 'check_run', 'use');
  const sql = db(); const t = tenantOf(u);
  const r = await loadRound(u, roundId, sql);
  if (r.ended_at) throw conflict('이미 끝낸 점검입니다');
  if (r.checker_id !== u.id) throw conflict('점검을 시작한 사람만 기록할 수 있습니다');
  const [it] = await sql<{ id: string; title: string; pass_criteria: string; version: number }[]>`select id, title, pass_criteria, version from chk_items
    where id = ${i.itemId} and tenant = ${t} and active and (unit_scope = 'all' or ${r.org_unit_id}::uuid = any(org_unit_ids))`;
  if (!it) throw notFound();
  if (i.placeTypeId) await assertPlaceTypes(t, [i.placeTypeId], sql);
  const pt = i.placeTypeId ?? null;
  const [cur] = await sql<{ id: string }[]>`select id from chk_results where round_id = ${roundId} and item_id = ${i.itemId} and place_type_id is not distinct from ${pt}`;
  if (cur) {
    await sql`update chk_results set verdict = ${i.verdict}, memo = ${i.memo ?? null}, updated_at = now() where id = ${cur.id}`;
    return { id: cur.id, verdict: i.verdict };
  }
  const [row] = await sql<{ id: string }[]>`insert into chk_results (tenant, round_id, item_id, item_version, item_title, pass_criteria, place_type_id, verdict, memo, by_user)
    values (${t}, ${roundId}, ${it.id}, ${it.version}, ${it.title}, ${it.pass_criteria}, ${pt}, ${i.verdict}, ${i.memo ?? null}, ${u.id}) returning id`;
  return { id: row.id, verdict: i.verdict };
}

// ---------------- 끝내기 → 보완 요청 ----------------
export const finishInput = z.object({
  followups: z.array(z.object({ resultId: uuid, assigneeId: uuid.nullable().optional(), dueDate: date.nullable().optional(), note: z.string().trim().max(500).optional(),
    external: z.object({ target: z.string().trim().min(1).max(100), replyDue: date.nullable().optional() }).nullable().optional() })).max(200).optional(),
});
/** 직원에게 가는 글 — "무엇을, 어디를, 언제까지" 중심의 정중한 요청형(지적·평가 말투 없음) */
export function followupText(o: { title: string; place: string | null; unit: string; pass: string; memo: string | null; note: string | null; fix: string | null; due: string | null; again?: string | null }) {
  return [
    `${o.unit}${o.place ? ` ${o.place}` : ''}의 "${o.title}"을(를) ${o.again ? '한 번 더 ' : ''}살펴봐 주세요.`,
    o.again ? `**다시 살펴볼 것**: ${o.again}` : null,
    o.due ? `**언제까지**: ${o.due}` : null,
    o.pass ? `**양호 기준**: ${o.pass}` : null,
    o.memo ? `**점검 때 본 것**: ${o.memo}` : null,
    o.fix ? `**이렇게 해 주세요**: ${o.fix}` : null,
    o.note ? `**덧붙임**: ${o.note}` : null,
    '',
    '조치한 뒤 사진 1장을 올리고 [완료]를 눌러 주세요. 점검자가 사진을 보고 확인합니다.',
  ].filter((x) => x !== null).join('\n');
}
/** 점검 끝내기: 보완 필요 건마다 보완 요청(업무) · 외부 연락 · 개선 과제. 한 번만 끝낼 수 있음 */
export async function finishRound(u: SessionUser, id: string, i: z.infer<typeof finishInput>) {
  await requireMenu(u, 'check_run', 'use');
  const sql = db(); const t = tenantOf(u);
  const r = await loadRound(u, id, sql);
  if (r.ended_at) throw conflict('이미 끝낸 점검입니다');
  if (r.checker_id !== u.id) throw conflict('점검을 시작한 사람만 끝낼 수 있습니다');
  const results = await sql<(ResultRow & { fix_action: GuideItem['fix_action']; place_type_name: string | null })[]>`select x.id, x.item_id, x.item_title, x.pass_criteria, x.place_type_id, x.verdict, x.memo, i.fix_action, pt.name as place_type_name
    from chk_results x join chk_items i on i.id = x.item_id left join chk_place_types pt on pt.id = x.place_type_id where x.round_id = ${id} and x.tenant = ${t} order by x.created_at`;
  if (!results.length) throw badRequest('기록한 항목이 없습니다 — 항목을 하나 이상 기록한 뒤 끝내 주세요');
  const fixes = results.filter((x) => x.verdict === 'fix');
  const spec = new Map((i.followups ?? []).map((f) => [f.resultId, f]));
  for (const f of i.followups ?? []) if (!fixes.some((x) => x.id === f.resultId)) throw badRequest('보완 필요로 기록한 항목만 보완 요청을 만들 수 있습니다');
  const today = todaySeoul();
  const { createTask } = await import('../tasks');
  const made: { resultId: string; followupId: string; taskId: string }[] = []; const improvements: { itemId: string; taskId: string }[] = [];
  for (const x of fixes) {
    const s = spec.get(x.id);
    let assignee = s?.assigneeId ?? null;
    if (assignee) { // 같은 회사의 활성 사용자만
      const [a] = await sql`select 1 from users where id = ${assignee} and tenant = ${t} and status = 'active'`;
      if (!a) throw badRequest('보완 요청 담당자를 다시 골라 주세요');
    }
    const due = s?.dueDate ?? addDays(today, Math.max(0, Number(x.fix_action?.dueDays ?? 3)));
    const text = followupText({ title: x.item_title, place: x.place_type_name, unit: r.org_unit_name, pass: x.pass_criteria, memo: x.memo, note: s?.note ?? null, fix: x.fix_action?.note ?? null, due });
    const task = await createTask(u, { title: `${x.item_title} 보완 요청`, description: text, orgUnitId: r.org_unit_id, assigneeId: assignee, dueDate: due, photoRequired: 1, tags: [FOLLOWUP_TAG] } as never, { quiet: false });
    const [fu] = await sql<{ id: string }[]>`insert into chk_followups (tenant, result_id, item_id, org_unit_id, task_id, assignee_id, requested_by, due_date, note)
      values (${t}, ${x.id}, ${x.item_id}, ${r.org_unit_id}, ${task.id}, ${assignee}, ${u.id}, ${due}, ${s?.note ?? null}) returning id`;
    made.push({ resultId: x.id, followupId: fu.id, taskId: task.id });
    const ext = s?.external ?? (x.fix_action?.external ? null : undefined);
    if (ext) await sql`insert into chk_external (tenant, followup_id, target, reply_due, by_user) values (${t}, ${fu.id}, ${ext.target}, ${ext.replyDue ?? addDays(today, 7)}, ${u.id})`;
    // 개선 과제: 이 항목·이 곳의 지난 결과(해당 없음 제외)가 이번까지 N회 연속 보완 필요
    const prev = await sql<{ verdict: Verdict }[]>`select x2.verdict from chk_results x2 join chk_rounds r2 on r2.id = x2.round_id
      where x2.tenant = ${t} and x2.item_id = ${x.item_id} and r2.org_unit_id = ${r.org_unit_id} and r2.ended_at is not null and x2.verdict <> 'na' order by r2.ended_at desc limit ${IMPROVE_STREAK - 1}`;
    if (prev.length === IMPROVE_STREAK - 1 && prev.every((p) => p.verdict === 'fix') && !(await sql`select 1 from chk_improvements where tenant = ${t} and item_id = ${x.item_id} and org_unit_id = ${r.org_unit_id} and status = 'open'`).length) {
      const itask = await createTask(u, { title: `[${IMPROVE_TAG}] ${x.item_title} — ${IMPROVE_STREAK}회 연속 보완 필요`, orgUnitId: r.org_unit_id, assigneeId: u.id, tags: [IMPROVE_TAG],
        description: [`${r.org_unit_name}의 "${x.item_title}"이(가) ${IMPROVE_STREAK}회 연속 보완 필요로 기록됐습니다.`, '같은 보완을 되풀이하지 않게 아래 가운데 맞는 것을 정해 주세요.', '',
          '- 양호 기준·확인 방법을 고친다(점검 가이드)', '- 담당자에게 방법을 다시 안내한다', '- 장비·시설을 바꾸거나 고친다', '- 점검 주기를 바꾼다'].join('\n') } as never, { quiet: true });
      await sql`insert into chk_improvements (tenant, item_id, org_unit_id, streak, task_id) values (${t}, ${x.item_id}, ${r.org_unit_id}, ${IMPROVE_STREAK}, ${itask.id}) on conflict do nothing`;
      improvements.push({ itemId: x.item_id, taskId: itask.id });
    }
  }
  await sql`update chk_rounds set ended_at = now() where id = ${id} and ended_at is null`;
  const count = { ok: 0, fix: 0, na: 0 }; for (const x of results) count[x.verdict]++;
  return { id, count, followups: made, improvements };
}

// ---------------- 보완 요청 목록 · 보완 확인 ----------------
/** 화면 상태: 요청됨(업무 진행 중) · 확인 대기(업무 완료, 점검자 확인 전) · 닫힘(양호 확인) */
const stateOf = (status: string, taskStatus: string | null) => (status === 'ok' ? 'closed' : status === 'canceled' ? 'canceled' : taskStatus === 'done' ? 'waiting' : 'requested');
export async function listFollowups(u: SessionUser, f: { state?: string | null; unitId?: string | null } = {}) {
  await requireMenu(u, 'check_run', 'use');
  const sql = db(); const t = tenantOf(u); const mine = await myUnits(u, sql);
  const rows = await sql<any[]>`select f.id, f.status, f.round_no, f.due_date, f.note, f.created_at, f.closed_at, f.close_note, f.task_id, f.org_unit_id, o.name as org_unit_name,
      x.item_title, x.pass_criteria, x.memo, pt.name as place_type_name, tk.status as task_status, tk.completed_at, a.name as assignee_name, rq.name as requested_by_name,
      (select count(*)::int from attachments at where at.task_id = f.task_id and at.deleted_at is null and at.upload_status = 'ready' and at.kind = 'file' and at.mime_type like 'image/%') as photos,
      (select json_agg(at.id order by at.created_at) from attachments at where at.task_id = f.task_id and at.deleted_at is null and at.upload_status = 'ready' and at.kind = 'file' and at.mime_type like 'image/%') as photo_ids,
      (select json_agg(p.id order by p.created_at) from chk_photos p where p.tenant = f.tenant and p.owner_kind = 'result' and p.owner_id = f.result_id and p.upload_status = 'ready') as check_photo_ids,
      (select json_agg(json_build_object('id', e.id, 'target', e.target, 'replyDue', e.reply_due, 'outcome', e.outcome, 'closed', e.closed_at is not null) order by e.created_at) from chk_external e where e.followup_id = f.id) as external
    from chk_followups f join chk_results x on x.id = f.result_id join org_units o on o.id = f.org_unit_id left join chk_place_types pt on pt.id = x.place_type_id
      left join tasks tk on tk.id = f.task_id and tk.deleted_at is null left join users a on a.id = f.assignee_id left join users rq on rq.id = f.requested_by
    where f.tenant = ${t} ${mine === null ? sql`` : sql`and f.org_unit_id = any(${mine}::uuid[])`} ${f.unitId ? sql`and f.org_unit_id = ${f.unitId}` : sql``}
    order by (f.status = 'requested') desc, (tk.status = 'done') desc, f.due_date nulls last, f.created_at desc limit 300`;
  const items = rows.map((r) => ({ id: r.id, state: stateOf(r.status, r.task_status), roundNo: r.round_no, dueDate: r.due_date, note: r.note, createdAt: r.created_at, closedAt: r.closed_at, closeNote: r.close_note, taskId: r.task_id,
    orgUnitId: r.org_unit_id, orgUnitName: r.org_unit_name, itemTitle: r.item_title, passCriteria: r.pass_criteria, memo: r.memo, placeTypeName: r.place_type_name, assigneeName: r.assignee_name, requestedByName: r.requested_by_name,
    taskDoneAt: r.completed_at, photos: r.photos, photoIds: (r.photo_ids ?? []) as string[], checkPhotoIds: (r.check_photo_ids ?? []) as string[], external: r.external ?? [] }));
  const want = f.state && ['requested', 'waiting', 'closed', 'open'].includes(f.state) ? f.state : null;
  const list = want === 'open' ? items.filter((x) => x.state === 'requested' || x.state === 'waiting') : want ? items.filter((x) => x.state === want) : items;
  return { followups: list, counts: { requested: items.filter((x) => x.state === 'requested').length, waiting: items.filter((x) => x.state === 'waiting').length, closed: items.filter((x) => x.state === 'closed').length } };
}
export const confirmInput = z.object({ ok: z.boolean(), note: z.string().trim().max(500).optional(), dueDate: date.nullable().optional() });
/** 보완 확인: [양호 확인] = 닫힘 · [다시 보완] = 같은 담당자에게 새 업무(앞 업무는 완료 그대로 남음) · 회차 +1. 업무가 완료된 뒤(확인 대기)에만 */
export async function confirmFollowup(u: SessionUser, id: string, i: z.infer<typeof confirmInput>) {
  await requireMenu(u, 'check_run', 'use');
  const sql = db(); const t = tenantOf(u); const mine = await myUnits(u, sql);
  const [f] = await sql<{ id: string; status: string; task_id: string | null; org_unit_id: string; org_unit_name: string; assignee_id: string | null; round_no: number; item_title: string; pass_criteria: string; memo: string | null;
    place_type_name: string | null; fix_action: GuideItem['fix_action'] | null; note: string | null; task_status: string | null }[]>`
    select f.id, f.status, f.task_id, f.org_unit_id, o.name as org_unit_name, f.assignee_id, f.round_no, x.item_title, x.pass_criteria, x.memo, pt.name as place_type_name, it.fix_action, f.note, tk.status as task_status
    from chk_followups f join chk_results x on x.id = f.result_id join org_units o on o.id = f.org_unit_id left join chk_place_types pt on pt.id = x.place_type_id left join chk_items it on it.id = f.item_id
      left join tasks tk on tk.id = f.task_id and tk.deleted_at is null where f.id = ${id} and f.tenant = ${t}`;
  if (!f || (mine !== null && !mine.includes(f.org_unit_id))) throw notFound();
  if (f.status !== 'requested') throw conflict('이미 닫힌 보완 요청입니다');
  if (f.task_status !== 'done') throw conflict('담당자가 아직 조치를 끝내지 않았습니다 — 업무가 완료되면 확인할 수 있습니다');
  if (i.ok) {
    await sql`update chk_followups set status = 'ok', closed_at = now(), closed_by = ${u.id}, close_note = ${i.note ?? null}, updated_at = now() where id = ${id}`;
    if (f.assignee_id) await notify(sql, { userIds: [f.assignee_id], actorId: u.id, type: 'check_followup', title: `보완 확인: ${f.item_title} — 양호`, body: i.note || '조치해 주셔서 고맙습니다.', link: f.task_id ? `/tasks?task=${f.task_id}` : '/check',
      entityType: 'task', entityId: f.task_id ?? undefined, dedupeKey: `chkok:${id}` }).catch(() => []);
    return { id, state: 'closed' };
  }
  if (!i.note) throw badRequest('무엇을 더 살펴보면 좋을지 한 줄 적어 주세요');
  // 다시 보완: 같은 담당자에게 새 업무(업무 배정 알림이 감). 앞 업무는 완료 그대로 두고 기록에 남긴다
  const round = f.round_no + 1;
  const due = i.dueDate ?? addDays(todaySeoul(), Math.max(1, Number(f.fix_action?.dueDays ?? 1)));
  const { createTask } = await import('../tasks');
  const text = followupText({ title: f.item_title, place: f.place_type_name, unit: f.org_unit_name, pass: f.pass_criteria, memo: f.memo, note: f.note, fix: f.fix_action?.note ?? null, due, again: i.note });
  const task = await createTask(u, { title: `${f.item_title} 보완 요청(${round}차)`, description: text, orgUnitId: f.org_unit_id, assigneeId: f.assignee_id, dueDate: due, photoRequired: 1, tags: [FOLLOWUP_TAG] } as never, { quiet: false });
  await sql`update chk_followups set round_no = ${round}, task_id = ${task.id}, prev_task_ids = ${f.task_id ? sql`array_append(prev_task_ids, ${f.task_id}::uuid)` : sql`prev_task_ids`}, due_date = ${due},
    waiting_notified_at = null, close_note = ${i.note}, updated_at = now() where id = ${id}`;
  return { id, state: 'requested', roundNo: round, taskId: task.id };
}
export const externalInput = z.object({ outcome: z.string().trim().min(1).max(500) });
/** 외부 연락 결과 적기(적으면 닫힘) */
export async function closeExternal(u: SessionUser, id: string, i: z.infer<typeof externalInput>) {
  await requireMenu(u, 'check_run', 'use');
  const sql = db(); const t = tenantOf(u); const mine = await myUnits(u, sql);
  const [e] = await sql<{ id: string; org_unit_id: string }[]>`select e.id, f.org_unit_id from chk_external e join chk_followups f on f.id = e.followup_id where e.id = ${id} and e.tenant = ${t}`;
  if (!e || (mine !== null && !mine.includes(e.org_unit_id))) throw notFound();
  await sql`update chk_external set outcome = ${i.outcome}, closed_at = now() where id = ${id}`;
  return { id, closed: true };
}

// ---------------- 점검 홈 ----------------
export async function checkHome(u: SessionUser) {
  await requireMenu(u, 'check_run', 'use');
  const sql = db(); const t = tenantOf(u); const mine = await myUnits(u, sql);
  const scope = mine === null ? sql`` : sql`and r.org_unit_id = any(${mine}::uuid[])`;
  const open = await sql`select r.id, r.org_unit_id, o.name as org_unit_name, r.course_name, r.kind, r.started_at, (select count(*)::int from chk_results x where x.round_id = r.id) as done
    from chk_rounds r join org_units o on o.id = r.org_unit_id where r.tenant = ${t} and r.ended_at is null and r.checker_id = ${u.id} ${scope} order by r.started_at desc limit 10`;
  const recent = await sql`select r.id, o.name as org_unit_name, r.course_name, r.kind, r.ended_at, us.name as checker_name,
      (select count(*)::int from chk_results x where x.round_id = r.id and x.verdict = 'ok') as ok, (select count(*)::int from chk_results x where x.round_id = r.id and x.verdict = 'fix') as fix
    from chk_rounds r join org_units o on o.id = r.org_unit_id left join users us on us.id = r.checker_id where r.tenant = ${t} and r.ended_at is not null ${scope} order by r.ended_at desc limit 10`;
  const fu = await listFollowups(u, {});
  const improvements = await sql`select m.id, m.streak, m.task_id, i.title as item_title, o.name as org_unit_name, tk.status as task_status from chk_improvements m join chk_items i on i.id = m.item_id join org_units o on o.id = m.org_unit_id
      left join tasks tk on tk.id = m.task_id and tk.deleted_at is null
    where m.tenant = ${t} and m.status = 'open' ${mine === null ? sql`` : sql`and m.org_unit_id = any(${mine}::uuid[])`} order by m.created_at desc limit 20`;
  const external = fu.followups.flatMap((f) => (f.external as { id: string; target: string; replyDue: string | null; outcome: string | null; closed: boolean }[]).filter((e) => !e.closed).map((e) => ({ ...e, followupId: f.id, itemTitle: f.itemTitle, orgUnitName: f.orgUnitName })));
  return { open, recent, counts: fu.counts, improvements, external, kinds: ROUND_KINDS };
}

// ---------------- 정기 실행: '확인 대기' 알림 · 외부 연락 회신 기한 ----------------
/** 담당자가 업무를 끝낸 보완 요청 → 요청한 점검자에게 한 번(회차마다). 외부 연락 회신 기한이 지난 것 → 한 번 */
export async function checkTick(now = new Date()) {
  const sql = db();
  const waiting = await sql<{ id: string; tenant: string; requested_by: string | null; item_title: string; org_unit_name: string; task_id: string }[]>`
    select f.id, f.tenant, f.requested_by, x.item_title, o.name as org_unit_name, f.task_id from chk_followups f join chk_results x on x.id = f.result_id join org_units o on o.id = f.org_unit_id
      join tasks tk on tk.id = f.task_id and tk.deleted_at is null
    where f.status = 'requested' and tk.status = 'done' and f.waiting_notified_at is null limit 200`;
  for (const f of waiting) {
    await sql`update chk_followups set waiting_notified_at = now() where id = ${f.id} and waiting_notified_at is null`;
    if (f.requested_by) await notify(sql, { userIds: [f.requested_by], type: 'check_followup', title: `보완 확인 요청: ${f.item_title}`, body: `${f.org_unit_name} — 담당자가 조치를 끝냈습니다. 사진을 보고 확인해 주세요.`, link: '/check?tab=run', dedupeKey: `chkwait:${f.id}:${now.toISOString().slice(0, 10)}` }).catch(() => []);
  }
  const today = todaySeoul(now);
  const overdue = await sql<{ id: string; target: string; by_user: string | null; item_title: string; reply_due: string }[]>`
    select e.id, e.target, e.by_user, x.item_title, e.reply_due::text from chk_external e join chk_followups f on f.id = e.followup_id join chk_results x on x.id = f.result_id
    where e.closed_at is null and e.reply_due is not null and e.reply_due < ${today}::date and e.overdue_notified_at is null limit 200`;
  for (const e of overdue) {
    await sql`update chk_external set overdue_notified_at = now() where id = ${e.id} and overdue_notified_at is null`;
    if (e.by_user) await notify(sql, { userIds: [e.by_user], type: 'check_followup', title: `회신 기한이 지났습니다: ${e.target}`, body: `${e.item_title} — 회신 기한(${e.reply_due})이 지났습니다. 다시 연락하거나 결과를 적어 주세요.`, link: '/check?tab=run', dedupeKey: `chkext:${e.id}` }).catch(() => []);
  }
  return { waiting: waiting.length, overdue: overdue.length };
}
