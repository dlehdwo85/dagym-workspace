// V30 ④ 결재 양식: 휴가·지출결의·일반 품의 — 회사가 칸을 고치는 간단 양식(필드 빌더) + 요청 = 결재 업무(기존 결재선·결재 회차 그대로).
// 휴가 최종 승인 → 요청자 개인 캘린더에 연차/반차/병가 일정(부재) 자동 등록, 지출결의는 승인 건 엑셀 내보내기. 다른 회사 404.
// 로컬 10/20 19:10 (#114): 종류 추가(출장·구매·경조사), 결재선 미리 보기·변경, 참조자, 문서번호, 임시 저장, 반려 사유, 탭(결재할 것·올린 것·참조), 결재할 것 수.
import { z } from 'zod';
import { db, type Sql } from './db';
import { badRequest, forbidden, notFound } from './errors';
import { isAdmin, denyDemo } from './access';
import { audit } from './log';
import { tenantOf, type SessionUser } from './types';
import { zUuid } from './api';

export type Field = { key: string; label: string; type: 'text' | 'number' | 'date' | 'daterange' | 'select' | 'textarea' | 'file'; required?: boolean; options?: string[]; hint?: string };
export const KINDS = ['leave', 'expense', 'general', 'trip', 'purchase', 'family'] as const;
export type Kind = (typeof KINDS)[number];
export const fieldInput = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/, '영문 소문자 키'), label: z.string().trim().min(1).max(40), type: z.enum(['text', 'number', 'date', 'daterange', 'select', 'textarea', 'file']), required: z.boolean().optional(), options: z.array(z.string().trim().min(1).max(40)).max(20).optional(), hint: z.string().trim().max(120).optional() });
export const formInput = z.object({ kind: z.enum(KINDS), name: z.string().trim().min(1).max(60), fields: z.array(fieldInput).min(1).max(20), lineId: z.string().uuid().nullable().optional(), active: z.boolean().optional() });
export const requestInput = z.object({ kind: z.enum(KINDS), formId: z.string().uuid().optional(), data: z.record(z.unknown()), lineId: z.string().uuid().optional(), ccUserIds: z.array(zUuid).max(10).optional(), draftId: z.string().uuid().optional() });
/** #114 ④ 임시 저장: 필수 검사 없이 값만 보관(업무·결재 회차 없음). 올릴 때 draftId 로 넘기면 같은 건으로 */
export const draftInput = z.object({ kind: z.enum(KINDS), formId: z.string().uuid().optional(), data: z.record(z.unknown()), lineId: z.string().uuid().nullable().optional(), ccUserIds: z.array(zUuid).max(10).optional() });
export const KIND_LABEL: Record<string, string> = { leave: '휴가', expense: '지출결의', general: '품의', trip: '출장', purchase: '구매', family: '경조사' };

/** 회사가 아직 안 고친 기본 양식 */
export const DEFAULT_FIELDS: Record<Kind, Field[]> = {
  leave: [
    { key: 'leave_type', label: '종류', type: 'select', required: true, options: ['연차', '반차(오전)', '반차(오후)', '병가', '경조', '기타'] },
    { key: 'period', label: '기간', type: 'daterange', required: true, hint: '반차는 하루만' },
    { key: 'reason', label: '사유', type: 'textarea', required: false },
    { key: 'deputy', label: '대리 업무자(선택)', type: 'text', required: false },
  ],
  expense: [
    { key: 'used_on', label: '사용일', type: 'date', required: true },
    { key: 'item', label: '항목', type: 'text', required: true, hint: '예: 현장 소모품 구입' },
    { key: 'amount', label: '금액(원)', type: 'number', required: true },
    { key: 'method', label: '결제 수단', type: 'select', required: true, options: ['법인카드', '개인카드(청구)', '현금', '계좌이체'] },
    { key: 'receipt', label: '영수증 사진', type: 'file', required: true, hint: '만든 뒤 결재 업무에 사진을 붙여 주세요' },
    { key: 'note', label: '비고', type: 'textarea' },
  ],
  general: [
    { key: 'subject', label: '제목', type: 'text', required: true },
    { key: 'body', label: '내용', type: 'textarea', required: true },
    { key: 'amount', label: '금액(원, 선택)', type: 'number' },
    { key: 'due', label: '희망 처리일(선택)', type: 'date' },
    { key: 'attach', label: '첨부(선택)', type: 'file' },
  ],
  // #114 ⑤ 출장·구매·경조사
  trip: [
    { key: 'destination', label: '출장지', type: 'text', required: true, hint: '예: 부산 해운대 현장' },
    { key: 'period', label: '기간', type: 'daterange', required: true },
    { key: 'purpose', label: '목적', type: 'textarea', required: true },
    { key: 'transport', label: '교통편', type: 'select', options: ['자차', '대중교통', 'KTX·항공', '법인차', '기타'] },
    { key: 'amount', label: '예상 경비(원)', type: 'number' },
    { key: 'companions', label: '동행자(선택)', type: 'text' },
  ],
  purchase: [
    { key: 'item', label: '품목', type: 'text', required: true, hint: '예: 노트북 1대' },
    { key: 'qty', label: '수량', type: 'number', required: true },
    { key: 'amount', label: '금액(원)', type: 'number', required: true, hint: '부가세 포함 총액' },
    { key: 'vendor', label: '거래처', type: 'text' },
    { key: 'reason', label: '구매 사유', type: 'textarea', required: true },
    { key: 'due', label: '희망 납기(선택)', type: 'date' },
    { key: 'quote', label: '견적서(선택)', type: 'file' },
  ],
  family: [
    { key: 'event_type', label: '경조 종류', type: 'select', required: true, options: ['본인 결혼', '자녀 결혼', '형제자매 결혼', '출산', '부모상', '배우자 부모상', '조부모상', '형제자매상', '회갑·칠순', '기타'] },
    { key: 'event_date', label: '일자', type: 'date', required: true },
    { key: 'relation', label: '대상(관계)', type: 'text', hint: '예: 부친' },
    { key: 'leave_days', label: '경조 휴가 일수', type: 'number', hint: '회사 규정에 따라' },
    { key: 'amount', label: '경조금 신청(원, 선택)', type: 'number' },
    { key: 'note', label: '비고', type: 'textarea' },
  ],
};
const DEFAULT_NAME: Record<string, string> = { leave: '휴가 신청', expense: '지출결의서', general: '일반 품의서', trip: '출장 신청', purchase: '구매 품의', family: '경조사 신청' };

const canEditForms = async (u: SessionUser) => isAdmin(u) || (await import('./menuPerms')).RANK[await (await import('./menuPerms')).menuLevel(u, 'ops')] >= 2;

/** 양식 목록(없는 종류는 기본 양식으로 채워서 보여 줌) */
export async function listForms(u: SessionUser) {
  const sql = db(); const t = tenantOf(u);
  const rows = await sql<any[]>`select f.id, f.kind, f.name, f.fields, f.line_id, f.active, l.name as line_name from approval_forms f left join approval_lines l on l.id = f.line_id where f.tenant = ${t} order by f.kind, f.created_at`;
  // #429 양식 기본 결재선 = (양식 × 회사 전체) 배정. 예전 양식 칸(line_id)은 배정이 없을 때만
  const assigned = await sql<{ kind: string; line_id: string; name: string }[]>`select a.kind, a.line_id, l.name from approval_line_assignments a join approval_lines l on l.id = a.line_id where a.tenant = ${t} and a.team_id is null and a.kind <> '*' and l.active`;
  const def = (k: string, lineId: string | null, lineName: string | null) => { const a = assigned.find((x) => x.kind === k); return a ? { lineId: a.line_id, lineName: a.name } : { lineId, lineName }; };
  const forms = KINDS.flatMap((k) => {
    const mine = rows.filter((r) => r.kind === k && r.active);
    return mine.length ? mine.map((r) => ({ id: r.id, kind: r.kind, name: r.name, fields: r.fields as Field[], ...def(k, r.line_id, r.line_name), isDefault: false })) : [{ id: null, kind: k, name: DEFAULT_NAME[k], fields: DEFAULT_FIELDS[k], ...def(k, null, null), isDefault: true }];
  });
  const lines = await sql<{ id: string; name: string; active: boolean }[]>`select id, name, active from approval_lines where (tenant = ${t} or org_unit_id in (select id from org_units where tenant = ${t})) and active order by name`;
  return { forms, lines, canEdit: await canEditForms(u) };
}
export async function saveForm(u: SessionUser, id: string | null, i: z.infer<typeof formInput>, ip: string | null) {
  if (!(await canEditForms(u))) throw forbidden('결재 양식은 운영 상태 편집 권한(대표·관리자)만 고칠 수 있습니다');
  const sql = db(); const t = tenantOf(u);
  if (new Set(i.fields.map((f) => f.key)).size !== i.fields.length) throw badRequest('칸 키가 겹칩니다');
  if (i.lineId) { const [l] = await sql`select 1 from approval_lines l where l.id = ${i.lineId} and (l.tenant = ${t} or l.org_unit_id in (select id from org_units where tenant = ${t}))`; if (!l) throw notFound('결재선이 없습니다'); }
  let fid = id;
  if (id) {
    const r = await sql`update approval_forms set name = ${i.name}, fields = ${sql.json(i.fields as never)}, line_id = ${i.lineId ?? null}, active = ${i.active ?? true}, updated_at = now() where id = ${id} and tenant = ${t} returning id`;
    if (!r.length) throw notFound('양식이 없습니다');
  } else { const [r] = await sql<{ id: string }[]>`insert into approval_forms (tenant, kind, name, fields, line_id, created_by) values (${t}, ${i.kind}, ${i.name}, ${sql.json(i.fields as never)}, ${i.lineId ?? null}, ${u.id}) returning id`; fid = r.id; }
  if (i.lineId !== undefined) { // #429 양식 기본 결재선 = (양식 × 회사 전체) 배정과 같은 값
    await sql`delete from approval_line_assignments where tenant = ${t} and kind = ${i.kind} and team_id is null`;
    if (i.lineId) await sql`insert into approval_line_assignments (tenant, kind, team_id, line_id, created_by) values (${t}, ${i.kind}, null, ${i.lineId}, ${u.id})`;
  }
  await audit(sql, u.id, 'approval_form.save', 'approval_form', fid, { kind: i.kind, name: i.name }, ip);
  return { id: fid };
}

function validate(fields: Field[], data: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = data[f.key];
    const empty = v === undefined || v === null || v === '' || (f.type === 'daterange' && (!(v as any)?.from || !(v as any)?.to));
    if (f.required && empty && f.type !== 'file') throw badRequest(`"${f.label}" 을(를) 채워 주세요`);
    if (empty) continue;
    if (f.type === 'number') { const n = Number(String(v).replace(/[^0-9.-]/g, '')); if (!Number.isFinite(n)) throw badRequest(`"${f.label}" 은(는) 숫자여야 합니다`); out[f.key] = Math.round(n); }
    else if (f.type === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw badRequest(`"${f.label}" 날짜 형식이 아닙니다`); out[f.key] = v; }
    else if (f.type === 'daterange') { const r = v as { from: string; to: string }; if (!/^\d{4}-\d{2}-\d{2}$/.test(r.from) || !/^\d{4}-\d{2}-\d{2}$/.test(r.to) || r.to < r.from) throw badRequest(`"${f.label}" 기간이 올바르지 않습니다`); out[f.key] = { from: r.from, to: r.to }; }
    else if (f.type === 'select') { if (f.options && !f.options.includes(String(v))) throw badRequest(`"${f.label}" 값이 목록에 없습니다`); out[f.key] = String(v); }
    else if (f.type === 'file') continue; // 파일은 만든 뒤 결재 업무에 붙인다
    else out[f.key] = String(v).slice(0, f.type === 'textarea' ? 4000 : 300);
  }
  return out;
}
function summarize(kind: string, fields: Field[], data: Record<string, unknown>, who: string) {
  if (kind === 'leave') { const p = data.period as { from: string; to: string } | undefined; return `[휴가] ${who} ${data.leave_type ?? ''} ${p ? `${p.from.slice(5)}${p.to !== p.from ? `~${p.to.slice(5)}` : ''}` : ''}`.trim(); }
  if (kind === 'expense') return `[지출결의] ${who} ${data.item ?? ''} ${data.amount !== undefined ? Number(data.amount).toLocaleString('ko-KR') + '원' : ''}`.trim();
  if (kind === 'trip') { const p = data.period as { from: string; to: string } | undefined; return `[출장] ${who} ${data.destination ?? ''} ${p ? `${p.from.slice(5)}${p.to !== p.from ? `~${p.to.slice(5)}` : ''}` : ''}`.trim(); }
  if (kind === 'purchase') return `[구매] ${who} ${data.item ?? ''} ${data.amount !== undefined ? Number(data.amount).toLocaleString('ko-KR') + '원' : ''}`.trim();
  if (kind === 'family') return `[경조사] ${who} ${data.event_type ?? ''} ${data.event_date ? String(data.event_date).slice(5) : ''}`.trim();
  return `[품의] ${who} ${data.subject ?? ''}`.trim();
}
const describe = (fields: Field[], data: Record<string, unknown>) => fields.map((f) => { const v = data[f.key]; if (v === undefined || v === '') return null; const s = f.type === 'daterange' ? `${(v as any).from} ~ ${(v as any).to}` : f.type === 'number' ? Number(v).toLocaleString('ko-KR') : String(v); return `${f.label}: ${s}`; }).filter(Boolean).join('\n');

/** 요청자 조직(소속 첫 조직, 없으면 본사) */
async function requesterUnit(sql: Sql, u: SessionUser, t: string) {
  const [m] = await sql<{ org_unit_id: string }[]>`select m.org_unit_id from memberships m join org_units o on o.id = m.org_unit_id where m.user_id = ${u.id} and o.tenant = ${t} order by o.type = 'hq' desc limit 1`;
  const [hq] = await sql<{ id: string }[]>`select id from org_units where tenant = ${t} and type = 'hq' order by created_at limit 1`;
  return m?.org_unit_id ?? hq?.id ?? null;
}
/** #114 ② · #429 작성 화면 결재선 미리 보기: 기안(나) → 1차·2차·3차 실제 결재자 이름 + 어디서 정해졌는지(양식×팀 배정·양식 기본·팀 기본·회사 기본) + 조건 단계(맞지 않으면 건너뜀 표시) */
export async function previewLine(u: SessionUser, q: { kind?: string; formId?: string; lineId?: string; data?: string }) {
  const sql = db(); const t = tenantOf(u);
  const { forms, lines } = await listForms(u);
  const form = q.formId ? forms.find((f) => f.id === q.formId) : forms.find((f) => f.kind === q.kind);
  const kind = form?.kind ?? q.kind ?? 'general';
  const orgUnitId = await requesterUnit(sql, u, t);
  const A = await import('./approvals');
  const res = await A.resolveLine(sql, t, { userId: u.id, orgUnitId, kind, given: q.lineId, formLine: form?.lineId ?? null });
  let data: Record<string, unknown> = {};
  try { if (q.data && q.data.length < 3000) { const d = JSON.parse(q.data); if (d && typeof d === 'object' && !Array.isArray(d)) data = d; } } catch { /* 값 없이 */ }
  const m = A.requestMetrics(kind, data, null);
  let steps: { order: number | null; label: string; type: string; role: string | null; names: string[]; skipped: boolean; cond: string | null }[] = [];
  let lineName: string | null = null;
  if (res.lineId && orgUnitId) {
    const [line] = await sql<{ name: string; steps: import('./approvals').Step[] }[]>`select name, steps from approval_lines where id = ${res.lineId}`;
    lineName = line?.name ?? null;
    const chain = (line?.steps ?? []).some((st) => st.type === 'lead') ? await A.teamChain(sql, t, u.id) : [];
    let order = 0;
    steps = await Promise.all((line?.steps ?? []).map(async (st) => {
      const skipped = !A.stepApplies(st.when, m);
      if (!skipped) order++;
      const ord = skipped ? null : order;
      let ids: string[] = [];
      if (st.type === 'lead') { const l = A.leadFor(chain, st.up ?? 0, u.id); ids = l ? [l.userId] : []; }
      else ids = await A.stepApprovers(sql, orgUnitId, { approver_type: st.type, approver_role: st.role ?? null, approver_user_id: st.userId ?? null }, { deputies: false });
      const names = ids.length ? (await sql<{ name: string }[]>`select name from users where id = any(${ids}::uuid[]) order by name`).map((x) => x.name) : [];
      return { order: ord, label: st.label, type: st.type, role: st.role ?? null, names, skipped, cond: st.when ? A.whenText(st.when) : null };
    }));
  }
  const active = steps.filter((s) => !s.skipped);
  return { lineId: res.lineId, lineName, source: res.source, sourceLabel: res.source ? A.SOURCE_LABEL[res.source] : null, via: res.via, fromForm: res.source === 'form', steps,
    lines: lines.map((l) => ({ id: l.id, name: l.name })), requester: u.name, missing: active.some((s) => !s.names.length) };
}

/** 문서번호: 결재-YYYY-NNNN (회사·연도별 순번, 같은 트랜잭션 안에서 잠금) */
async function nextDocNo(sql: Sql, t: string) {
  const year = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date());
  await sql`select pg_advisory_xact_lock(hashtext(${`approval_doc_no:${t}:${year}`}))`;
  const [{ n }] = await sql<{ n: number }[]>`select coalesce(max(substring(doc_no from '\\d+$')::int), 0) + 1 as n from approval_requests where tenant = ${t} and doc_no like ${`결재-${year}-%`}`;
  return `결재-${year}-${String(n).padStart(4, '0')}`;
}

/** 결재 요청 만들기 = 결재 업무(검토 요청 상태) — 결재선: approvals.resolveLine(#429 지정 > 양식×팀 > 양식 기본 > 팀 기본 > 회사 기본 > 예전 방식). 참조자에게는 목록·알림만 */
export async function createRequest(u: SessionUser, i: z.infer<typeof requestInput>, ip: string | null) {
  denyDemo(u);
  const sql = db(); const t = tenantOf(u);
  const { forms } = await listForms(u);
  const form = i.formId ? forms.find((f) => f.id === i.formId) : forms.find((f) => f.kind === i.kind);
  if (!form || form.kind !== i.kind) throw notFound('양식이 없습니다');
  const data = validate(form.fields, i.data);
  const orgUnitId = await requesterUnit(sql, u, t);
  if (!orgUnitId) throw badRequest('소속 조직이 없습니다');
  let draft: { id: string; line_id: string | null; cc_user_ids: string[] } | null = null;
  if (i.draftId) { [draft] = await sql<any[]>`select id, line_id, cc_user_ids from approval_requests where id = ${i.draftId} and tenant = ${t} and requester_id = ${u.id} and status = 'draft'`; if (!draft) throw notFound('임시 저장이 없습니다'); }
  const { lineId } = await (await import('./approvals')).resolveLine(sql, t, { userId: u.id, orgUnitId, kind: form.kind, given: i.lineId ?? draft?.line_id ?? null, formLine: form.lineId });
  if (!lineId) throw badRequest('결재선이 없습니다 — 관리자가 결재 › 결재 설정에서 먼저 만들어 주세요');
  await (await import('./approvals')).assertLineUsable(sql, t, lineId, { requesterId: u.id, orgUnitId, kind: form.kind, data, amount: typeof data.amount === 'number' ? data.amount : null }); // #429 결재자 없으면 업무를 만들기 전에 막음
  const cc = [...new Set((i.ccUserIds ?? draft?.cc_user_ids ?? []).filter((id) => id !== u.id))];
  if (cc.length) { const ok = await sql<{ id: string }[]>`select id from users where id = any(${cc}::uuid[]) and tenant = ${t} and status = 'active'`; if (ok.length !== cc.length) throw notFound('참조자를 찾을 수 없습니다'); }
  const title = summarize(form.kind, form.fields, data, u.name);
  const { createTask, updateTask } = await import('./tasks');
  const period = data.period as { from: string; to: string } | undefined;
  const task: any = await createTask(u, { orgUnitId, title, description: describe(form.fields, data), assigneeId: u.id, requestedById: u.id, taskType: 'approval', approvalRequired: true, approvalLineId: lineId,
    dueDate: (form.kind === 'leave' || form.kind === 'trip') && period ? period.from : (data.due as string | undefined) ?? (data.used_on as string | undefined) ?? (data.event_date as string | undefined) ?? null, tags: ['결재', KIND_LABEL[form.kind]], showOnCalendar: false } as any);
  const taskId = task.id as string;
  const amount = typeof data.amount === 'number' ? data.amount : null;
  const r = await sql.begin(async (tx) => {
    const docNo = await nextDocNo(tx, t);
    if (draft) { const [x] = await tx<{ id: string }[]>`update approval_requests set status = 'pending', form_id = ${form.id}, task_id = ${taskId}, data = ${tx.json(data as never)}, amount = ${amount}, doc_no = ${docNo}, line_id = ${lineId}, cc_user_ids = ${cc}::uuid[], created_at = now(), updated_at = now() where id = ${draft.id} returning id`; return { id: x.id, docNo }; }
    const [x] = await tx<{ id: string }[]>`insert into approval_requests (tenant, kind, form_id, task_id, requester_id, data, amount, doc_no, line_id, cc_user_ids) values (${t}, ${form.kind}, ${form.id}, ${taskId}, ${u.id}, ${tx.json(data as never)}, ${amount}, ${docNo}, ${lineId}, ${cc}::uuid[]) returning id`;
    return { id: x.id, docNo };
  });
  await updateTask(u, taskId, { status: 'review' } as any); // 검토 요청 → 결재 회차 시작·1단계 결재자 알림
  if (cc.length) {
    const { notify } = await import('./notifications');
    await notify(sql, { userIds: cc, type: 'mention', title: `결재 참조: ${title}`, body: `${u.name} 님이 올린 결재(${r.docNo})에 참조로 지정되었습니다`, link: `/approvals?view=cc`, entityType: 'task', entityId: taskId, actorId: u.id, dedupeKey: `apprcc:${r.id}`, push: false });
  }
  await audit(sql, u.id, 'approval_request.create', 'approval_request', r.id, { kind: form.kind, taskId, docNo: r.docNo, cc }, ip);
  return { id: r.id, taskId, title, docNo: r.docNo, link: `/tasks/${taskId}`, needsFile: form.fields.some((f) => f.type === 'file' && f.required) };
}
/** #114 ④ 임시 저장(값만, 필수 검사 없음) · 고치기 */
export async function saveDraft(u: SessionUser, id: string | null, i: z.infer<typeof draftInput>) {
  denyDemo(u);
  const sql = db(); const t = tenantOf(u);
  const { forms } = await listForms(u);
  const form = i.formId ? forms.find((f) => f.id === i.formId) : forms.find((f) => f.kind === i.kind);
  if (!form || form.kind !== i.kind) throw notFound('양식이 없습니다');
  const data: Record<string, unknown> = {}; for (const f of form.fields) if (i.data[f.key] !== undefined && i.data[f.key] !== '') data[f.key] = i.data[f.key];
  const cc = [...new Set((i.ccUserIds ?? []).filter((x) => x !== u.id))];
  if (id) {
    const r = await sql`update approval_requests set form_id = ${form.id}, data = ${sql.json(data as never)}, line_id = ${i.lineId ?? null}, cc_user_ids = ${cc}::uuid[], updated_at = now() where id = ${id} and tenant = ${t} and requester_id = ${u.id} and status = 'draft' returning id`;
    if (!r.length) throw notFound('임시 저장이 없습니다');
    return { id };
  }
  const [r] = await sql<{ id: string }[]>`insert into approval_requests (tenant, kind, form_id, task_id, requester_id, data, status, line_id, cc_user_ids) values (${t}, ${form.kind}, ${form.id}, null, ${u.id}, ${sql.json(data as never)}, 'draft', ${i.lineId ?? null}, ${cc}::uuid[]) returning id`;
  return { id: r.id };
}
export async function deleteDraft(u: SessionUser, id: string) {
  const r = await db()`delete from approval_requests where id = ${id} and tenant = ${tenantOf(u)} and requester_id = ${u.id} and status = 'draft' returning id`;
  if (!r.length) throw notFound('임시 저장이 없습니다');
  return { ok: true };
}
/** 최종 승인·반려 뒤 — approvals.decide 트랜잭션 안에서 호출. 휴가 승인이면 요청자 개인 캘린더에 부재 일정 */
export async function onApprovalTaskDecided(tx: Sql, taskId: string, status: 'approved' | 'rejected', actorId: string) {
  const [r] = await tx<any[]>`select * from approval_requests where task_id = ${taskId} and status = 'pending'`;
  if (!r) return null;
  let eventId: string | null = null;
  if (status === 'approved' && r.kind === 'leave') {
    const p = r.data?.period as { from: string; to: string } | undefined; const kindLabel = String(r.data?.leave_type ?? '연차');
    const [cal] = await tx<{ id: string }[]>`select id from calendars where type = 'personal' and owner_user_id = ${r.requester_id} limit 1`;
    const [who] = await tx<{ name: string }[]>`select name from users where id = ${r.requester_id}`;
    if (p && cal) {
      const half = kindLabel.startsWith('반차');
      const start = half ? `${p.from}T${kindLabel.includes('오후') ? '13:00' : '09:00'}:00+09:00` : `${p.from}T00:00:00+09:00`;
      const endDay = new Date(`${p.to}T00:00:00+09:00`); endDay.setUTCDate(endDay.getUTCDate() + 1);
      const end = half ? `${p.from}T${kindLabel.includes('오후') ? '18:00' : '13:00'}:00+09:00` : endDay.toISOString();
      const [e] = await tx<{ id: string }[]>`insert into events (calendar_id, title, kind, all_day, start_at, end_at, created_by, description)
        values (${cal.id}, ${`${kindLabel} (${who?.name ?? ''})`}, ${half ? 'half_day' : 'vacation'}, ${!half}, ${start}, ${end}, ${r.requester_id}, ${'결재 승인으로 자동 등록'}) returning id`;
      eventId = e.id;
    }
  }
  const [rej] = status === 'rejected' ? await tx<{ comment: string | null }[]>`select comment from task_approvals where task_id = ${taskId} and status = 'rejected' order by round desc, step desc limit 1` : [];
  await tx`update approval_requests set status = ${status}, decided_at = now(), event_id = ${eventId}, reject_reason = ${rej?.comment ?? null}, updated_at = now() where id = ${r.id}`;
  await audit(tx, actorId, `approval_request.${status}`, 'approval_request', r.id, { kind: r.kind, eventId }, null);
  return { id: r.id, eventId };
}
/** 지금 결재할 차례인 단계가 이 사용자 것인지(지정 사용자·역할: 대표/관리자 전사, 현장장·부서장은 업무 조직과 상위 조직 소속)
 *  #429 대결: 오늘 부재 중인 결재자가 이 사용자를 대리인으로 정했으면 그 결재자 차례도 이 사용자 것 */
function approverCond(sql: Sql, u: SessionUser) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const holder = (uid: any, role: any) => sql`((a.approver_type = 'user' and a.approver_user_id = ${uid})
      or (a.approver_type = 'role' and ((a.approver_role = 'owner' and ${role} = 'owner') or (a.approver_role = 'admin' and ${role} in ('owner', 'admin'))
        or (a.approver_role in ('site_manager', 'dept_lead') and a.approver_role = ${role} and exists (
          with recursive up as (select id, parent_id from org_units where id = tk.org_unit_id union select o.id, o.parent_id from org_units o join up on o.id = up.parent_id)
          select 1 from memberships m where m.user_id = ${uid} and m.org_unit_id in (select id from up))))))`;
  return sql`exists (select 1 from task_approvals a where a.task_id = r.task_id and a.status = 'pending' and a.round = (select max(round) from task_approvals where task_id = r.task_id)
    and (${holder(u.id, u.role)} or exists (select 1 from user_settings s join users x on x.id = s.user_id where s.away_deputy_id = ${u.id} and s.away_from <= ${today} and s.away_to >= ${today}
      and x.status = 'active' and x.tenant = r.tenant and ${holder(sql`x.id`, sql`x.role`)})))`;
}
/** 목록 — view: todo(내가 결재할 것) · mine(내가 올린 것, 임시 저장 포함) · cc(참조) · all(관리자 전체). 예전 ?mine=1 은 mine 과 같다 */
export async function listRequests(u: SessionUser, f: { kind?: string; mine?: boolean; status?: string; month?: string; view?: string } = {}) {
  const sql = db(); const t = tenantOf(u);
  const admin = isAdmin(u);
  const view = f.view ?? (f.mine ? 'mine' : admin ? 'all' : 'related');
  const scope = view === 'todo' ? approverCond(sql, u)
    : view === 'mine' ? sql`r.requester_id = ${u.id}`
    : view === 'cc' ? sql`${u.id}::uuid = any(r.cc_user_ids)`
    : view === 'all' && admin ? sql`true`
    : sql`(r.requester_id = ${u.id} or ${u.id}::uuid = any(r.cc_user_ids) or exists (select 1 from task_approvals a where a.task_id = r.task_id and a.status in ('pending', 'approved', 'rejected') and a.approver_user_id = ${u.id}) or ${approverCond(sql, u)})`;
  const rows = await sql<any[]>`select r.id, r.kind, r.data, r.amount, r.status, r.decided_at, r.created_at, r.updated_at, r.task_id, r.event_id, r.doc_no, r.cc_user_ids, r.reject_reason, r.line_id, r.form_id, us.name as requester_name,
      coalesce(tk.title, '') as title, tk.status as task_status,
      (select json_agg(json_build_object('label', a.label, 'status', a.status, 'by', d.name, 'at', a.decided_at, 'comment', a.comment) order by a.step) from task_approvals a left join users d on d.id = a.decided_by where a.task_id = r.task_id and a.round = (select max(round) from task_approvals where task_id = r.task_id)) as steps,
      (select json_build_object('label', a.label, 'step', a.step, 'since', coalesce((select max(p.decided_at) from task_approvals p where p.task_id = a.task_id and p.round = a.round and p.step < a.step), r.created_at))
        from task_approvals a where a.task_id = r.task_id and a.status = 'pending' and a.round = (select max(round) from task_approvals where task_id = r.task_id) limit 1) as stuck,
      ${approverCond(sql, u)} as my_turn
    from approval_requests r join users us on us.id = r.requester_id left join tasks tk on tk.id = r.task_id
    where r.tenant = ${t} ${f.kind ? sql`and r.kind = ${f.kind}` : sql``} ${f.status ? sql`and r.status = ${f.status}` : sql``} ${f.month ? sql`and to_char(r.created_at at time zone 'Asia/Seoul', 'YYYY-MM') = ${f.month}` : sql``}
      and ${view === 'mine' ? sql`true` : sql`r.status <> 'draft'`} and ${scope}
    order by (r.status = 'draft') desc, r.created_at desc limit 200`;
  const [c] = await sql<{ todo: number; mine: number; cc: number }[]>`select
      (select count(*)::int from approval_requests r join tasks tk on tk.id = r.task_id where r.tenant = ${t} and r.status = 'pending' and ${approverCond(sql, u)}) as todo,
      (select count(*)::int from approval_requests r where r.tenant = ${t} and r.requester_id = ${u.id} and r.status in ('pending', 'draft')) as mine,
      (select count(*)::int from approval_requests r where r.tenant = ${t} and r.status = 'pending' and ${u.id}::uuid = any(r.cc_user_ids)) as cc`;
  return { requests: rows, isAdmin: admin, view, counts: c };
}
/** #114 ⑦ 휴대폰 상단 '결재할 것 n건' — 알림 폴링(/api/notifications?unread=1)에 실어 보낸다 */
export async function todoCount(sql: Sql, u: SessionUser) {
  const [c] = await sql<{ n: number }[]>`select count(*)::int n from approval_requests r join tasks tk on tk.id = r.task_id where r.tenant = ${tenantOf(u)} and r.status = 'pending' and ${approverCond(sql, u)}`;
  return c.n;
}
export async function exportRequests(u: SessionUser, kind: string, month: string) {
  if (!isAdmin(u)) throw forbidden('결재 내역 내려받기는 관리자만');
  const { requests } = await listRequests(u, { kind, month, view: 'all' });
  const { writeXlsx } = await import('./xlsx');
  const { forms } = await listForms(u);
  const fields = forms.find((f) => f.kind === kind)?.fields ?? DEFAULT_FIELDS[kind as Kind] ?? [];
  const head = ['문서번호', '신청일', '신청자', '상태', '결재', ...fields.filter((f) => f.type !== 'file').map((f) => f.label), ...(kind === 'expense' ? ['금액 합계'] : [])];
  const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(d));
  const rows = requests.map((r) => [r.doc_no ?? '', fmt(r.created_at), r.requester_name, r.status === 'approved' ? '승인' : r.status === 'rejected' ? '반려' : '진행', (r.steps ?? []).map((s: any) => `${s.label}:${s.status === 'approved' ? '승인' : s.status === 'rejected' ? '반려' : '대기'}`).join(' / '),
    ...fields.filter((f) => f.type !== 'file').map((f) => { const v = r.data?.[f.key]; return v === undefined ? '' : f.type === 'daterange' ? `${v.from}~${v.to}` : f.type === 'number' ? Number(v) : String(v); })]);
  if (kind === 'expense') rows.push(['', '', '', '승인 합계', '', ...fields.filter((f) => f.type !== 'file').map(() => ''), requests.filter((r) => r.status === 'approved').reduce((n, r) => n + Number(r.amount ?? 0), 0)]);
  return { fileName: `${KIND_LABEL[kind] ?? kind}_${month}.xlsx`, data: writeXlsx([{ name: KIND_LABEL[kind] ?? kind, rows: [head, ...rows] }]) };
}
