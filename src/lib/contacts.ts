// V31 ① 회사 공용 연락처(고객·거래처) + ② 받는 사람 자동 완성.
// 직원 개인 주소록을 통째로 모으지 않는다 — 회사가 업무로 받은 연락처(문의·발송·견적·직접 등록·가져오기)만 쌓인다.
// 열람 = 같은 회사 직원 전원, 수정·삭제 = 등록자·담당 직원·관리자, 삭제는 휴지통 30일. 다른 회사 404.
import { z } from 'zod';
import { db, type Sql } from './db';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { isAdmin } from './access';
import { activity, audit } from './log';
import { tenantOf, type SessionUser } from './types';

export const MAX_IMPORT = 1000;
export const CONTACT_FIELDS = ['name', 'organization', 'title', 'phone', 'email', 'memo', 'tags'] as const;
export type ContactField = typeof CONTACT_FIELDS[number];
export const CONTACT_FIELD_LABEL: Record<ContactField, string> = { name: '이름', organization: '회사·단지', title: '직함', phone: '휴대폰', email: '이메일', memo: '메모', tags: '태그' };
const HINTS: Record<ContactField, RegExp> = {
  name: /^(이름|성명|담당자|고객|name|full ?name)$/i, organization: /^(회사|회사명|단지|기관|소속|거래처|조직|org|organization|company)$/i, title: /^(직함|직책|직급|title|position)$/i,
  phone: /^(휴대폰|휴대전화|전화|전화번호|연락처|핸드폰|mobile|phone|tel)$/i, email: /^(이메일|메일|e-?mail)$/i, memo: /^(메모|비고|note|notes|memo)$/i, tags: /^(태그|분류|tags?|label)$/i,
};

const PHONE_RE = /^[0-9+\-\s().]{8,25}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const contactInput = z.object({
  name: z.string().trim().min(1, '이름을 넣어 주세요').max(60),
  organization: z.string().trim().max(120).optional().nullable(),
  title: z.string().trim().max(60).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().max(120).optional().nullable(),
  memo: z.string().max(2000).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(20).optional(),
  ownerId: z.string().uuid().optional().nullable(),
});
export type ContactInput = z.infer<typeof contactInput>;

/** 숫자만·표시용 하이픈 — 184차부터 src/lib/phone.ts 한 곳(명함·문자 서명과 같은 규칙) */
import { normPhone, krPhone as fmtPhone } from './phone';
export { normPhone, fmtPhone };
function cleanInput(i: ContactInput) {
  const phone = i.phone?.trim() || null, email = i.email?.trim().toLowerCase() || null;
  if (phone && !PHONE_RE.test(phone)) throw badRequest('휴대폰 번호 형식이 아닙니다 (예: 010-1234-5678)');
  if (email && !EMAIL_RE.test(email)) throw badRequest('이메일 형식이 아닙니다');
  return { name: i.name.trim(), organization: i.organization?.trim() || null, title: i.title?.trim() || null, phone: phone ? fmtPhone(phone) : null, phoneNorm: normPhone(phone), email,
    memo: i.memo ?? '', tags: [...new Set((i.tags ?? []).map((t) => t.trim()).filter(Boolean))] };
}

const canEditRow = (u: SessionUser, c: { created_by: string | null; owner_id: string | null }) => isAdmin(u) || c.created_by === u.id || c.owner_id === u.id;
const ROW = (sql: Sql) => sql`c.id, c.name, c.organization, c.title, c.phone, c.phone_norm, c.email, c.memo, c.tags, c.owner_id, c.source, c.last_contact_at, c.created_by, c.created_at, c.updated_at, c.deleted_at,
  o.name as owner_name, cb.name as created_by_name,
  (select count(*)::int from contact_tasks ct where ct.contact_id = c.id) as task_count`;

/** 목록·검색: 이름·회사·직함·번호·이메일·태그. ?trash=1 이면 휴지통(30일 안) */
export async function listContacts(u: SessionUser, f: { q?: string; tag?: string; trash?: boolean; limit?: number } = {}) {
  const sql = db(); const t = tenantOf(u);
  const q = (f.q ?? '').trim(); const digits = q.replace(/\D/g, '');
  const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  const rows = await sql<any[]>`select ${ROW(sql)} from contacts c left join users o on o.id = c.owner_id left join users cb on cb.id = c.created_by
    where c.tenant = ${t} and ${f.trash ? sql`c.deleted_at is not null` : sql`c.deleted_at is null`}
    ${q ? sql`and (c.name ilike ${like} or c.organization ilike ${like} or c.title ilike ${like} or c.email ilike ${like} ${digits.length >= 3 ? sql`or c.phone_norm like ${'%' + digits + '%'}` : sql``} or exists (select 1 from unnest(c.tags) tg where tg ilike ${like}))` : sql``}
    ${f.tag ? sql`and ${f.tag}::text = any(c.tags)` : sql``}
    order by ${f.trash ? sql`c.deleted_at desc` : sql`c.last_contact_at desc nulls last, c.updated_at desc`} limit ${Math.min(f.limit ?? 200, 500)}`;
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from contacts where tenant = ${t} and deleted_at is null`;
  const tags = await sql<{ tag: string; n: number }[]>`select tg as tag, count(*)::int n from contacts c, unnest(c.tags) tg where c.tenant = ${t} and c.deleted_at is null group by tg order by n desc, tg limit 30`;
  return { contacts: rows.map((c) => ({ ...c, canEdit: canEditRow(u, c) })), total: n, tags, isAdmin: isAdmin(u) };
}

async function load(u: SessionUser, id: string, sql: Sql = db(), withDeleted = false) {
  const [c] = await sql<any[]>`select ${ROW(sql)} from contacts c left join users o on o.id = c.owner_id left join users cb on cb.id = c.created_by where c.id = ${id} and c.tenant = ${tenantOf(u)}`;
  if (!c || (!withDeleted && c.deleted_at)) throw notFound('연락처를 찾을 수 없습니다');
  return c;
}
export async function getContact(u: SessionUser, id: string) {
  const sql = db();
  const c = await load(u, id, sql, true);
  const tasks = await sql<{ id: string; title: string; status: string; linked_at: Date }[]>`select t.id, t.title, t.status, ct.linked_at from contact_tasks ct join tasks t on t.id = ct.task_id where ct.contact_id = ${id} and t.deleted_at is null order by ct.linked_at desc limit 20`;
  const sent = await sql<{ id: string; channel: string; subject: string | null; sent_at: Date | null; created_at: Date; sender: string }[]>`select o.id, o.channel, o.subject, o.sent_at, o.created_at, us.name as sender from outbox o join users us on us.id = o.created_by
    where o.tenant = ${tenantOf(u)} and o.status = 'sent' and (${c.email ? sql`${c.email} = any(o.to_addrs)` : sql`false`} or ${c.phone_norm ? sql`exists (select 1 from unnest(o.to_addrs) a where regexp_replace(a, '\\D', '', 'g') = ${c.phone_norm})` : sql`false`}) order by o.created_at desc limit 20`;
  const history = await sql<{ action: string; changes: any; created_at: Date; actor: string | null }[]>`select a.action, a.changes, a.created_at, us.name as actor from activities a left join users us on us.id = a.actor_id where a.entity_type = 'contact' and a.entity_id = ${id} order by a.created_at desc limit 30`;
  return { contact: { ...c, canEdit: canEditRow(u, c) }, tasks, sent, history };
}

/** 무료 한도(요금제 limits.contactsTotal 이 있을 때만) */
async function assertQuota(u: SessionUser, adding: number, sql: Sql) {
  const t = tenantOf(u);
  if (t === 'default' || t === 'demo') return;
  const { effectiveLimits } = await import('./plans');
  const { limits } = await effectiveLimits(t, sql);
  const lim = (limits as { contactsTotal?: number | null }).contactsTotal;
  if (lim === null || lim === undefined) return;
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from contacts where tenant = ${t} and deleted_at is null`;
  if (n + adding > lim) throw new HttpError(429, 'contact_quota', `연락처가 ${n.toLocaleString('ko-KR')}명으로 한도(${lim.toLocaleString('ko-KR')}명)에 닿았습니다 — 안 쓰는 연락처를 지우거나 회사 관리자에게 문의하세요.`);
}

export async function createContact(u: SessionUser, i: ContactInput, ip: string | null) {
  const sql = db(); const t = tenantOf(u); const v = cleanInput(i);
  if (!v.phone && !v.email) throw badRequest('휴대폰 번호나 이메일 중 하나는 넣어 주세요');
  await assertQuota(u, 1, sql);
  const dup = await findDup(sql, t, v.phoneNorm, v.email);
  if (dup) throw new HttpError(409, 'duplicate', `같은 ${dup.by === 'phone' ? '번호' : '이메일'}의 연락처가 이미 있습니다: ${dup.name}`, { id: dup.id } as never);
  const [c] = await sql<{ id: string }[]>`insert into contacts (tenant, name, organization, title, phone, phone_norm, email, memo, tags, owner_id, source, created_by)
    values (${t}, ${v.name}, ${v.organization}, ${v.title}, ${v.phone}, ${v.phoneNorm}, ${v.email}, ${v.memo}, ${v.tags}, ${i.ownerId ?? null}, 'manual', ${u.id}) returning id`;
  await activity(sql, 'contact', c.id, u.id, 'created', { name: v.name });
  await audit(sql, u.id, 'contact.create', 'contact', c.id, { name: v.name }, ip);
  return { id: c.id };
}
async function findDup(sql: Sql, t: string, phoneNorm: string | null, email: string | null, exceptId?: string) {
  const [r] = await sql<{ id: string; name: string; by: string }[]>`select id, name, case when ${phoneNorm}::text is not null and phone_norm = ${phoneNorm}::text then 'phone' else 'email' end as by from contacts
    where tenant = ${t} and deleted_at is null ${exceptId ? sql`and id <> ${exceptId}` : sql``} and ((${phoneNorm}::text is not null and phone_norm = ${phoneNorm}::text) or (${email}::text is not null and lower(email) = ${email}::text)) limit 1`;
  return r ?? null;
}

export async function updateContact(u: SessionUser, id: string, i: ContactInput, ip: string | null) {
  const sql = db(); const t = tenantOf(u);
  const c = await load(u, id, sql);
  if (!canEditRow(u, c)) throw forbidden('등록한 사람·담당 직원·관리자만 고칠 수 있습니다');
  const v = cleanInput(i);
  if (!v.phone && !v.email) throw badRequest('휴대폰 번호나 이메일 중 하나는 넣어 주세요');
  const dup = await findDup(sql, t, v.phoneNorm, v.email, id);
  if (dup) throw new HttpError(409, 'duplicate', `같은 ${dup.by === 'phone' ? '번호' : '이메일'}의 연락처가 이미 있습니다: ${dup.name}`);
  const changes: Record<string, [unknown, unknown]> = {};
  for (const k of ['name', 'organization', 'title', 'phone', 'email', 'memo'] as const) if ((c[k] ?? '') !== (v[k] ?? '')) changes[k] = [c[k], v[k]];
  if (JSON.stringify(c.tags) !== JSON.stringify(v.tags)) changes.tags = [c.tags, v.tags];
  if ((c.owner_id ?? null) !== (i.ownerId ?? null)) changes.ownerId = [c.owner_id, i.ownerId ?? null];
  await sql`update contacts set name = ${v.name}, organization = ${v.organization}, title = ${v.title}, phone = ${v.phone}, phone_norm = ${v.phoneNorm}, email = ${v.email}, memo = ${v.memo}, tags = ${v.tags}, owner_id = ${i.ownerId ?? null}, updated_at = now() where id = ${id}`;
  if (Object.keys(changes).length) await activity(sql, 'contact', id, u.id, 'updated', changes);
  await audit(sql, u.id, 'contact.update', 'contact', id, { fields: Object.keys(changes) }, ip);
  return { ok: true };
}

/** 휴지통(30일 뒤 정리) · 복원 */
export async function deleteContact(u: SessionUser, id: string, ip: string | null) {
  const sql = db(); const c = await load(u, id, sql);
  if (!canEditRow(u, c)) throw forbidden('등록한 사람·담당 직원·관리자만 지울 수 있습니다');
  await sql`update contacts set deleted_at = now(), updated_at = now() where id = ${id}`;
  await activity(sql, 'contact', id, u.id, 'deleted', {});
  await audit(sql, u.id, 'contact.delete', 'contact', id, { name: c.name }, ip);
  return { ok: true };
}
export async function restoreContact(u: SessionUser, id: string, ip: string | null) {
  const sql = db(); const c = await load(u, id, sql, true);
  if (!c.deleted_at) return { ok: true };
  if (!canEditRow(u, c)) throw forbidden('등록한 사람·담당 직원·관리자만 되살릴 수 있습니다');
  const dup = await findDup(sql, tenantOf(u), c.phone_norm, c.email ? String(c.email).toLowerCase() : null, id);
  if (dup) throw new HttpError(409, 'duplicate', `같은 ${dup.by === 'phone' ? '번호' : '이메일'}의 연락처가 이미 있습니다: ${dup.name}`);
  await sql`update contacts set deleted_at = null, updated_at = now() where id = ${id}`;
  await activity(sql, 'contact', id, u.id, 'restored', {});
  await audit(sql, u.id, 'contact.restore', 'contact', id, {}, ip);
  return { ok: true };
}
/** tick: 휴지통 30일 지난 연락처 완전 삭제 */
export async function contactsJob(sql: Sql = db()) {
  const r = await sql`delete from contacts where deleted_at is not null and deleted_at < now() - interval '30 days'`;
  return { purged: r.count };
}

// ---------------- 자동 등록(문의·발송·견적) ----------------
export type Seen = { name?: string | null; organization?: string | null; title?: string | null; phone?: string | null; email?: string | null };
/**
 * 받는 사람·문의자를 회사 연락처에 넣는다(이미 있으면 빈 칸만 채우고 마지막 연락 시각 갱신) + 업무에 연결.
 * 실패해도 보내기는 그대로 — 호출하는 쪽에서 try/catch. 번호·이메일 둘 다 없으면 건너뜀. 직원 자신의 이메일·번호는 넣지 않는다.
 */
export async function rememberContacts(sql: Sql, tenant: string, actorId: string | null, people: Seen[], opts: { source: 'inquiry' | 'send' | 'quote'; taskId?: string | null }) {
  const ids: string[] = [];
  const staff = await sql<{ email: string; work_email: string | null; phone_norm: string | null }[]>`select lower(email) as email, lower(work_email) as work_email, regexp_replace(coalesce(phone, ''), '\\D', '', 'g') as phone_norm from users where tenant = ${tenant}`;
  for (const p of people) {
    const phoneNorm = normPhone(p.phone), email = p.email?.trim().toLowerCase() || null;
    if (!phoneNorm && !(email && EMAIL_RE.test(email))) continue;
    if (staff.some((s) => (email && (s.email === email || s.work_email === email)) || (phoneNorm && s.phone_norm === phoneNorm))) continue;
    const dup = await findDup(sql, tenant, phoneNorm, email && EMAIL_RE.test(email) ? email : null);
    let id: string;
    if (dup) {
      id = dup.id;
      await sql`update contacts set name = case when name ~ '^(이름 없음|고객)' and ${p.name ?? null}::text is not null then ${p.name ?? null} else name end,
        organization = coalesce(nullif(organization, ''), ${p.organization ?? null}), title = coalesce(nullif(title, ''), ${p.title ?? null}),
        phone = coalesce(nullif(phone, ''), ${p.phone ? fmtPhone(p.phone) : null}), phone_norm = coalesce(phone_norm, ${phoneNorm}),
        email = coalesce(nullif(email, ''), ${email && EMAIL_RE.test(email) ? email : null}), last_contact_at = now(), updated_at = now() where id = ${id}`;
    } else {
      const name = (p.name ?? '').trim() || p.organization?.trim() || (phoneNorm ? `고객 ${fmtPhone(p.phone)}` : `고객 ${email}`);
      const [c] = await sql<{ id: string }[]>`insert into contacts (tenant, name, organization, title, phone, phone_norm, email, source, last_contact_at, created_by)
        values (${tenant}, ${name.slice(0, 60)}, ${p.organization?.slice(0, 120) ?? null}, ${p.title?.slice(0, 60) ?? null}, ${p.phone ? fmtPhone(p.phone) : null}, ${phoneNorm}, ${email && EMAIL_RE.test(email) ? email : null}, ${opts.source}, now(), ${actorId}) returning id`;
      id = c.id;
      await activity(sql, 'contact', id, actorId, 'created', { name, source: opts.source });
    }
    if (opts.taskId) await sql`insert into contact_tasks (contact_id, task_id) values (${id}, ${opts.taskId}) on conflict (contact_id, task_id) do update set linked_at = now()`;
    ids.push(id);
  }
  return ids;
}

// ---------------- 자동 완성 ----------------
export type Suggestion = { id: string; kind: 'contact' | 'employee'; name: string; organization: string | null; title: string | null; phone: string | null; email: string | null; linked: boolean; recent: boolean };
/** 받는 사람 칸: 이름·회사·번호·이메일 일부 → 같은 업무에 연결된 사람 → 최근 연락 → 이름순. 직원(사용자 관리)도 같이(내부 표시). kind 로 번호/이메일 있는 사람만 */
export async function suggestRecipients(u: SessionUser, f: { q: string; taskId?: string | null; kind?: 'phone' | 'email' | 'any'; limit?: number }) {
  const sql = db(); const t = tenantOf(u);
  const q = f.q.trim(); const digits = q.replace(/\D/g, ''); const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  const kind = f.kind ?? 'any'; const limit = Math.min(f.limit ?? 8, 20);
  const needCol = kind === 'phone' ? sql`and c.phone_norm is not null` : kind === 'email' ? sql`and c.email is not null` : sql``;
  const match = q ? sql`and (c.name ilike ${like} or c.organization ilike ${like} or c.email ilike ${like} ${digits.length >= 3 ? sql`or c.phone_norm like ${'%' + digits + '%'}` : sql``})` : sql``;
  const rows = await sql<any[]>`select c.id, c.name, c.organization, c.title, c.phone, c.email,
      ${f.taskId ? sql`exists (select 1 from contact_tasks ct where ct.contact_id = c.id and ct.task_id = ${f.taskId})` : sql`false`} as linked,
      (c.last_contact_at > now() - interval '30 days') as recent
    from contacts c where c.tenant = ${t} and c.deleted_at is null ${needCol} ${match}
    order by linked desc, c.last_contact_at desc nulls last, c.name limit ${limit}`;
  const out: Suggestion[] = rows.map((r) => ({ ...r, kind: 'contact', recent: !!r.recent }));
  if (q.length >= 1 && out.length < limit) {
    const staffCol = kind === 'phone' ? sql`and nullif(us.phone, '') is not null` : kind === 'email' ? sql`and (nullif(us.work_email, '') is not null or us.email is not null)` : sql``;
    const staff = await sql<any[]>`select us.id, us.name, us.title, us.phone, coalesce(nullif(us.work_email, ''), us.email) as email from users us
      where us.tenant = ${t} and us.status = 'active' and us.id <> ${u.id} ${staffCol} and (us.name ilike ${like} or us.email ilike ${like} or us.work_email ilike ${like} ${digits.length >= 3 ? sql`or regexp_replace(coalesce(us.phone, ''), '\\D', '', 'g') like ${'%' + digits + '%'}` : sql``})
      order by us.name limit ${limit - out.length}`;
    for (const s of staff) out.push({ id: s.id, kind: 'employee', name: s.name, organization: null, title: s.title, phone: s.phone ? fmtPhone(s.phone) : null, email: s.email, linked: false, recent: false });
  }
  return { suggestions: out };
}

// ---------------- 가져오기(엑셀·CSV·vCard) ----------------
export const importParseInput = z.object({ fileName: z.string().max(200), data: z.string().max(4_400_000) });
/** 파일 → 머리글·줄·추측한 짝. vCard(.vcf) 는 바로 이름·회사·직함·번호·이메일·메모 표로 */
export async function parseContactsFile(i: z.infer<typeof importParseInput>) {
  const buf = Buffer.from(i.data, 'base64');
  if (buf.length > 3 * 1024 * 1024) throw badRequest('파일이 너무 큽니다(3MB 까지)');
  const ext = i.fileName.toLowerCase().split('.').pop();
  if (ext === 'xls') throw badRequest('예전 엑셀 파일(.xls)은 열 수 없습니다. .xlsx나 CSV로 다시 저장해 주세요');
  if (ext === 'vcf' || ext === 'vcard') {
    const rows = parseVcf(buf.toString('utf8'));
    if (!rows.length) throw badRequest('vCard 에 연락처가 없습니다');
    if (rows.length > MAX_IMPORT) throw badRequest(`한 번에 ${MAX_IMPORT}명까지 가져올 수 있습니다(지금 ${rows.length}명)`);
    const headers = ['이름', '회사', '직함', '휴대폰', '이메일', '메모'];
    return { headers, rows: rows.map((r) => [r.name, r.organization, r.title, r.phone, r.email, r.memo]), mapping: { name: 0, organization: 1, title: 2, phone: 3, email: 4, memo: 5 } as Partial<Record<ContactField, number>>, vcard: true };
  }
  const { parseCsv, parseXlsx } = await import('./taskImport');
  const all = (ext === 'xlsx' ? parseXlsx(buf) : parseCsv(buf)).map((r) => r.map((c) => String(c ?? '').trim()));
  const nonEmpty = all.filter((r) => r.some((c) => c));
  if (!nonEmpty.length) throw badRequest('파일에 내용이 없습니다');
  const [head, ...rows] = nonEmpty;
  const width = Math.max(head.length, ...rows.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, k) => head[k] || `열 ${k + 1}`);
  if (rows.length > MAX_IMPORT) throw badRequest(`한 번에 ${MAX_IMPORT}줄까지 가져올 수 있습니다(지금 ${rows.length}줄) — 파일을 나눠 주세요`);
  const mapping: Partial<Record<ContactField, number>> = {};
  headers.forEach((h, k) => { const f = CONTACT_FIELDS.find((x) => mapping[x] === undefined && HINTS[x].test(h.replace(/\s*\(.*\)\s*$/, '').trim())); if (f) mapping[f] = k; });
  if (mapping.name === undefined && headers.length) mapping.name = 0;
  return { headers, rows: rows.map((r) => Array.from({ length: width }, (_, k) => r[k] ?? '')), mapping, vcard: false };
}
/** vCard 2.1/3.0/4.0 — FN/N, ORG, TITLE, TEL, EMAIL, NOTE. 접힌 줄(공백으로 시작)·QUOTED-PRINTABLE 한글 해석 */
export function parseVcf(text: string) {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out: { name: string; organization: string; title: string; phone: string; email: string; memo: string }[] = [];
  let cur: typeof out[number] | null = null;
  const decode = (params: string, v: string) => {
    if (/ENCODING=QUOTED-PRINTABLE/i.test(params)) { const bytes = v.replace(/=\n/g, '').match(/=[0-9A-F]{2}|./gi) ?? []; return Buffer.from(bytes.flatMap((b) => (b.length === 3 && b[0] === '=' ? [parseInt(b.slice(1), 16)] : [...Buffer.from(b, 'utf8')]))).toString('utf8'); }
    return v.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';');
  };
  for (const raw of lines) {
    const line = raw.trim(); if (!line) continue;
    if (/^BEGIN:VCARD/i.test(line)) { cur = { name: '', organization: '', title: '', phone: '', email: '', memo: '' }; continue; }
    if (/^END:VCARD/i.test(line)) { if (cur && (cur.name || cur.phone || cur.email)) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const m = line.match(/^([^:;]+)((?:;[^:]*)?):(.*)$/); if (!m) continue;
    const key = m[1].toUpperCase().replace(/^ITEM\d+\./, ''), params = m[2], val = decode(params, m[3]).trim();
    if (key === 'FN' && !cur.name) cur.name = val;
    else if (key === 'N' && !cur.name) { const [last = '', first = ''] = val.split(';'); cur.name = /[가-힣]/.test(last + first) ? `${last}${first}` : `${first} ${last}`.trim(); }
    else if (key === 'ORG') cur.organization = cur.organization || val.split(';')[0];
    else if (key === 'TITLE') cur.title = cur.title || val;
    else if (key === 'TEL') { if (!cur.phone || /CELL|MOBILE/i.test(params)) cur.phone = cur.phone && !/CELL|MOBILE/i.test(params) ? cur.phone : val; }
    else if (key === 'EMAIL') cur.email = cur.email || val;
    else if (key === 'NOTE') cur.memo = cur.memo || val;
  }
  return out;
}

export const importApplyInput = z.object({
  headers: z.array(z.string()).max(100), rows: z.array(z.array(z.string())).max(MAX_IMPORT),
  mapping: z.record(z.string(), z.number().int().min(0)), tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  ownerId: z.string().uuid().optional().nullable(), source: z.enum(['import', 'vcard']).optional(),
});
/** 미리보기(저장 안 함) + 반영: 이름 없음·번호/이메일 둘 다 없음·형식 오류 줄은 건너뜀, 이미 있으면 빈 칸만 채움 */
export async function importContacts(u: SessionUser, i: z.infer<typeof importApplyInput>, apply: boolean, ip: string | null) {
  const sql = db(); const t = tenantOf(u);
  const m = i.mapping as Partial<Record<ContactField, number>>;
  if (m.name === undefined) throw badRequest('"이름" 열을 골라 주세요');
  const get = (r: string[], f: ContactField) => (m[f] === undefined ? '' : (r[m[f]!] ?? '').trim());
  const rows = i.rows.map((r, k) => {
    const name = get(r, 'name'), phone = get(r, 'phone'), email = get(r, 'email').toLowerCase();
    const errors: string[] = [];
    if (!name) errors.push('이름 없음');
    if (!phone && !email) errors.push('번호·이메일 둘 다 없음');
    if (phone && !PHONE_RE.test(phone)) errors.push('번호 형식');
    if (email && !EMAIL_RE.test(email)) errors.push('이메일 형식');
    return { row: k + 1, name, organization: get(r, 'organization'), title: get(r, 'title'), phone, email, memo: get(r, 'memo'), tags: get(r, 'tags').split(/[,;/|]/).map((x) => x.trim()).filter(Boolean), errors };
  });
  const ok = rows.filter((r) => !r.errors.length);
  // 파일 안 중복(같은 번호/이메일)은 첫 줄만
  const seen = new Set<string>();
  for (const r of ok) { const k = normPhone(r.phone) ?? r.email; if (seen.has(k!)) r.errors.push('파일 안 중복'); else seen.add(k!); }
  const ready = rows.filter((r) => !r.errors.length);
  let created = 0, updated = 0;
  if (apply) {
    await assertQuota(u, ready.length, sql);
    for (const r of ready) {
      const phoneNorm = normPhone(r.phone), email = r.email || null;
      const dup = await findDup(sql, t, phoneNorm, email);
      const tags = [...new Set([...(i.tags ?? []), ...r.tags])].slice(0, 20);
      if (dup) {
        await sql`update contacts set organization = coalesce(nullif(organization, ''), ${r.organization || null}), title = coalesce(nullif(title, ''), ${r.title || null}),
          phone = coalesce(nullif(phone, ''), ${r.phone ? fmtPhone(r.phone) : null}), phone_norm = coalesce(phone_norm, ${phoneNorm}), email = coalesce(nullif(email, ''), ${email}),
          memo = case when memo = '' then ${r.memo} else memo end, tags = (select array_agg(distinct x) from unnest(tags || ${tags}::text[]) x), updated_at = now() where id = ${dup.id}`;
        updated++;
      } else {
        const [c] = await sql<{ id: string }[]>`insert into contacts (tenant, name, organization, title, phone, phone_norm, email, memo, tags, owner_id, source, created_by)
          values (${t}, ${r.name.slice(0, 60)}, ${r.organization.slice(0, 120) || null}, ${r.title.slice(0, 60) || null}, ${r.phone ? fmtPhone(r.phone) : null}, ${phoneNorm}, ${email}, ${r.memo.slice(0, 2000)}, ${tags}, ${i.ownerId ?? null}, ${i.source ?? 'import'}, ${u.id}) returning id`;
        await activity(sql, 'contact', c.id, u.id, 'created', { name: r.name, source: i.source ?? 'import' });
        created++;
      }
    }
    await audit(sql, u.id, 'contact.import', 'contact', null, { created, updated, skipped: rows.length - ready.length }, ip);
  }
  return { rows: rows.slice(0, 200), counts: { total: rows.length, ready: ready.length, errors: rows.length - ready.length }, created, updated };
}

/** 엑셀 내려받기(전체) */
export async function exportContacts(u: SessionUser) {
  const { contacts } = await listContacts(u, { limit: 500 });
  const { writeXlsx } = await import('./xlsx');
  const data = writeXlsx([{ name: '연락처', rows: [['이름', '회사·단지', '직함', '휴대폰', '이메일', '태그', '담당', '출처', '마지막 연락', '메모'],
    ...contacts.map((c: any) => [c.name, c.organization ?? '', c.title ?? '', c.phone ?? '', c.email ?? '', (c.tags ?? []).join(', '), c.owner_name ?? '', SOURCE_LABEL[c.source] ?? c.source, c.last_contact_at ? new Date(c.last_contact_at).toISOString().slice(0, 10) : '', c.memo ?? ''])], widths: [10, 16, 10, 14, 24, 14, 8, 8, 12, 30] }]);
  return { fileName: `연락처_${new Date().toISOString().slice(0, 10)}.xlsx`, data };
}
export const SOURCE_LABEL: Record<string, string> = { manual: '직접', inquiry: '문의', send: '발송', import: '가져오기', vcard: 'vCard', quote: '견적' };
