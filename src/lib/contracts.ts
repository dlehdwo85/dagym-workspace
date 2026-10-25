// 대표 10/20 20:00 ④ (#116) 전자계약서 1차 — 관리 › 사용자 관리 '전자계약서 발송'.
// 서식 2종 기본(근로계약서·비밀유지서약서) + 회사 서식, 직원 초대와 함께 또는 따로 발송(메일 링크 + 접속 코드는 문자로 넘기거나 메일),
// 가입 없이 서명(그리기·도장 이미지), 서명자 여럿·순서, 완료 PDF 를 자료실(인사/전자계약서, 기밀)에 보관, 감사 추적(참여자·시각·IP·기기). PASS 본인인증은 2차.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { db, type Sql } from './db';
import { badRequest, conflict, forbidden, notFound, HttpError } from './errors';
import { audit } from './log';
import { notify } from './notifications';
import { tenantOf, type SessionUser } from './types';
import { zUuid } from './api';
import { newToken, sha256 } from './crypto';
import { appUrl, sendMail } from './mail';
import { getObject, objectSize, putObject, uploadTargetFor } from './storage';
import { renderContractPdf, renderFieldsPdf, ROLE_LABEL, unrotatePdf } from './contractPdf';

export type TField = { key: string; label: string; type: 'text' | 'date' | 'number' | 'textarea'; required?: boolean; hint?: string };
export const tfieldInput = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/, '영문 소문자 키'), label: z.string().trim().min(1).max(40), type: z.enum(['text', 'date', 'number', 'textarea']), required: z.boolean().optional(), hint: z.string().trim().max(120).optional() });
export const templateInput = z.object({ kind: z.enum(['employment', 'nda', 'custom']), name: z.string().trim().min(1).max(60), body: z.string().trim().min(10).max(40000), fields: z.array(tfieldInput).max(30), active: z.boolean().optional() });
export const signerInput = z.object({ role: z.enum(['employee', 'company', 'witness', 'party']), name: z.string().trim().min(1).max(60), email: z.string().trim().email().optional(), phone: z.string().trim().max(30).optional(), userId: zUuid.optional(), ord: z.number().int().min(1).max(9).optional() });
export const contractInput = z.object({
  templateId: zUuid.optional(), kind: z.enum(['employment', 'nda', 'custom']).optional(),
  userId: zUuid.optional(),                                    // 대상 직원(초대 중 포함) — 이름·이메일 자동
  employee: z.object({ name: z.string().trim().min(1).max(60), email: z.string().trim().email().optional(), phone: z.string().trim().max(30).optional() }).optional(),
  data: z.record(z.unknown()).default({}),
  signers: z.array(signerInput).max(6).optional(),             // 비우면 [근로자 1 → 회사(나) 2]
  codeBy: z.enum(['sms', 'mail']).optional(),                  // 접속 코드 전달: 문자(관리자가 넘김, 기본)·메일
  expiresDays: z.number().int().min(1).max(90).optional(),
  send: z.boolean().optional(),                                // 기본 true. false 면 임시 저장(draft)
});
export const KIND_LABEL: Record<string, string> = { employment: '근로계약서', nda: '비밀유지서약서', custom: '기타 계약서' };
const AUTO_KEYS = ['company_name', 'company_ceo', 'company_address', 'company_biz_no', 'employee_name', 'employee_email', 'employee_phone', 'today'];

/** 기본 서식 2종 — 표준근로계약서(고용노동부 서식 항목)·비밀유지서약서. 회사가 저장하면 그 서식이 우선 */
export const DEFAULT_TEMPLATES: Record<'employment' | 'nda', { name: string; fields: TField[]; body: string }> = {
  employment: {
    name: '근로계약서',
    fields: [
      { key: 'start_date', label: '근로 시작일', type: 'date', required: true },
      { key: 'end_date', label: '근로 종료일(기간제만)', type: 'date', hint: '비우면 기간의 정함이 없는 계약' },
      { key: 'workplace', label: '근무 장소', type: 'text', required: true },
      { key: 'duties', label: '업무 내용', type: 'text', required: true },
      { key: 'work_hours', label: '소정 근로시간', type: 'text', required: true, hint: '예: 09:00~18:00 (휴게 12:00~13:00)' },
      { key: 'work_days', label: '근무일·주휴일', type: 'text', required: true, hint: '예: 주 5일(월~금), 주휴일 일요일' },
      { key: 'salary', label: '임금(월급·시급)', type: 'text', required: true, hint: '예: 월 2,800,000원 (기본급·수당 포함)' },
      { key: 'pay_day', label: '임금 지급일', type: 'text', required: true, hint: '예: 매월 25일 (근로자 계좌 입금)' },
      { key: 'extra', label: '그 밖의 약정(선택)', type: 'textarea' },
    ],
    body: `# 근로계약서

{{company_name}}(이하 "갑"이라 함)과 {{employee_name}}(이하 "을"이라 함)은 다음과 같이 근로계약을 체결한다.

# 1. 근로계약기간
{{start_date}}부터 {{end_date_or_open}}

# 2. 근무장소
{{workplace}}

# 3. 업무의 내용
{{duties}}

# 4. 소정근로시간
{{work_hours}}

# 5. 근무일 및 휴일
{{work_days}}

# 6. 임금
- 임금: {{salary}}
- 임금 지급일: {{pay_day}}
- 지급 방법: 을이 지정한 예금계좌에 입금한다.

# 7. 연차유급휴가
연차유급휴가는 근로기준법에서 정하는 바에 따라 부여한다.

# 8. 사회보험 적용
고용보험, 산재보험, 국민연금, 건강보험에 가입한다.

# 9. 근로계약서 교부
갑은 근로계약을 체결함과 동시에 본 계약서를 사본하여 을의 교부요구와 관계없이 을에게 교부한다(근로기준법 제17조 이행).

# 10. 근로계약, 취업규칙 등의 성실한 이행의무
갑과 을은 각자가 근로계약, 취업규칙, 단체협약을 지키고 성실하게 이행하여야 한다.

# 11. 기타
이 계약에 정함이 없는 사항은 근로기준법령에 의한다.
{{extra}}

{{today}}

(갑) 사업체명: {{company_name}}  대표자: {{company_ceo}}  주소: {{company_address}}  사업자등록번호: {{company_biz_no}}
(을) 성명: {{employee_name}}  연락처: {{employee_phone}}  이메일: {{employee_email}}`,
  },
  nda: {
    name: '비밀유지서약서',
    fields: [
      { key: 'effective_date', label: '서약일', type: 'date', required: true },
      { key: 'scope', label: '비밀정보의 범위(추가, 선택)', type: 'textarea', hint: '예: 고객 명단, 단가표, 영업 자료, 소스 코드' },
      { key: 'years', label: '퇴직 후 유지 기간(년)', type: 'number', required: true, hint: '예: 2' },
    ],
    body: `# 비밀유지서약서

본인 {{employee_name}}은(는) {{company_name}}(이하 "회사")에 재직하면서 알게 되는 회사의 비밀정보에 대하여 다음과 같이 서약합니다.

# 1. 비밀정보의 정의
회사의 영업·기술·경영·인사·재무에 관한 정보로서 공개되지 않은 일체의 정보(고객 및 거래처 정보, 가격·원가, 영업 전략, 제품·서비스 계획, 소스 코드와 설계 자료, 임직원 개인정보 등)를 말합니다.
{{scope}}

# 2. 비밀유지 의무
본인은 재직 중은 물론 퇴직 후 {{years}}년간 회사의 사전 서면 동의 없이 비밀정보를 제3자에게 누설하거나 업무 외의 목적으로 사용하지 않습니다.

# 3. 자료의 반환
본인은 퇴직 시 또는 회사의 요구가 있을 때 비밀정보가 담긴 모든 자료(사본·전자파일 포함)를 즉시 반환하거나 회사의 지시에 따라 폐기합니다.

# 4. 지식재산
본인이 재직 중 직무와 관련하여 만든 저작물·발명·아이디어에 관한 권리는 관련 법령 및 회사 규정에 따라 회사에 귀속됨을 확인합니다.

# 5. 위반 시 책임
본인이 이 서약을 위반하여 회사에 손해가 발생한 경우 관련 법령에 따라 민·형사상 책임을 지며 손해를 배상합니다.

{{effective_date}}

서약인: {{employee_name}}  (연락처 {{employee_phone}})
회사: {{company_name}}  대표자 {{company_ceo}}`,
  },
};

const requireEdit = (u: SessionUser) => import('./menuPerms').then((m) => m.requireMenu(u, 'admin_users', 'edit'));
const requireView = (u: SessionUser) => import('./menuPerms').then((m) => m.requireMenu(u, 'admin_users', 'view'));
const todayKst = () => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date());
const code6 = () => String(Math.floor(100000 + Math.random() * 900000));

// ---------------- 서식 ----------------
export async function listTemplates(u: SessionUser) {
  await requireView(u);
  const sql = db(); const t = tenantOf(u);
  const rows = await sql<any[]>`select id, kind, name, body, fields, active, updated_at from contract_templates where tenant = ${t} and active order by kind, created_at`;
  const out = (['employment', 'nda'] as const).flatMap((k) => {
    const mine = rows.filter((r) => r.kind === k);
    return mine.length ? mine.map((r) => ({ id: r.id, kind: r.kind, name: r.name, body: r.body, fields: r.fields as TField[], isDefault: false })) : [{ id: null, kind: k, name: DEFAULT_TEMPLATES[k].name, body: DEFAULT_TEMPLATES[k].body, fields: DEFAULT_TEMPLATES[k].fields, isDefault: true }];
  });
  for (const r of rows.filter((r) => r.kind === 'custom')) out.push({ id: r.id, kind: 'custom', name: r.name, body: r.body, fields: r.fields as TField[], isDefault: false });
  return { templates: out, placeholders: AUTO_KEYS };
}
export async function saveTemplate(u: SessionUser, id: string | null, i: z.infer<typeof templateInput>, ip: string | null) {
  await requireEdit(u);
  const sql = db(); const t = tenantOf(u);
  if (new Set(i.fields.map((f) => f.key)).size !== i.fields.length) throw badRequest('칸 키가 겹칩니다');
  let tid = id;
  if (id) {
    const r = await sql`update contract_templates set name = ${i.name}, body = ${i.body}, fields = ${sql.json(i.fields as never)}, active = ${i.active ?? true}, updated_at = now() where id = ${id} and tenant = ${t} returning id`;
    if (!r.length) throw notFound('서식이 없습니다');
  } else { const [r] = await sql<{ id: string }[]>`insert into contract_templates (tenant, kind, name, body, fields, created_by) values (${t}, ${i.kind}, ${i.name}, ${i.body}, ${sql.json(i.fields as never)}, ${u.id}) returning id`; tid = r.id; }
  await audit(sql, u.id, 'contract_template.save', 'contract_template', tid, { kind: i.kind, name: i.name }, ip);
  return { id: tid };
}

// ---------------- 만들기·보내기 ----------------
function fill(body: string, vars: Record<string, string>) {
  return body.replace(/\{\{([a-z0-9_]+)\}\}/g, (_, k) => vars[k] ?? '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
}
async function docNo(sql: Sql, t: string) {
  const year = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date());
  await sql`select pg_advisory_xact_lock(hashtext(${`contract_doc_no:${t}:${year}`}))`;
  const [{ n }] = await sql<{ n: number }[]>`select coalesce(max(substring(doc_no from '\\d+$')::int), 0) + 1 as n from contracts where tenant = ${t} and doc_no like ${`계약-${year}-%`}`;
  return `계약-${year}-${String(n).padStart(4, '0')}`;
}
async function companyOf(sql: Sql, t: string) {
  const [c] = await sql<{ name: string; ceo: string | null; address: string | null; biz_no: string | null }[]>`select name, ceo, address, biz_no from company_profiles where tenant = ${t} order by is_default desc, key limit 1`;
  if (c) return c;
  const [tn] = await sql<{ name: string }[]>`select name from tenants where id = ${t}`.catch(() => [] as any);
  return { name: tn?.name ?? '회사', ceo: null, address: null, biz_no: null };
}
const event = (sql: Sql, contractId: string, type: string, o: { signerId?: string | null; actorUserId?: string | null; ip?: string | null; ua?: string | null; detail?: unknown } = {}) =>
  sql`insert into contract_events (contract_id, signer_id, actor_user_id, type, detail, ip, user_agent) values (${contractId}, ${o.signerId ?? null}, ${o.actorUserId ?? null}, ${type}, ${o.detail ? sql.json(o.detail as never) : null}, ${o.ip ?? null}, ${(o.ua ?? '').slice(0, 300) || null})`;

/** 서명 링크·접속 코드 새로 발급(원문은 이 응답에만 — 저장은 해시) */
async function issue(sql: Sql, signerId: string) {
  const token = newToken(24), code = code6();
  await sql`update contract_signers set token_hash = ${sha256(token)}, code_hash = ${sha256(code)}, code_attempts = 0, status = case when status = 'locked' then 'pending' else status end where id = ${signerId}`;
  return { token, code, link: `${appUrl()}/sign/${token}` };
}
type SignerRow = { id: string; contract_id: string; ord: number; role: string; name: string; email: string | null; phone: string | null; user_id: string | null; status: string; code_attempts: number; code_hash: string; signed_at: Date | null; sign_method: string | null; signature_png: Buffer | null; decline_reason: string | null; opened_at: Date | null; ip: string | null; user_agent: string | null };
type ContractRow = { id: string; tenant: string; kind: string; title: string; doc_no: string | null; body: string; data: any; user_id: string | null; status: string; code_by: string; file_id: string | null; expires_at: Date | null; completed_at: Date | null; created_by: string | null; created_at: Date;
  /** 2차: 올린 원본 PDF(없으면 1차 텍스트 서식) */ source_key?: string | null; page_count?: number | null; original_sha256?: string | null; message?: string | null };

/** 이번 순서(ord) 서명자에게 메일(링크) + 코드(메일이면 두 번째 메일). 문자 전달용 문구를 돌려준다 */
async function sendOrd(sql: Sql, c: ContractRow, ord: number, resend = false) {
  const signers = await sql<SignerRow[]>`select * from contract_signers where contract_id = ${c.id} and ord = ${ord} and status = 'pending'`;
  const company = await companyOf(sql, c.tenant);
  const out: { signerId: string; name: string; role: string; email: string | null; phone: string | null; link: string; code: string; mail: 'sent' | 'dev' | 'none' | 'failed'; smsText: string }[] = [];
  for (const s of signers) {
    const { token, code, link } = await issue(sql, s.id);
    let mail: 'sent' | 'dev' | 'none' | 'failed' = 'none';
    if (s.email) {
      try {
        mail = await sendMail(s.email, `[${company.name}] ${c.title} 서명 요청`, `${s.name}님, ${company.name}에서 보낸 "${c.title}" 에 전자서명해 주세요.\n${c.message ? `\n전하는 말: ${c.message}\n` : ''}\n서명 링크: ${link}\n${c.code_by === 'mail' ? `접속 코드: ${code}\n` : '접속 코드(6자리)는 담당자가 문자로 따로 보내 드립니다.\n'}\n링크는 ${c.expires_at ? new Date(c.expires_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : '기한'}까지 유효하며, 본인만 열어 주세요. 문의: ${company.name}`);
      } catch { mail = 'failed'; }
    }
    await event(sql, c.id, resend ? 'resent' : 'sent', { signerId: s.id, detail: { mail, codeBy: c.code_by } });
    out.push({ signerId: s.id, name: s.name, role: s.role, email: s.email, phone: s.phone, link, code, mail, smsText: `[${company.name}] ${c.title} 전자서명 요청\n링크: ${link}\n접속 코드: ${code}` });
  }
  return out;
}

export async function createContract(u: SessionUser, i: z.infer<typeof contractInput>, ip: string | null) {
  await requireEdit(u);
  if (u.isDemo) throw forbidden('체험 계정에서는 쓸 수 없습니다');
  const sql = db(); const t = tenantOf(u);
  const { templates } = await listTemplates(u);
  const tpl = i.templateId ? templates.find((x) => x.id === i.templateId) : templates.find((x) => x.kind === (i.kind ?? 'employment'));
  if (!tpl) throw notFound('서식이 없습니다');
  let emp = i.employee ? { name: i.employee.name, email: i.employee.email ?? null, phone: i.employee.phone ?? null, userId: null as string | null } : null;
  if (i.userId) {
    const [usr] = await sql<{ id: string; name: string; email: string; phone: string | null; tenant: string }[]>`select id, name, email, phone, tenant from users where id = ${i.userId} and tenant = ${t}`;
    if (!usr) throw notFound('사용자가 없습니다');
    emp = { name: i.employee?.name ?? usr.name, email: i.employee?.email ?? usr.email, phone: i.employee?.phone ?? usr.phone, userId: usr.id };
  }
  if (!emp) throw badRequest('대상 직원(userId 또는 employee)을 지정하세요');
  // 칸 검사
  const data: Record<string, string> = {};
  for (const f of tpl.fields) {
    const v = i.data[f.key]; const s = v === undefined || v === null ? '' : String(v).trim();
    if (f.required && !s) throw badRequest(`"${f.label}" 을(를) 채워 주세요`);
    if (s && f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw badRequest(`"${f.label}" 날짜 형식이 아닙니다`);
    if (s && f.type === 'number' && !Number.isFinite(Number(s))) throw badRequest(`"${f.label}" 은(는) 숫자여야 합니다`);
    data[f.key] = s.slice(0, f.type === 'textarea' ? 4000 : 300);
  }
  const company = await companyOf(sql, t);
  const vars: Record<string, string> = { ...data, company_name: company.name, company_ceo: company.ceo ?? '', company_address: company.address ?? '', company_biz_no: company.biz_no ?? '', employee_name: emp.name, employee_email: emp.email ?? '', employee_phone: emp.phone ?? '', today: todayKst(),
    end_date_or_open: data.end_date ? `${data.end_date}까지` : '기간의 정함이 없음' };
  const body = fill(tpl.body, vars);
  const title = `${tpl.name} — ${emp.name}`;
  // 서명자: 기본 [근로자(1) → 회사=나(2)]
  const signers = (i.signers?.length ? i.signers : [{ role: 'employee' as const, name: emp.name, email: emp.email ?? undefined, phone: emp.phone ?? undefined, userId: emp.userId ?? undefined, ord: 1 }, { role: 'company' as const, name: u.name, email: u.email, userId: u.id, ord: 2 }])
    .map((s, n) => ({ ...s, ord: s.ord ?? n + 1 }));
  if (!signers.some((s) => s.role === 'employee')) throw badRequest('근로자 서명자가 필요합니다');
  if (signers.some((s) => !s.email && !s.phone)) throw badRequest('서명자마다 이메일 또는 전화번호가 필요합니다');
  const send = i.send ?? true;
  const r = await sql.begin(async (tx) => {
    const no = await docNo(tx, t);
    const [c] = await tx<ContractRow[]>`insert into contracts (tenant, template_id, kind, title, doc_no, body, data, user_id, status, code_by, expires_at, created_by)
      values (${t}, ${tpl.id}, ${tpl.kind}, ${title}, ${no}, ${body}, ${tx.json(data as never)}, ${emp.userId}, ${send ? 'sent' : 'draft'}, ${i.codeBy ?? 'sms'}, now() + make_interval(days => ${i.expiresDays ?? 14}), ${u.id}) returning *`;
    for (const s of signers) await tx`insert into contract_signers (contract_id, ord, role, name, email, phone, user_id, token_hash, code_hash) values (${c.id}, ${s.ord}, ${s.role}, ${s.name}, ${s.email ?? null}, ${s.phone ?? null}, ${s.userId ?? null}, ${sha256(newToken(24))}, ${sha256(code6())})`;
    await event(tx, c.id, 'created', { actorUserId: u.id, ip, detail: { kind: tpl.kind, signers: signers.length } });
    const delivery = send ? await sendOrd(tx, c, Math.min(...signers.map((s) => s.ord))) : [];
    await audit(tx, u.id, 'contract.create', 'contract', c.id, { kind: tpl.kind, docNo: no, userId: emp.userId, send }, ip);
    return { id: c.id, docNo: no, title, status: c.status, delivery };
  });
  return r;
}

/** 2차(글로싸인 레퍼런스) 상태 바구니: 내 서명 필요(내 차례) · 상대 서명 필요(진행 중, 내 차례 아님) · 작성 중 · 완료 · 취소·거절·만료 */
export const BUCKETS = ['mine', 'others', 'draft', 'done', 'closed'] as const;
const bucketOf = (r: { status: string; signers: { userId: string | null; ord: number; status: string }[] | null }, me: string) => {
  if (r.status === 'draft') return 'draft';
  if (r.status === 'completed') return 'done';
  if (!['sent', 'partially_signed'].includes(r.status)) return 'closed';
  const ss = r.signers ?? [];
  return ss.some((s) => s.userId === me && s.status === 'pending' && !ss.some((x) => x.ord < s.ord && x.status !== 'signed')) ? 'mine' : 'others';
};
export async function listContracts(u: SessionUser, f: { userId?: string; status?: string; bucket?: string } = {}) {
  await requireView(u);
  const sql = db(); const t = tenantOf(u);
  const rows = await sql<any[]>`select c.id, c.kind, c.title, c.doc_no, c.status, c.user_id, c.file_id, c.expires_at, c.completed_at, c.created_at, c.created_by, cb.name as created_by_name, (c.source_key is not null) as is_pdf, c.page_count,
      (select json_agg(json_build_object('id', s.id, 'ord', s.ord, 'role', s.role, 'name', s.name, 'status', s.status, 'signedAt', s.signed_at, 'userId', s.user_id, 'openedAt', s.opened_at) order by s.ord, s.created_at) from contract_signers s where s.contract_id = c.id) as signers
    from contracts c left join users cb on cb.id = c.created_by
    where c.tenant = ${t} ${f.userId ? sql`and c.user_id = ${f.userId}` : sql``} ${f.status ? sql`and c.status = ${f.status}` : sql``} order by c.created_at desc limit 300`;
  const all = rows.map((r) => ({ ...r, bucket: bucketOf(r, u.id) }));
  const counts = Object.fromEntries(BUCKETS.map((b) => [b, all.filter((r) => r.bucket === b).length]));
  return { contracts: f.bucket && (BUCKETS as readonly string[]).includes(f.bucket) ? all.filter((r) => r.bucket === f.bucket) : all, counts };
}

// ---------------- 2차: 올린 계약서(PDF·사진) 위에 서명자별 칸 — 글로싸인 레퍼런스(docs/handoff/ECONTRACT_GLOSIGN_REFERENCE_2026-10-23.md) ----------------
const MAX_SRC = 20 * 1024 * 1024;
export const sourceUploadInput = z.object({ fileName: z.string().trim().min(1).max(200), mime: z.string().max(100), size: z.number().int().positive() });
/** 계약서 원본 올릴 주소 — PDF·사진(png·jpg) 20MB. 한글·워드는 PDF 로 저장해 올리도록 안내 */
export async function contractUploadTarget(u: SessionUser, i: z.infer<typeof sourceUploadInput>) {
  await requireEdit(u);
  if (!/^(application\/pdf|image\/(png|jpeg))$/.test(i.mime)) throw badRequest('PDF 또는 사진(png·jpg)만 올릴 수 있습니다 — 한글·워드 문서는 PDF로 저장해 올려 주세요');
  if (i.size > MAX_SRC) throw badRequest('계약서 파일은 20MB까지입니다');
  const key = `contract/${tenantOf(u)}/${crypto.randomUUID()}/${i.fileName.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120)}`;
  return { key, upload: await uploadTargetFor(key, i.mime, i.size) };
}
/** 올린 원본 확인 — PDF 는 그대로, 사진은 A4 한 쪽 PDF 로 바꿔 저장(키 뒤에 .pdf). 쪽 수·해시 */
async function loadSource(t: string, key: string, convert: boolean) {
  if (!key.startsWith(`contract/${t}/`) || key.includes('..')) throw badRequest('잘못된 파일입니다');
  const size = await objectSize(key);
  if (size === null) throw badRequest('올린 파일을 찾을 수 없습니다. 다시 올려 주세요.');
  if (size > MAX_SRC) throw badRequest('계약서 파일은 20MB까지입니다');
  let buf = await getObject(key); let outKey = key;
  const { PDFDocument } = await import('pdf-lib');
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    const png = buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', jpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    if (!convert || (!png && !jpg)) throw badRequest('PDF 또는 사진(png·jpg)만 쓸 수 있습니다');
    const doc = await PDFDocument.create();
    const img = png ? await doc.embedPng(buf) : await doc.embedJpg(buf);
    const [pw, ph] = img.width > img.height ? [841.89, 595.28] : [595.28, 841.89];
    const sc = Math.min((pw - 40) / img.width, (ph - 40) / img.height);
    doc.addPage([pw, ph]).drawImage(img, { x: (pw - img.width * sc) / 2, y: (ph - img.height * sc) / 2, width: img.width * sc, height: img.height * sc });
    buf = Buffer.from(await doc.save()); outKey = `${key}.pdf`;
    await putObject(outKey, buf, 'application/pdf');
  }
  if (convert) {
    const flat = await unrotatePdf(buf).catch(() => null); // 회전된 쪽은 보이는 방향 그대로(칸 좌표가 완료본과 같게)
    if (flat) { buf = flat; outKey = outKey.endsWith('.pdf') && outKey !== key ? outKey : `${key}.pdf`; await putObject(outKey, buf, 'application/pdf'); }
  }
  let pages = 0;
  try { pages = (await PDFDocument.load(buf, { updateMetadata: false })).getPageCount(); }
  catch (e) { throw badRequest(/encrypt/i.test(String((e as Error)?.message ?? e)) ? '암호가 걸린 PDF는 쓸 수 없습니다 — 암호를 풀어 다시 저장해 올려 주세요' : 'PDF를 읽을 수 없습니다 — 다시 저장해 올려 주세요'); }
  if (!pages || pages > 50) throw badRequest('1~50쪽 PDF만 쓸 수 있습니다');
  return { key: outKey, pages, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf };
}
export async function prepareSource(u: SessionUser, key: string) {
  await requireEdit(u);
  const r = await loadSource(tenantOf(u), key, true);
  return { key: r.key, pages: r.pages, sha256: r.sha256 };
}
/** 편집기에서 쪽 그림을 그리려고 원본을 내려받음(우리 회사 키만) */
export async function sourceBytes(u: SessionUser, key: string) {
  await requireEdit(u);
  return (await loadSource(tenantOf(u), key, false)).bytes;
}
export const pdfFieldInput = z.object({ signer: z.number().int().min(0).max(5), type: z.enum(['sign', 'stamp', 'text', 'date']), page: z.number().int().min(1).max(50),
  x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.01).max(1), h: z.number().min(0.005).max(1), required: z.boolean().optional(), label: z.string().trim().max(40).optional() });
export const pdfContractInput = z.object({
  title: z.string().trim().min(1).max(120),
  sourceKey: z.string().min(1).max(400),
  sourceName: z.string().trim().min(1).max(200),
  message: z.string().trim().max(1000).optional(),
  signers: z.array(signerInput.extend({ role: z.enum(['employee', 'company', 'witness', 'party']).default('party') })).min(1).max(6),
  fields: z.array(pdfFieldInput).min(1).max(200),
  userId: zUuid.optional(),                                    // 연결할 직원(인사 계약)
  codeBy: z.enum(['sms', 'mail']).optional(),
  expiresDays: z.number().int().min(1).max(90).optional(),
  send: z.boolean().optional(),
});
export const FIELD_LABEL: Record<string, string> = { sign: '서명', stamp: '도장', text: '텍스트', date: '날짜' };
/** 올린 계약서 + 칸 배치로 만들어 보내기 — 서명자마다 서명·도장 칸이 1개 이상 있어야 함 */
export async function createPdfContract(u: SessionUser, i: z.infer<typeof pdfContractInput>, ip: string | null) {
  await requireEdit(u);
  if (u.isDemo) throw forbidden('체험 계정에서는 쓸 수 없습니다');
  const sql = db(); const t = tenantOf(u);
  const src = await loadSource(t, i.sourceKey, false);
  const signers = i.signers.map((s, n) => ({ ...s, ord: s.ord ?? n + 1 }));
  if (signers.some((s) => !s.email && !s.phone)) throw badRequest('서명자마다 이메일 또는 전화번호가 필요합니다');
  for (const s of signers) if (s.userId && !(await sql`select 1 from users where id = ${s.userId} and tenant = ${t}`).length) throw notFound('사용자가 없습니다');
  for (const f of i.fields) {
    if (f.signer >= signers.length) throw badRequest('없는 서명자의 칸이 있습니다');
    if (f.page > src.pages) throw badRequest(`문서는 ${src.pages}쪽까지입니다`);
    if (f.x + f.w > 1.001 || f.y + f.h > 1.001) throw badRequest('칸이 쪽 밖으로 나갔습니다');
  }
  const lacking = signers.filter((_, n) => !i.fields.some((f) => f.signer === n && (f.type === 'sign' || f.type === 'stamp')));
  if (lacking.length) throw badRequest(`서명자마다 서명이나 도장 칸이 1개 이상 있어야 합니다: ${lacking.map((s) => s.name).join(', ')}`);
  if (i.userId && !(await sql`select 1 from users where id = ${i.userId} and tenant = ${t}`).length) throw notFound('사용자가 없습니다');
  const send = i.send ?? true;
  return sql.begin(async (tx) => {
    const no = await docNo(tx, t);
    const [c] = await tx<ContractRow[]>`insert into contracts (tenant, template_id, kind, title, doc_no, body, data, user_id, status, code_by, expires_at, created_by, source_key, source_name, page_count, original_sha256, message)
      values (${t}, null, 'custom', ${i.title}, ${no}, '', '{}', ${i.userId ?? signers.find((s) => s.role === 'employee')?.userId ?? null}, ${send ? 'sent' : 'draft'}, ${i.codeBy ?? 'sms'}, now() + make_interval(days => ${i.expiresDays ?? 14}), ${u.id},
        ${src.key}, ${i.sourceName}, ${src.pages}, ${src.sha256}, ${i.message || null}) returning *`;
    const ids: string[] = [];
    for (const s of signers) {
      const [r] = await tx<{ id: string }[]>`insert into contract_signers (contract_id, ord, role, name, email, phone, user_id, token_hash, code_hash) values (${c.id}, ${s.ord}, ${s.role}, ${s.name}, ${s.email ?? null}, ${s.phone ?? null}, ${s.userId ?? null}, ${sha256(newToken(24))}, ${sha256(code6())}) returning id`;
      ids.push(r.id);
    }
    for (const f of i.fields) await tx`insert into contract_fields (contract_id, signer_id, type, page, x, y, w, h, required, label) values (${c.id}, ${ids[f.signer]}, ${f.type}, ${f.page}, ${f.x}, ${f.y}, ${f.w}, ${f.h}, ${f.type === 'date' ? true : f.required ?? true}, ${f.label || null})`;
    await event(tx, c.id, 'created', { actorUserId: u.id, ip, detail: { source: i.sourceName, pages: src.pages, sha256: src.sha256, signers: signers.length, fields: i.fields.length } });
    const delivery = send ? await sendOrd(tx, c, Math.min(...signers.map((s) => s.ord))) : [];
    await audit(tx, u.id, 'contract.create', 'contract', c.id, { kind: 'upload', docNo: no, pages: src.pages, send }, ip);
    return { id: c.id, docNo: no, title: i.title, status: c.status, delivery };
  });
}
async function loadContract(u: SessionUser, id: string) {
  const [c] = await db()<ContractRow[]>`select * from contracts where id = ${id} and tenant = ${tenantOf(u)}`;
  if (!c) throw notFound('계약서가 없습니다');
  return c;
}
export async function getContract(u: SessionUser, id: string) {
  await requireView(u);
  const sql = db(); const c = await loadContract(u, id);
  const signers = await sql<any[]>`select id, ord, role, name, email, phone, user_id, status, opened_at, signed_at, sign_method, decline_reason, ip, user_agent, (signature_png is not null) as has_signature from contract_signers where contract_id = ${c.id} order by ord, created_at`;
  const events = await sql<any[]>`select e.id, e.type, e.at, e.ip, e.user_agent, e.detail, coalesce(s.name, au.name) as who from contract_events e left join contract_signers s on s.id = e.signer_id left join users au on au.id = e.actor_user_id where e.contract_id = ${c.id} order by e.at, e.id`;
  return { contract: { ...c, signature_png: undefined }, signers, events };
}
export async function cancelContract(u: SessionUser, id: string, ip: string | null) {
  await requireEdit(u);
  const sql = db(); const c = await loadContract(u, id);
  if (['completed', 'cancelled'].includes(c.status)) throw conflict('이미 끝난 계약서입니다');
  await sql`update contracts set status = 'cancelled', updated_at = now() where id = ${c.id}`;
  await event(sql, c.id, 'cancelled', { actorUserId: u.id, ip });
  await audit(sql, u.id, 'contract.cancel', 'contract', c.id, { status: c.status }, ip);
  return { ok: true };
}
const FINISHED = ['completed', 'cancelled', 'declined', 'expired', 'draft'];
/** 로컬 10/25 17:05 ①(대표 10/25 19:00 '시험 흔적 지우세요'): 끝난 계약서(완료·취소·거절·만료·임시)를 통째로 지운다 — 대표·관리자만.
 * 서명자·칸·행위 기록은 함께 지워지고(cascade) 완료본 PDF 는 자료실에서 지운 파일로. 진행 중(서명 대기·일부 서명)은 먼저 취소해야 한다. 감사 기록(제목·문서번호·상태·완료본 파일)은 남긴다 */
export async function deleteContract(u: SessionUser, id: string, ip: string | null) {
  await requireEdit(u);
  if (!['owner', 'admin'].includes(u.role) || u.isDemo) throw forbidden('계약서 삭제는 대표·관리자만 할 수 있습니다');
  const sql = db(); const c = await loadContract(u, id);
  if (!FINISHED.includes(c.status)) throw conflict('진행 중인 계약서는 먼저 취소한 뒤 지울 수 있습니다');
  await sql.begin(async (tx) => {
    if (c.file_id) await tx`update library_files set deleted_at = now() where id = ${c.file_id} and deleted_at is null`;
    await tx`delete from contracts where id = ${c.id} and tenant = ${tenantOf(u)}`;
    await audit(tx, u.id, 'contract.delete', 'contract', c.id, { title: c.title, docNo: c.doc_no, status: c.status, fileId: c.file_id }, ip);
  });
  return { ok: true };
}
/** 다시 보내기(링크·코드 새로) — 지금 차례인 서명자 전원, signerId 를 주면 그 사람만 */
export async function resendContract(u: SessionUser, id: string, signerId: string | undefined, ip: string | null) {
  await requireEdit(u);
  const sql = db(); const c = await loadContract(u, id);
  if (c.status === 'draft') { await sql`update contracts set status = 'sent', updated_at = now() where id = ${c.id}`; c.status = 'sent'; }
  if (!['sent', 'partially_signed'].includes(c.status)) throw conflict('보낼 수 있는 상태가 아닙니다');
  const [cur] = await sql<{ ord: number }[]>`select min(ord) as ord from contract_signers where contract_id = ${c.id} and status in ('pending', 'locked')`;
  if (!cur?.ord) throw conflict('남은 서명자가 없습니다');
  if (signerId) {
    const [s] = await sql<SignerRow[]>`select * from contract_signers where id = ${signerId} and contract_id = ${c.id}`;
    if (!s) throw notFound('서명자가 없습니다');
    if (s.status === 'locked') await sql`update contract_signers set status = 'pending' where id = ${s.id}`;
    if (s.ord !== cur.ord) throw conflict('아직 차례가 아닌 서명자입니다');
  } else await sql`update contract_signers set status = 'pending' where contract_id = ${c.id} and ord = ${cur.ord} and status = 'locked'`;
  const delivery = (await sendOrd(sql, c, cur.ord, true)).filter((d) => !signerId || d.signerId === signerId);
  await audit(sql, u.id, 'contract.resend', 'contract', c.id, { signerId: signerId ?? null }, ip);
  return { delivery };
}

// ---------------- 공개(로그인 없음) 서명 ----------------
async function byToken(token: string) {
  const sql = db();
  const [s] = await sql<SignerRow[]>`select * from contract_signers where token_hash = ${sha256(token)}`;
  if (!s) throw notFound('서명 링크가 올바르지 않습니다');
  const [c] = await sql<ContractRow[]>`select * from contracts where id = ${s.contract_id}`;
  if (!c || c.status === 'cancelled') throw notFound('취소되었거나 없는 계약서입니다');
  if (c.status !== 'completed' && c.expires_at && new Date(c.expires_at) < new Date()) { await sql`update contracts set status = 'expired' where id = ${c.id} and status in ('sent', 'partially_signed')`; throw new HttpError(410, 'expired', '서명 기한이 지났습니다 — 담당자에게 다시 요청하세요'); }
  return { s, c };
}
/** 링크만 연 상태(코드 전): 회사·제목·누구 서명인지, 첫 열람 기록 */
export async function signInfo(token: string, ip: string | null, ua: string | null) {
  const { s, c } = await byToken(token);
  const sql = db(); const company = await companyOf(sql, c.tenant);
  if (!s.opened_at) { await sql`update contract_signers set opened_at = now() where id = ${s.id}`; await event(sql, c.id, 'opened', { signerId: s.id, ip, ua }); }
  const mask = (n: string) => (n.length <= 1 ? n : n[0] + '*'.repeat(Math.max(1, n.length - 2)) + n[n.length - 1]);
  return { company: company.name, title: c.title, docNo: c.doc_no, kind: c.kind, signerName: mask(s.name), role: s.role, status: c.status, myStatus: s.status, codeBy: c.code_by, locked: s.status === 'locked', expiresAt: c.expires_at };
}
async function verify(token: string, code: string, ip: string | null, ua: string | null) {
  const { s, c } = await byToken(token);
  const sql = db();
  if (s.status === 'locked') throw new HttpError(423, 'locked', '접속 코드를 5회 틀려 잠겼습니다 — 담당자에게 다시 보내 달라고 하세요');
  if (sha256(String(code ?? '').trim()) !== s.code_hash) {
    const n = s.code_attempts + 1;
    await sql`update contract_signers set code_attempts = ${n}, status = case when ${n} >= 5 then 'locked' else status end where id = ${s.id}`;
    await event(sql, c.id, n >= 5 ? 'locked' : 'code_fail', { signerId: s.id, ip, ua, detail: { attempts: n } });
    throw new HttpError(n >= 5 ? 423 : 403, 'bad_code', n >= 5 ? '접속 코드를 5회 틀려 잠겼습니다 — 담당자에게 다시 보내 달라고 하세요' : `접속 코드가 틀립니다 (${5 - n}회 남음)`);
  }
  if (s.code_attempts) await sql`update contract_signers set code_attempts = 0 where id = ${s.id}`;
  return { s, c, sql };
}
/** 코드 확인 → 본문·서명자 현황. 코드 확인 기록은 서명 세션마다 1회(바로 전 기록이 code_ok 면 생략) */
export async function signView(token: string, code: string, ip: string | null, ua: string | null) {
  const { s, c, sql } = await verify(token, code, ip, ua);
  const [last] = await sql<{ type: string }[]>`select type from contract_events where signer_id = ${s.id} order by at desc, id desc limit 1`;
  if (last?.type !== 'code_ok') await event(sql, c.id, 'code_ok', { signerId: s.id, ip, ua });
  const signers = await sql<{ id: string; ord: number; role: string; name: string; status: string; signed_at: Date | null }[]>`select id, ord, role, name, status, signed_at from contract_signers where contract_id = ${c.id} order by ord, created_at`;
  const myTurn = s.status === 'pending' && !signers.some((x) => x.ord < s.ord && x.status !== 'signed') && ['sent', 'partially_signed'].includes(c.status);
  const company = await companyOf(sql, c.tenant);
  // 2차: 올린 계약서면 쪽 수와 칸(서명자 색 = signers 순서) — 남의 텍스트 값은 그 사람이 서명한 뒤에만
  let doc: { pages: number; fields: { id: string; signer: number; type: string; page: number; x: number; y: number; w: number; h: number; required: boolean; label: string | null; value: string | null; filled: boolean; mine: boolean }[] } | null = null;
  if (c.source_key) {
    const fs = await sql<{ id: string; signer_id: string; type: string; page: number; x: number; y: number; w: number; h: number; required: boolean; label: string | null; value: string | null; filled_at: Date | null }[]>`
      select id, signer_id, type, page, x, y, w, h, required, label, value, filled_at from contract_fields where contract_id = ${c.id} order by page, y, x`;
    doc = { pages: c.page_count ?? 1, fields: fs.map((f) => {
      const k = signers.findIndex((x) => x.id === f.signer_id); const owner = signers[k];
      return { id: f.id, signer: k, type: f.type, page: f.page, x: f.x, y: f.y, w: f.w, h: f.h, required: f.required, label: f.label, value: f.type === 'text' && (f.signer_id === s.id || owner?.status === 'signed') ? f.value : f.type === 'date' && f.filled_at ? f.value : null, filled: !!f.filled_at, mine: f.signer_id === s.id };
    }) };
  }
  return { company: company.name, title: c.title, docNo: c.doc_no, body: c.body, status: c.status, myStatus: s.status, myTurn, me: { id: s.id, name: s.name, role: s.role, roleLabel: ROLE_LABEL[s.role] },
    signers: signers.map((x) => ({ ord: x.ord, role: x.role, roleLabel: ROLE_LABEL[x.role], name: x.name, status: x.status, signedAt: x.signed_at, me: x.id === s.id })), pdfReady: c.status === 'completed' && !!c.file_id, completedAt: c.completed_at, doc };
}
/** 2차: 올린 계약서 원본(코드 확인 뒤) — 서명 화면이 쪽 그림을 그림 */
export async function signSource(token: string, code: string, ip: string | null, ua: string | null) {
  const { c } = await verify(token, code, ip, ua);
  if (!c.source_key) throw notFound('올린 계약서가 아닙니다');
  return getObject(c.source_key);
}
export const signBody = z.object({ code: z.string().trim().min(4).max(10), image: z.string().min(50).max(600000).optional(), method: z.enum(['draw', 'stamp']).default('draw'), agree: z.literal(true),
  /** 2차: 올린 계약서의 내 텍스트 칸 값(서명·도장 칸은 image, 날짜 칸은 서명일 자동) */ fields: z.array(z.object({ id: zUuid, value: z.string().max(300) })).max(200).optional() });
export async function signContract(token: string, i: z.infer<typeof signBody>, ip: string | null, ua: string | null) {
  const { s, c, sql } = await verify(token, i.code, ip, ua);
  if (s.status === 'signed') throw conflict('이미 서명했습니다');
  if (s.status !== 'pending' || !['sent', 'partially_signed'].includes(c.status)) throw conflict('지금은 서명할 수 없는 상태입니다');
  const [before] = await sql<{ n: number }[]>`select count(*)::int n from contract_signers where contract_id = ${c.id} and ord < ${s.ord} and status <> 'signed'`;
  if (before.n) throw conflict('앞 순서 서명자가 아직 서명하지 않았습니다');
  let png: Buffer | null = null;
  if (i.image) {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(i.image);
    if (!m) throw badRequest('서명 이미지는 PNG(data URL)여야 합니다');
    png = Buffer.from(m[1], 'base64');
    if (png.length < 60 || png.length > 400000 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw badRequest('서명 이미지가 올바르지 않습니다');
  }
  if (c.source_key) {
    // 2차: 내 칸 채우기 — 서명·도장 칸 = 서명 이미지, 텍스트 칸 = 입력 값(필수는 비면 안 됨), 날짜 칸 = 오늘(서명일, 한국 날짜)
    const mine = await sql<{ id: string; type: string; required: boolean }[]>`select id, type, required from contract_fields where contract_id = ${c.id} and signer_id = ${s.id}`;
    const given = new Map((i.fields ?? []).map((f) => [f.id, f.value.trim()]));
    if (mine.some((f) => f.type === 'sign' || f.type === 'stamp') && !png) throw badRequest('서명(또는 도장)을 해 주세요');
    const empty = mine.filter((f) => f.type === 'text' && f.required && !given.get(f.id));
    if (empty.length) throw badRequest(`필수 입력 칸 ${empty.length}개를 채워 주세요`);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    for (const f of mine) await sql`update contract_fields set value = ${f.type === 'text' ? (given.get(f.id) || null)?.slice(0, 300) ?? null : f.type === 'date' ? today : 'signed'}, filled_at = now() where id = ${f.id}`;
  } else if (!png) throw badRequest('서명 이미지가 필요합니다');
  await sql`update contract_signers set status = 'signed', signed_at = now(), sign_method = ${i.method}, signature_png = ${png}, ip = ${ip}, user_agent = ${(ua ?? '').slice(0, 300) || null} where id = ${s.id}`;
  await event(sql, c.id, 'signed', { signerId: s.id, ip, ua, detail: { method: i.method } });
  await advance(sql, c.id);
  const [after] = await sql<ContractRow[]>`select * from contracts where id = ${c.id}`;
  return { ok: true, status: after.status, completed: after.status === 'completed' };
}
export async function declineContract(token: string, code: string, reason: string, ip: string | null, ua: string | null) {
  const { s, c, sql } = await verify(token, code, ip, ua);
  if (s.status !== 'pending' || !['sent', 'partially_signed'].includes(c.status)) throw conflict('지금은 거절할 수 없는 상태입니다');
  await sql`update contract_signers set status = 'declined', decline_reason = ${reason.trim().slice(0, 500)}, ip = ${ip}, user_agent = ${(ua ?? '').slice(0, 300) || null} where id = ${s.id}`;
  await sql`update contracts set status = 'declined', updated_at = now() where id = ${c.id}`;
  await event(sql, c.id, 'declined', { signerId: s.id, ip, ua, detail: { reason: reason.trim().slice(0, 500) } });
  if (c.created_by) await notify(sql, { userIds: [c.created_by], type: 'mention', title: `전자계약서 서명 거절: ${c.title}`, body: `${s.name}: ${reason.trim().slice(0, 120)}`, link: `/admin/users?tab=contracts`, entityType: 'contract', entityId: c.id, dedupeKey: `contract_declined:${c.id}:${s.id}` });
  return { ok: true };
}
/** 서명 뒤: 이 순서 모두 서명 → 다음 순서에 발송, 전원 서명 → 완료(PDF) */
async function advance(sql: Sql, contractId: string) {
  const [c] = await sql<ContractRow[]>`select * from contracts where id = ${contractId}`;
  const all = await sql<SignerRow[]>`select * from contract_signers where contract_id = ${contractId} order by ord`;
  if (all.every((s) => s.status === 'signed')) return complete(sql, c, all);
  const nextOrd = Math.min(...all.filter((s) => s.status !== 'signed').map((s) => s.ord));
  await sql`update contracts set status = 'partially_signed', updated_at = now() where id = ${contractId}`;
  if (all.filter((s) => s.ord === nextOrd).every((s) => s.status === 'pending' && !s.opened_at)) await sendOrd(sql, { ...c, status: 'partially_signed' }, nextOrd);
}
async function complete(sql: Sql, c: ContractRow, signers: SignerRow[]) {
  const company = await companyOf(sql, c.tenant);
  const events = await sql<any[]>`select e.type, e.at, e.ip, e.user_agent, e.detail, coalesce(s.name, au.name) as who from contract_events e left join contract_signers s on s.id = e.signer_id left join users au on au.id = e.actor_user_id where e.contract_id = ${c.id} order by e.at, e.id`;
  const now = new Date();
  const evs = [...events, { type: 'completed', at: now, ip: null, user_agent: null, who: '워크인' }];
  // 2차: 올린 계약서면 원본 쪽 그대로 + 칸 값을 같은 좌표에 찍고 맨 뒤에 감사 추적 쪽(원본 해시). 1차 텍스트 서식은 그대로
  const pdf = c.source_key
    ? await renderFieldsPdf({ source: await getObject(c.source_key), title: c.title, docNo: c.doc_no, company: company.name, originalSha256: c.original_sha256 ?? null, signers,
      fields: await sql<any[]>`select signer_id, type, page, x, y, w, h, value, label from contract_fields where contract_id = ${c.id}`, events: evs, completedAt: now })
    : await renderContractPdf({ title: c.title, docNo: c.doc_no, company: company.name, body: c.body, signers, events: evs, completedAt: now });
  const fileName = `${c.doc_no ?? '계약'}_${c.title.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 60)}.pdf`;
  const [f] = await sql<{ id: string }[]>`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, tags, description, source, created_by, upload_status, security, security_confirmed, text_content)
    values (${c.tenant}, 'work', '인사/전자계약서', ${c.title}, ${fileName}, 'application/pdf', ${pdf.length}, ${['전자계약서', c.source_key ? '올린 계약서' : KIND_LABEL[c.kind] ?? c.kind]}, ${`${c.doc_no ?? ''} 완료 ${now.toISOString()}`}, 'contract', ${c.created_by}, 'pending', 'confidential', true, ${c.body || c.title}) returning id`;
  const key = `lib/${c.tenant}/${f.id}/${fileName.replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(-120)}`;
  await putObject(key, pdf, 'application/pdf');
  await sql`update library_files set storage_key = ${key}, upload_status = 'ready' where id = ${f.id}`;
  await sql`update contracts set status = 'completed', completed_at = ${now}, file_id = ${f.id}, final_sha256 = ${createHash('sha256').update(pdf).digest('hex')}, updated_at = now() where id = ${c.id}`;
  await event(sql, c.id, 'completed', { detail: { fileId: f.id, bytes: pdf.length } });
  const to = [c.created_by, ...signers.map((s) => s.user_id)].filter((x): x is string => !!x);
  await notify(sql, { userIds: [...new Set(to)], type: 'mention', title: `전자계약 완료: ${c.title}`, body: `모든 서명이 끝나 PDF 가 자료실(인사/전자계약서)에 보관되었습니다`, link: `/library?file=${f.id}`, entityType: 'contract', entityId: c.id, dedupeKey: `contract_done:${c.id}` });
  for (const s of signers) if (s.email) sendMail(s.email, `[${company.name}] ${c.title} 서명 완료`, `${s.name}님, "${c.title}" 의 모든 서명이 끝났습니다.\n서명할 때 받은 링크에서 접속 코드로 완료본(PDF)을 내려받을 수 있습니다.\n문의: ${company.name}`).catch(() => {});
}
/** 완료본 PDF(코드 확인 뒤) */
export async function signPdf(token: string, code: string, ip: string | null, ua: string | null) {
  const { s, c, sql } = await verify(token, code, ip, ua);
  if (c.status !== 'completed' || !c.file_id) throw conflict('아직 완료되지 않았습니다');
  const [f] = await sql<{ storage_key: string; file_name: string }[]>`select storage_key, file_name from library_files where id = ${c.file_id}`;
  if (!f?.storage_key) throw notFound('완료본 파일이 없습니다');
  await event(sql, c.id, 'pdf_viewed', { signerId: s.id, ip, ua });
  const { getObject } = await import('./storage');
  return { data: await getObject(f.storage_key), fileName: f.file_name };
}
