// 로컬 10/20 최우선 S1-2: 공용 수집 데이터(입찰 공고·신규단지·준공 시설·협력사)에 대한 회사별 진행 기록 쓰기 — 원본 영업관리의 상태 버튼 그대로
// (SALES_SCREEN_INVENTORY 2-10 공통 진행 위젯·2-8 시설 연락 상태·2-9 협력사 등록 상태). 정식 표 sales_work_records(096) 에 쓰고, 전환 뒤(writes_open) 화면은 이 표를 읽는다.
// 전환 전(원본 잠금)에는 409 — 리드 쓰기와 같은 규칙. '진행영업 전환'은 버튼이 아니라 [진행영업으로 넘기기](리드 생성·연결)로만.
import { z } from 'zod';
import { db, type Sql } from '../db';
import { HttpError, badRequest, notFound } from '../errors';
import { assertSpace } from '../spaces';
import { tenantOf, type SessionUser } from '../types';
import { writesOpen } from './cutover';

export const WORK_KINDS = ['bid', 'building', 'facility', 'vendor'] as const;
export type WorkKind = (typeof WORK_KINDS)[number];
/** 원본 상태 버튼 그대로(완료로 보내는 값: 미참여·대상아님 / 영업완료·대상아님 / 등록 완료·대상 아님) */
export const WORK_STATUS: Record<WorkKind, string[]> = {
  bid: ['미검토', '검토중', '연락중', '보류', '미참여', '대상아님'],
  building: ['미검토', '검토중', '연락중', '보류', '대상아님'],
  facility: ['미연락', '연락중', '영업완료', '대상아님'],
  vendor: ['미등록', '신청 준비', '신청 완료', '등록 완료', '대상 아님'],
};
export const CONVERTED = '진행영업 전환';
const KIND_NAME: Record<WorkKind, string> = { bid: '입찰 공고', building: '신규단지', facility: '시설', vendor: '협력사' };
const SRC_TBL: Record<WorkKind, string> = { bid: 'opportunity_work', building: 'opportunity_work', facility: 'operating_facility_prospects__progress', vendor: 'vendor_registrations__progress' };
const ITEM_TBL: Record<WorkKind, string> = { bid: 'procurement_notices', building: 'building_sales_pipeline', facility: 'operating_facility_prospects', vendor: 'vendor_registrations' };
const pick = (o: any, ...keys: string[]) => { for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return null; };

export const workInput = z.object({ kind: z.enum(WORK_KINDS), id: z.string().min(1).max(100), status: z.string().max(30).optional(), memo: z.string().trim().max(2000).nullable().optional(), nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() });
export const convertInput = z.object({ kind: z.enum(WORK_KINDS), id: z.string().min(1).max(100), force: z.boolean().optional(), name: z.string().trim().min(1).max(300).optional() });
export const recordInput = z.object({ kind: z.enum(['proposals', 'contracts']), title: z.string().trim().min(1).max(300), amount: z.number().min(0).max(1e13).nullable().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), status: z.string().max(30).optional(), memo: z.string().trim().max(2000).optional() });

async function assertWritesOpen(tenant: string) {
  if (!(await writesOpen(tenant))) throw new HttpError(409, 'sales_read_only', '영업관리 전환 전이라 워크인에서는 고칠 수 없습니다 — 전환일까지는 영업관리에서 수정해 주세요');
}
/** 공용 수집 행(원본 복사) — 없으면 404 */
async function item(sql: Sql, kind: WorkKind, id: string) {
  const [r] = await sql<{ row: any }[]>`select row from sales_src_rows where scope = 'global' and tbl = ${ITEM_TBL[kind]} and src_id = ${id} and not gone`;
  if (!r) throw notFound('대상을 찾을 수 없습니다');
  return r.row;
}
/** 지금 진행 기록(정식 표) */
export async function workRecord(sql: Sql, tenant: string, kind: WorkKind, id: string) {
  const tbl = SRC_TBL[kind];
  const [w] = tbl === 'opportunity_work'
    ? await sql<any[]>`select src_id, status, lead_id, data from sales_work_records where tenant = ${tenant} and src_tbl = ${tbl} and ref_id = ${id} order by updated_at desc limit 1`
    : await sql<any[]>`select src_id, status, lead_id, data from sales_work_records where tenant = ${tenant} and src_tbl = ${tbl} and src_id = ${id}`;
  return w ?? null;
}
/** 진행 기록 저장(상태·메모·다음 연락일) — 원본 규칙: 처음 메모를 남기면 미검토 → 검토중 */
export async function saveWork(u: SessionUser, i: z.infer<typeof workInput>) {
  await assertSpace(u, 'sales');
  const t = tenantOf(u); const sql = db();
  await item(sql, i.kind, i.id);
  await assertWritesOpen(t);
  if (i.status !== undefined && !WORK_STATUS[i.kind].includes(i.status)) throw badRequest(`상태는 ${WORK_STATUS[i.kind].join('·')} 중 하나입니다`);
  const cur = await workRecord(sql, t, i.kind, i.id);
  if (cur?.status === CONVERTED) throw badRequest('진행영업으로 넘긴 건입니다 — 리드에서 고쳐 주세요');
  const first = WORK_STATUS[i.kind][0], review = i.kind === 'facility' ? '연락중' : i.kind === 'vendor' ? '신청 준비' : '검토중';
  let status = i.status ?? cur?.status ?? first;
  if (i.status === undefined && i.memo && status === first && !pick(cur?.data, 'memo', 'last_note')) status = review;
  const d = cur?.data ?? {};
  const memo = i.memo === undefined ? pick(d, 'memo', 'last_note', 'note') : i.memo;
  const next = i.nextDate === undefined ? pick(d, 'next_date', 'next_action_date', 'next_contact_date') : i.nextDate;
  // 원본 칸 이름 그대로 저장(화면 읽기 코드가 그대로 쓰이게)
  const data = i.kind === 'facility' ? { ...d, contact_status: status, last_note: memo, next_action_date: next, updated_by: u.id }
    : i.kind === 'vendor' ? { ...d, status, memo, next_date: next, updated_by: u.id }
      : { ...d, status, memo, next_date: next, updated_by: u.id, ...(i.kind === 'bid' ? { notice_id: i.id } : { source_id: i.id, source_type: 'building' }) };
  const srcId = cur?.src_id ?? (SRC_TBL[i.kind] === 'opportunity_work' ? `w:${i.kind}:${i.id}` : i.id);
  await sql`insert into sales_work_records (tenant, src_tbl, src_id, ref_id, status, lead_id, data) values (${t}, ${SRC_TBL[i.kind]}, ${srcId}, ${i.id}, ${status}, ${cur?.lead_id ?? null}, ${sql.json(data)})
    on conflict (tenant, src_tbl, src_id) do update set status = excluded.status, data = excluded.data, updated_at = now()`;
  // 대표 10/20 14:15: 영업 진행(연락중 등)으로 바뀌면 업무 자동 생성, 보류·미참여·완료면 업무도 함께
  const r = await item(sql, i.kind, i.id);
  const bidName = [pick(r, 'complex_name', 'facility_name'), pick(r, 'title', 'notice_title', 'bid_name')].filter(Boolean).join(' '); // 입찰은 '단지 공고명'
  const task = await (await import('./autoTasks')).syncSalesTask(sql, u, { kind: i.kind, id: i.id, name: (i.kind === 'bid' ? bidName : String(pick(r, 'name', 'complex_name', 'company', 'company_name', 'facility_name', 'title') ?? '')) || KIND_NAME[i.kind], status, nextDate: next,
    deadline: i.kind === 'bid' ? (String(pick(r, 'deadline_at', 'close_at', 'deadline', 'bid_close_at', 'closing_date', 'end_date') ?? '').slice(0, 10) || null) : null, nextAction: pick(cur?.data, 'next_action') });
  return { ok: true, status, memo, nextDate: next, task };
}
const norm = (s: string) => s.replace(/[\s()（）·\-_,.]/g, '').toLowerCase();
/** [진행영업으로 넘기기]: 비슷한 이름의 리드가 있으면 최대 5곳을 먼저(force 로 그래도 새로 만들기) → 리드 생성·연결·상태 '진행영업 전환' */
export async function convertToLead(u: SessionUser, i: z.infer<typeof convertInput>) {
  await assertSpace(u, 'sales');
  const t = tenantOf(u); const sql = db();
  const r = await item(sql, i.kind, i.id);
  await assertWritesOpen(t);
  const cur = await workRecord(sql, t, i.kind, i.id);
  if (cur?.lead_id) return { leadId: cur.lead_id, already: true };
  const name = i.name ?? String(pick(r, 'complex_name', 'name', 'company', 'company_name', 'facility_name', 'title') ?? '').trim();
  if (!name) throw badRequest('리드 이름이 필요합니다');
  if (!i.force) {
    const key = norm(name).slice(0, 4);
    const similar = key.length >= 2 ? (await sql<{ id: string; name: string; status: string | null }[]>`select id, name, status from sales_leads where tenant = ${t} and replace(replace(lower(name), ' ', ''), '(', '') like ${'%' + key + '%'} order by updated_at desc limit 5`) : [];
    if (similar.length) return { similar };
  }
  const leadId = await sql.begin(async (tx) => {
    const [l] = await tx<{ id: string }[]>`insert into sales_leads (tenant, name, status, facility_type, region, owner_id, contact_name, phone, memo, src)
      values (${t}, ${name}, '신규리드', ${pick(r, 'facility_type', 'building_type', 'category') ?? null}, ${pick(r, 'region', 'sido') ?? null}, ${u.id}, ${pick(r, 'contact_name', 'manager_name') ?? null},
        ${pick(r, 'office_phone', 'management_phone', 'phone', 'contact_phone') ?? null}, ${`${i.kind === 'bid' ? '입찰 공고' : i.kind === 'building' ? '신규단지' : i.kind === 'facility' ? '준공·입주 시설' : '협력사'}에서 넘김`}, ${tx.json({ from: i.kind, id: i.id })}) returning id`;
    await tx`insert into sales_status_log (tenant, lead_id, from_status, to_status, reason, changed_by) values (${t}, ${l.id}, null, '신규리드', ${'진행영업 전환'}, ${u.id})`;
    const d = { ...(cur?.data ?? {}), ...(i.kind === 'facility' ? { contact_status: CONVERTED } : { status: CONVERTED }), lead_id: l.id, converted_by: u.id, converted_at: new Date().toISOString(), ...(i.kind === 'bid' ? { notice_id: i.id } : i.kind === 'building' ? { source_id: i.id, source_type: 'building' } : {}) };
    const srcId = cur?.src_id ?? (SRC_TBL[i.kind] === 'opportunity_work' ? `w:${i.kind}:${i.id}` : i.id);
    await tx`insert into sales_work_records (tenant, src_tbl, src_id, ref_id, status, lead_id, data) values (${t}, ${SRC_TBL[i.kind]}, ${srcId}, ${i.id}, ${CONVERTED}, ${l.id}, ${tx.json(d)})
      on conflict (tenant, src_tbl, src_id) do update set status = excluded.status, lead_id = excluded.lead_id, data = excluded.data, updated_at = now()`;
    return l.id;
  });
  // 대표 10/20 14:15: 전환된 원천 건의 열린 업무는 완료, 리드에 '첫 연락' 업무
  const { syncSalesTask } = await import('./autoTasks');
  await syncSalesTask(sql, u, { kind: i.kind, id: i.id, name, status: '영업완료' });
  await syncSalesTask(sql, u, { kind: 'lead', id: leadId, name, status: '신규리드', nextAction: '첫 연락', leadId });
  return { leadId };
}
/** 대표 10/20 14:15 ④ 허브·입찰 목록에서 여러 건 체크 → [영업 진행으로] — 한 번에 상태 바꾸고 업무 n건 */
export async function bulkWork(u: SessionUser, i: { kind: WorkKind; ids: string[]; status: string; nextDate?: string | null }) {
  const out: { id: string; ok: boolean; taskId?: string | null; error?: string }[] = [];
  for (const id of [...new Set(i.ids)].slice(0, 100)) {
    try { const r = await saveWork(u, { kind: i.kind, id, status: i.status, nextDate: i.nextDate ?? undefined }); out.push({ id, ok: true, taskId: r.task?.taskId ?? null }); }
    catch (e: any) { out.push({ id, ok: false, error: e?.message ?? String(e) }); }
  }
  return { ok: true, results: out, tasks: out.filter((x) => x.taskId).length };
}
/** 제안·계약 등록(리드에 딸린 기록) */
export async function addLeadRecord(u: SessionUser, leadId: string, i: z.infer<typeof recordInput>) {
  await assertSpace(u, 'sales');
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) throw notFound();
  const t = tenantOf(u); const sql = db();
  const [l] = await sql<{ owner_id: string | null; name: string }[]>`select owner_id, name from sales_leads where id = ${leadId} and tenant = ${t}`;
  if (!l) throw notFound();
  await assertWritesOpen(t);
  if (!['owner', 'admin'].includes(u.role) && l.owner_id && l.owner_id !== u.id) throw new HttpError(403, 'forbidden', '담당 리드만 기록할 수 있습니다');
  const day = i.date ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const data = i.kind === 'proposals' ? { title: i.title, amount: i.amount ?? null, proposal_date: day, status: i.status ?? '제안', memo: i.memo ?? null, lead_name: l.name, created_by: u.id }
    : { title: i.title, amount: i.amount ?? null, contract_date: day, status: i.status ?? '계약', memo: i.memo ?? null, lead_name: l.name, created_by: u.id };
  const [r] = await sql<{ id: string }[]>`insert into sales_lead_records (tenant, kind, lead_id, occurred_at, data) values (${t}, ${i.kind}, ${leadId}, ${`${day}T00:00:00+09:00`}, ${sql.json(data)}) returning id`;
  return { id: r.id };
}
/** 전환 뒤 화면 읽기용: 정식 표 행을 원본 행 모양으로 */
export async function workRows(sql: Sql, tenant: string, srcTbl: string) {
  return (await sql<any[]>`select src_id, ref_id, status, lead_id, data from sales_work_records where tenant = ${tenant} and src_tbl = ${srcTbl}`)
    .map((w) => ({ ...w.data, id: w.src_id, __id: w.src_id, status: w.status ?? w.data?.status ?? null, lead_id: w.lead_id ?? w.data?.lead_id ?? null, ...(srcTbl === 'opportunity_work' ? { notice_id: w.data?.notice_id ?? w.ref_id } : {}) }));
}
