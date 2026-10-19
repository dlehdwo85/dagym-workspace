// V30 ④ 결재 양식: 휴가·지출결의·일반 품의 — 회사가 칸을 고치는 간단 양식(필드 빌더) + 요청 = 결재 업무(기존 결재선·결재 회차 그대로).
// 휴가 최종 승인 → 요청자 개인 캘린더에 연차/반차/병가 일정(부재) 자동 등록, 지출결의는 승인 건 엑셀 내보내기. 다른 회사 404.
import { z } from 'zod';
import { db, type Sql } from './db';
import { badRequest, forbidden, notFound } from './errors';
import { isAdmin, denyDemo } from './access';
import { audit } from './log';
import { tenantOf, type SessionUser } from './types';

export type Field = { key: string; label: string; type: 'text' | 'number' | 'date' | 'daterange' | 'select' | 'textarea' | 'file'; required?: boolean; options?: string[]; hint?: string };
export const fieldInput = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/, '영문 소문자 키'), label: z.string().trim().min(1).max(40), type: z.enum(['text', 'number', 'date', 'daterange', 'select', 'textarea', 'file']), required: z.boolean().optional(), options: z.array(z.string().trim().min(1).max(40)).max(20).optional(), hint: z.string().trim().max(120).optional() });
export const formInput = z.object({ kind: z.enum(['leave', 'expense', 'general']), name: z.string().trim().min(1).max(60), fields: z.array(fieldInput).min(1).max(20), lineId: z.string().uuid().nullable().optional(), active: z.boolean().optional() });
export const requestInput = z.object({ kind: z.enum(['leave', 'expense', 'general']), formId: z.string().uuid().optional(), data: z.record(z.unknown()), lineId: z.string().uuid().optional() });
export const KIND_LABEL: Record<string, string> = { leave: '휴가', expense: '지출결의', general: '품의' };

/** 회사가 아직 안 고친 기본 양식 */
export const DEFAULT_FIELDS: Record<'leave' | 'expense' | 'general', Field[]> = {
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
};
const DEFAULT_NAME: Record<string, string> = { leave: '휴가 신청', expense: '지출결의서', general: '일반 품의서' };

const canEditForms = async (u: SessionUser) => isAdmin(u) || (await import('./menuPerms')).RANK[await (await import('./menuPerms')).menuLevel(u, 'ops')] >= 2;

/** 양식 목록(없는 종류는 기본 양식으로 채워서 보여 줌) */
export async function listForms(u: SessionUser) {
  const sql = db(); const t = tenantOf(u);
  const rows = await sql<any[]>`select f.id, f.kind, f.name, f.fields, f.line_id, f.active, l.name as line_name from approval_forms f left join approval_lines l on l.id = f.line_id where f.tenant = ${t} order by f.kind, f.created_at`;
  const forms = (['leave', 'expense', 'general'] as const).flatMap((k) => {
    const mine = rows.filter((r) => r.kind === k && r.active);
    return mine.length ? mine.map((r) => ({ id: r.id, kind: r.kind, name: r.name, fields: r.fields as Field[], lineId: r.line_id, lineName: r.line_name, isDefault: false })) : [{ id: null, kind: k, name: DEFAULT_NAME[k], fields: DEFAULT_FIELDS[k], lineId: null, lineName: null, isDefault: true }];
  });
  const lines = await sql<{ id: string; name: string; active: boolean }[]>`select id, name, active from approval_lines where (tenant = ${t} or org_unit_id in (select id from org_units where tenant = ${t})) and active order by name`;
  return { forms, lines, canEdit: await canEditForms(u) };
}
export async function saveForm(u: SessionUser, id: string | null, i: z.infer<typeof formInput>, ip: string | null) {
  if (!(await canEditForms(u))) throw forbidden('결재 양식은 운영 상태 편집 권한(대표·관리자)만 고칠 수 있습니다');
  const sql = db(); const t = tenantOf(u);
  if (new Set(i.fields.map((f) => f.key)).size !== i.fields.length) throw badRequest('칸 키가 겹칩니다');
  if (i.lineId) { const [l] = await sql`select 1 from approval_lines where id = ${i.lineId}`; if (!l) throw notFound('결재선이 없습니다'); }
  let fid = id;
  if (id) {
    const r = await sql`update approval_forms set name = ${i.name}, fields = ${sql.json(i.fields as never)}, line_id = ${i.lineId ?? null}, active = ${i.active ?? true}, updated_at = now() where id = ${id} and tenant = ${t} returning id`;
    if (!r.length) throw notFound('양식이 없습니다');
  } else { const [r] = await sql<{ id: string }[]>`insert into approval_forms (tenant, kind, name, fields, line_id, created_by) values (${t}, ${i.kind}, ${i.name}, ${sql.json(i.fields as never)}, ${i.lineId ?? null}, ${u.id}) returning id`; fid = r.id; }
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
  return `[품의] ${who} ${data.subject ?? ''}`.trim();
}
const describe = (fields: Field[], data: Record<string, unknown>) => fields.map((f) => { const v = data[f.key]; if (v === undefined || v === '') return null; const s = f.type === 'daterange' ? `${(v as any).from} ~ ${(v as any).to}` : f.type === 'number' ? Number(v).toLocaleString('ko-KR') : String(v); return `${f.label}: ${s}`; }).filter(Boolean).join('\n');

/** 결재 요청 만들기 = 결재 업무(검토 요청 상태) — 결재선: 양식 기본 → 지정 → 요청자 조직에 맞는 활성 결재선 1개 */
export async function createRequest(u: SessionUser, i: z.infer<typeof requestInput>, ip: string | null) {
  denyDemo(u);
  const sql = db(); const t = tenantOf(u);
  const { forms } = await listForms(u);
  const form = i.formId ? forms.find((f) => f.id === i.formId) : forms.find((f) => f.kind === i.kind);
  if (!form || form.kind !== i.kind) throw notFound('양식이 없습니다');
  const data = validate(form.fields, i.data);
  // 요청자 조직: 소속 첫 조직, 없으면 본사
  const [m] = await sql<{ org_unit_id: string }[]>`select m.org_unit_id from memberships m join org_units o on o.id = m.org_unit_id where m.user_id = ${u.id} and o.tenant = ${t} order by o.type = 'hq' desc limit 1`;
  const [hq] = await sql<{ id: string }[]>`select id from org_units where tenant = ${t} and type = 'hq' order by created_at limit 1`;
  const orgUnitId = m?.org_unit_id ?? hq?.id;
  if (!orgUnitId) throw badRequest('소속 조직이 없습니다');
  let lineId = i.lineId ?? form.lineId ?? null;
  if (!lineId) {
    const [l] = await sql<{ id: string }[]>`with recursive up as (select id, parent_id from org_units where id = ${orgUnitId} union select o.id, o.parent_id from org_units o join up on o.id = up.parent_id)
      select l.id from approval_lines l where l.active and (l.org_unit_id in (select id from up) or (l.org_unit_id is null and l.tenant = ${t})) order by l.org_unit_id nulls last limit 1`;
    lineId = l?.id ?? null;
  }
  if (!lineId) throw badRequest('결재선이 없습니다 — 관리자가 운영 상태 › 결재선에서 먼저 만들어 주세요');
  const title = summarize(form.kind, form.fields, data, u.name);
  const { createTask, updateTask } = await import('./tasks');
  const period = data.period as { from: string; to: string } | undefined;
  const task: any = await createTask(u, { orgUnitId, title, description: describe(form.fields, data), assigneeId: u.id, requestedById: u.id, taskType: 'approval', approvalRequired: true, approvalLineId: lineId,
    dueDate: form.kind === 'leave' && period ? period.from : (data.due as string | undefined) ?? (data.used_on as string | undefined) ?? null, tags: ['결재', KIND_LABEL[form.kind]], showOnCalendar: false } as any);
  const taskId = task.id as string;
  const amount = typeof data.amount === 'number' ? data.amount : null;
  const [r] = await sql<{ id: string }[]>`insert into approval_requests (tenant, kind, form_id, task_id, requester_id, data, amount) values (${t}, ${form.kind}, ${form.id}, ${taskId}, ${u.id}, ${sql.json(data as never)}, ${amount}) returning id`;
  await updateTask(u, taskId, { status: 'review' } as any); // 검토 요청 → 결재 회차 시작·1단계 결재자 알림
  await audit(sql, u.id, 'approval_request.create', 'approval_request', r.id, { kind: form.kind, taskId }, ip);
  return { id: r.id, taskId, title, link: `/tasks/${taskId}`, needsFile: form.fields.some((f) => f.type === 'file' && f.required) };
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
  await tx`update approval_requests set status = ${status}, decided_at = now(), event_id = ${eventId} where id = ${r.id}`;
  await audit(tx, actorId, `approval_request.${status}`, 'approval_request', r.id, { kind: r.kind, eventId }, null);
  return { id: r.id, eventId };
}
export async function listRequests(u: SessionUser, f: { kind?: string; mine?: boolean; status?: string; month?: string } = {}) {
  const sql = db(); const t = tenantOf(u);
  const admin = isAdmin(u);
  const rows = await sql<any[]>`select r.id, r.kind, r.data, r.amount, r.status, r.decided_at, r.created_at, r.task_id, r.event_id, us.name as requester_name, tk.title, tk.status as task_status,
      (select json_agg(json_build_object('label', a.label, 'status', a.status, 'by', d.name, 'at', a.decided_at) order by a.step) from task_approvals a left join users d on d.id = a.decided_by where a.task_id = r.task_id and a.round = (select max(round) from task_approvals where task_id = r.task_id)) as steps
    from approval_requests r join users us on us.id = r.requester_id join tasks tk on tk.id = r.task_id
    where r.tenant = ${t} ${f.kind ? sql`and r.kind = ${f.kind}` : sql``} ${f.status ? sql`and r.status = ${f.status}` : sql``} ${f.month ? sql`and to_char(r.created_at at time zone 'Asia/Seoul', 'YYYY-MM') = ${f.month}` : sql``}
      and (${admin || !!f.mine} and (${admin} or r.requester_id = ${u.id}) or exists (select 1 from task_approvals a where a.task_id = r.task_id and a.status in ('pending', 'approved', 'rejected') and (a.approver_user_id = ${u.id}))
        or r.requester_id = ${u.id})
    order by r.created_at desc limit 200`;
  return { requests: rows, isAdmin: admin };
}
export async function exportRequests(u: SessionUser, kind: string, month: string) {
  if (!isAdmin(u)) throw forbidden('결재 내역 내려받기는 관리자만');
  const { requests } = await listRequests(u, { kind, month });
  const { writeXlsx } = await import('./xlsx');
  const { forms } = await listForms(u);
  const fields = forms.find((f) => f.kind === kind)?.fields ?? DEFAULT_FIELDS[kind as 'leave'] ?? [];
  const head = ['신청일', '신청자', '상태', '결재', ...fields.filter((f) => f.type !== 'file').map((f) => f.label), ...(kind === 'expense' ? ['금액 합계'] : [])];
  const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(d));
  const rows = requests.map((r) => [fmt(r.created_at), r.requester_name, r.status === 'approved' ? '승인' : r.status === 'rejected' ? '반려' : '진행', (r.steps ?? []).map((s: any) => `${s.label}:${s.status === 'approved' ? '승인' : s.status === 'rejected' ? '반려' : '대기'}`).join(' / '),
    ...fields.filter((f) => f.type !== 'file').map((f) => { const v = r.data?.[f.key]; return v === undefined ? '' : f.type === 'daterange' ? `${v.from}~${v.to}` : f.type === 'number' ? Number(v) : String(v); })]);
  if (kind === 'expense') rows.push(['', '', '승인 합계', '', ...fields.filter((f) => f.type !== 'file').map(() => ''), requests.filter((r) => r.status === 'approved').reduce((n, r) => n + Number(r.amount ?? 0), 0)]);
  return { fileName: `${KIND_LABEL[kind] ?? kind}_${month}.xlsx`, data: writeXlsx([{ name: KIND_LABEL[kind] ?? kind, rows: [head, ...rows] }]) };
}
