import { z } from 'zod';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { randomUUID } from 'node:crypto';
import { db, type Sql } from './db';
import { decrypt, encrypt, hmac, newToken, sha256 } from './crypto';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { activity, audit, logError } from './log';
import { notify } from './notifications';
import { appUrl } from './mail';
import { menuLevel, requireMenu, RANK } from './menuPerms';
import { companyProfiles, type CompanyProfile } from './companyProfiles';
import { tenantOf, type SessionUser } from './types';

/**
 * V21 메일·문자 보내기 — 조직 메일 계정(SMTP)·메일 명함·발송 보관함(outbox)·기간 다운로드 링크.
 * 원칙: AI·자동화는 초안만, 실제 발송은 사람이 [보내기]를 누른 요청만(서버도 send_external 권한 확인).
 * 회사 정보·계정·명함은 모두 조직 설정(DB) — 코드에 회사 값을 쓰지 않는다. 앱 비밀번호는 암호화 저장, 화면·로그에 내보내지 않는다.
 */

// ---------------- 메일 계정 ----------------
export const MAIL_PRESETS = {
  naver: { label: '네이버 메일', host: 'smtp.naver.com', port: 465, secure: true, help: '네이버 메일 > 환경설정 > POP3/IMAP 설정 > SMTP 사용 "사용함". 2단계 인증을 쓰면 [내정보 > 보안설정 > 애플리케이션 비밀번호]로 발급한 비밀번호를 넣으세요.' },
  naverworks: { label: '네이버웍스', host: 'smtp.worksmobile.com', port: 465, secure: true, help: '네이버웍스 관리자에서 외부 메일 앱(SMTP) 사용을 켜고 앱 비밀번호를 발급하세요.' },
  daum: { label: '다음(카카오) 메일', host: 'smtp.daum.net', port: 465, secure: true, help: '다음 메일 > 환경설정 > IMAP/SMTP 사용 설정. 2단계 인증이면 앱 비밀번호.' },
  gmail: { label: 'Gmail (앱 비밀번호)', host: 'smtp.gmail.com', port: 465, secure: true, help: 'Google 계정 2단계 인증 → 앱 비밀번호 16자리를 넣으세요.' },
  m365: { label: 'Microsoft 365', host: 'smtp.office365.com', port: 587, secure: false, help: '관리 센터에서 사용자 "SMTP 인증"을 켜야 합니다(STARTTLS 587).' },
  custom: { label: '직접 입력 (SMTP)', host: '', port: 465, secure: true, help: '메일 업체가 알려 준 SMTP 서버·포트를 넣으세요.' },
} as const;
export type MailProvider = keyof typeof MAIL_PRESETS;

export const accountInput = z.object({
  provider: z.enum(Object.keys(MAIL_PRESETS) as [MailProvider, ...MailProvider[]]),
  host: z.string().trim().max(200).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  username: z.string().trim().min(3).max(200),
  fromEmail: z.string().trim().email('보내는 주소 형식이 아닙니다').max(200),
  fromName: z.string().trim().max(100).nullable().optional(),
  /** 비우면 저장된 비밀번호로 다시 시험 */
  password: z.string().max(200).optional(),
  /** 연결 시험 메일을 받을 주소(기본: 보내는 주소 자신) */
  testTo: z.string().trim().email().max(200).optional(),
});

type AccountRow = { tenant: string; provider: string; host: string; port: number; secure: boolean; username: string; from_email: string; from_name: string | null;
  password_enc: string; last_ok_at: string | null; last_error: string | null; updated_at: string };

const mailSettingsMenu = 'mail_settings' as const;

async function loadAccount(tenant: string, sql: Sql = db()) {
  const [a] = await sql<AccountRow[]>`select * from mail_accounts where tenant = ${tenant}`;
  return a ?? null;
}
/** 화면용 — 비밀번호는 절대 돌려주지 않는다 */
const publicAccount = (a: AccountRow | null) => a && { provider: a.provider, providerLabel: MAIL_PRESETS[a.provider as MailProvider]?.label ?? a.provider, host: a.host, port: a.port, secure: a.secure,
  username: a.username, fromEmail: a.from_email, fromName: a.from_name, lastOkAt: a.last_ok_at, lastError: a.last_error, updatedAt: a.updated_at };

export async function getMailAccount(u: SessionUser) {
  await requireMenu(u, mailSettingsMenu, 'view');
  return { account: publicAccount(await loadAccount(tenantOf(u))), presets: Object.entries(MAIL_PRESETS).map(([k, v]) => ({ key: k, ...v })) };
}

type Conn = { host: string; port: number; secure: boolean; username: string; password: string; provider: string };
function transport(c: Conn) {
  return nodemailer.createTransport({
    host: c.host, port: c.port, secure: c.secure,
    // 프리셋(네이버·Gmail 등)은 암호화 연결 필수. 직접 입력은 업체 설정에 따름
    requireTLS: !c.secure && c.provider !== 'custom',
    auth: { user: c.username, pass: c.password },
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 60_000, // 연결·인사·전송 단계별
    pool: false, // 발송마다 새로 열고 닫는다(오래 붙잡지 않음 — 끊김 방지)
    tls: { servername: c.host },
  } as SMTPTransport.Options);
}

export type SendErrKind = 'transient' | 'auth' | 'address' | 'config';
/** 일시 오류(연결 끊김·시간 초과·4xx)만 재시도, 인증 실패(535)·주소 오류(5xx)는 즉시 실패 */
export function classifySmtpError(e: any): { kind: SendErrKind; message: string } {
  const code = String(e?.code ?? ''); const rc = Number(e?.responseCode) || 0;
  const raw = String(e?.response ?? e?.message ?? '').replace(/\s+/g, ' ').slice(0, 200);
  if (code === 'EAUTH' || rc === 535 || rc === 534 || rc === 530) return { kind: 'auth', message: `메일 계정 로그인 실패 — 아이디·앱 비밀번호를 확인하세요 (${rc || code})` };
  if (rc >= 400 && rc < 500) return { kind: 'transient', message: `메일 서버 일시 오류 (${rc}) ${raw}` };
  if (code === 'EENVELOPE' || (rc >= 500 && rc < 600)) return { kind: 'address', message: `받는 주소 또는 내용이 거부됨 (${rc || code}) ${raw}` };
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNRESET', 'EDNS', 'ECONNREFUSED', 'EPIPE', 'ETLS'].includes(code) || /timeout|ECONNRESET|socket|closed/i.test(raw))
    return { kind: 'transient', message: `메일 서버 연결이 끊겼거나 응답이 늦습니다 (${code || 'timeout'})` };
  return { kind: 'config', message: `메일 발송 오류: ${raw || code}` };
}

/** [연결 시험]: 시험 메일 1통(기본 자기에게)이 나가야 저장한다 */
export async function saveMailAccount(u: SessionUser, i: z.infer<typeof accountInput>, ip: string | null) {
  await requireMenu(u, mailSettingsMenu, 'edit');
  const sql = db(); const t = tenantOf(u);
  const prev = await loadAccount(t, sql);
  const preset = MAIL_PRESETS[i.provider];
  const host = (i.provider === 'custom' ? i.host : i.host || preset.host)?.trim();
  if (!host) throw badRequest('SMTP 서버 주소를 넣어 주세요');
  const port = i.port ?? preset.port; const secure = i.secure ?? preset.secure;
  const password = i.password?.length ? i.password : prev ? decrypt(prev.password_enc) : '';
  if (!password) throw badRequest('앱 비밀번호를 넣어 주세요');
  const conn: Conn = { host, port, secure, username: i.username, password, provider: i.provider };
  const to = i.testTo ?? i.fromEmail;
  try {
    await transport(conn).sendMail({
      from: { name: i.fromName || i.fromEmail, address: i.fromEmail }, to, subject: '[워크인] 메일 계정 연결 시험',
      text: `워크인에서 보낸 연결 시험 메일입니다.\n이 메일이 받은편지함에 왔고, 메일함 "보낸메일함"에도 남았는지 확인해 주세요.\n(보낸메일함에 없으면 메일 환경설정의 "SMTP 로 보낸 메일 저장" 항목을 켜 주세요.)`,
      messageId: `<test-${randomUUID()}@workin>`,
    });
  } catch (e) {
    const c = classifySmtpError(e);
    await audit(sql, u.id, 'mail_account.test_failed', null, null, { provider: i.provider, host, kind: c.kind }, ip);
    throw new HttpError(400, 'mail_test_failed', `연결 시험 실패 — ${c.message}. 저장하지 않았습니다.`);
  }
  await sql`insert into mail_accounts (tenant, provider, host, port, secure, username, from_email, from_name, password_enc, last_ok_at, last_error, updated_by)
    values (${t}, ${i.provider}, ${host}, ${port}, ${secure}, ${i.username}, ${i.fromEmail}, ${i.fromName ?? null}, ${encrypt(password)}, now(), null, ${u.id})
    on conflict (tenant) do update set provider = excluded.provider, host = excluded.host, port = excluded.port, secure = excluded.secure, username = excluded.username,
      from_email = excluded.from_email, from_name = excluded.from_name, password_enc = excluded.password_enc, last_ok_at = now(), last_error = null,
      updated_by = excluded.updated_by, updated_at = now()`;
  await audit(sql, u.id, 'mail_account.save', null, null, { provider: i.provider, host, fromEmail: i.fromEmail }, ip);
  return { ok: true, testSentTo: to, account: publicAccount(await loadAccount(t, sql)) };
}
export async function deleteMailAccount(u: SessionUser, ip: string | null) {
  await requireMenu(u, mailSettingsMenu, 'edit');
  const sql = db();
  await sql`delete from mail_accounts where tenant = ${tenantOf(u)}`;
  await audit(sql, u.id, 'mail_account.delete', null, null, {}, ip);
  return { ok: true };
}

// ---------------- 메일 명함 ----------------
const esc = (s: string | null | undefined) => (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const logoUrl = (p: { id: string; logo_file_id: string | null }) => (p.logo_file_id ? `${appUrl()}/api/public/mail-logo/${p.id}?s=${hmac(`mail-logo:${p.id}:${p.logo_file_id}`).slice(0, 24)}` : null);
export const signatureInput = z.object({
  key: z.string().regex(/^[a-z0-9_-]{2,30}$/),
  sigIntro: z.string().trim().max(300).nullable().optional(),
  sigDisclaimer: z.string().trim().max(1000).nullable().optional(),
  sigDisclaimerEn: z.string().trim().max(1000).nullable().optional(),
});
export async function saveSignature(u: SessionUser, i: z.infer<typeof signatureInput>, ip: string | null) {
  await requireMenu(u, mailSettingsMenu, 'edit');
  const sql = db();
  const r = await sql`update company_profiles set sig_intro = ${i.sigIntro ?? null}, sig_disclaimer = ${i.sigDisclaimer ?? null}, sig_disclaimer_en = ${i.sigDisclaimerEn ?? null},
    updated_by = ${u.id}, updated_at = now() where tenant = ${tenantOf(u)} and key = ${i.key} returning id`;
  if (!r.length) throw notFound('회사 정보가 없습니다 — 회사 정보·디자인에서 먼저 추가하세요');
  await audit(sql, u.id, 'mail_signature.save', null, null, { key: i.key }, ip);
  return { ok: true };
}

/** 설정 화면: 회사별 명함 칸 + 지금 로그인한 사람 기준 미리보기 */
export async function signatureList(u: SessionUser) {
  await requireMenu(u, mailSettingsMenu, 'view');
  const sql = db();
  const me = await sender(u.id, sql);
  const profiles = (await companyProfiles(tenantOf(u), sql)) as SigProfile[];
  return { me: { name: me.name, title: me.title, phone: me.phone, email: me.email }, companies: profiles.map((p) => ({ key: p.key, name: p.name, isDefault: p.is_default,
    sigIntro: p.sig_intro ?? null, sigDisclaimer: p.sig_disclaimer ?? null, sigDisclaimerEn: p.sig_disclaimer_en ?? null, hasLogo: !!p.logo_file_id, html: signatureHtml(p, me) })) };
}

type Sender = { name: string; title: string | null; phone: string | null; email: string };
type SigProfile = CompanyProfile & { sig_intro?: string | null; sig_disclaimer?: string | null; sig_disclaimer_en?: string | null };
/** 메일 명함: 표(table)+인라인 스타일(메일 프로그램 호환). 이름·직급·연락처·이메일 = 보내는 사람, 나머지 = 회사 설정 */
export function signatureHtml(p: SigProfile, s: Sender) {
  const color = p.brand_color ?? '#0F766E';
  const logo = logoUrl(p);
  const line = (label: string, v: string | null | undefined, href?: string) => v ? `<tr><td style="padding:1px 0;color:#64748b;font-size:12px;width:44px">${label}</td><td style="padding:1px 0;font-size:12px;color:#334155">${href ? `<a href="${esc(href)}" style="color:#334155;text-decoration:none">${esc(v)}</a>` : esc(v)}</td></tr>` : '';
  const web = p.website ? (/^https?:\/\//.test(p.website) ? p.website : `https://${p.website}`) : null;
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;border-collapse:collapse;font-family:'Apple SD Gothic Neo','Malgun Gothic',Arial,sans-serif" data-sig="${esc(p.key)}">
<tr><td colspan="2" style="border-top:2px solid ${color};padding:0;height:12px;line-height:12px;font-size:0">&nbsp;</td></tr>
<tr>${logo ? `<td style="vertical-align:top;padding:0 18px 0 0"><img src="${esc(logo)}" alt="${esc(p.name)}" width="96" style="display:block;width:96px;max-width:96px;height:auto;border:0"></td>` : ''}
<td style="vertical-align:top;padding:0 0 0 ${logo ? 18 : 0}px;${logo ? 'border-left:1px solid #e2e8f0' : ''}">
<div style="font-size:15px;font-weight:bold;color:#0f172a">${esc(s.name)}${s.title ? ` <span style="font-size:12px;font-weight:normal;color:#475569">${esc(s.title)}</span>` : ''}</div>
<div style="font-size:13px;font-weight:bold;color:${color};margin:2px 0 6px">${esc(p.name)}</div>
<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
${line('T', p.phone, p.phone ? `tel:${p.phone.replace(/[^0-9+]/g, '')}` : undefined)}${line('M', s.phone, s.phone ? `tel:${s.phone.replace(/[^0-9+]/g, '')}` : undefined)}${line('F', p.fax)}
${line('E', s.email, `mailto:${s.email}`)}${line('W', p.website, web ?? undefined)}${line('A', p.address)}
</table></td></tr>
${p.sig_intro ? `<tr><td colspan="2" style="padding:10px 0 0;font-size:12px;color:#475569">${esc(p.sig_intro)}</td></tr>` : ''}
${p.sig_disclaimer || p.sig_disclaimer_en ? `<tr><td colspan="2" style="padding:10px 0 0;font-size:10px;line-height:1.5;color:#94a3b8">${esc(p.sig_disclaimer)}${p.sig_disclaimer && p.sig_disclaimer_en ? '<br>' : ''}${esc(p.sig_disclaimer_en)}</td></tr>` : ''}
</table>`;
}
export function signatureText(p: SigProfile, s: Sender) {
  return ['--', `${s.name}${s.title ? ' ' + s.title : ''}`, p.name, [p.phone && `T ${p.phone}`, s.phone && `M ${s.phone}`].filter(Boolean).join(' · '), s.email, p.website, p.address]
    .filter(Boolean).join('\n');
}
/** 문자 끝 한 줄: "이름 직급 / 회사 / 대표번호" */
export const smsSignLine = (p: CompanyProfile, s: Sender) => [`${s.name}${s.title ? ' ' + s.title : ''}`, p.name, p.phone].filter(Boolean).join(' / ');

export function bodyHtml(text: string, sig: string, linkBlock = '') {
  const paras = esc(text).replace(/\r\n/g, '\n').split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`).join('');
  return `<div style="font-family:'Apple SD Gothic Neo','Malgun Gothic',Arial,sans-serif;font-size:14px;line-height:1.6;color:#0f172a">${paras}${linkBlock}${sig}</div>`;
}

async function sender(userId: string, sql: Sql): Promise<Sender> {
  const [s] = await sql<Sender[]>`select name, title, phone, email from users where id = ${userId}`;
  return s;
}

// ---------------- 시안 ----------------
export const MAIL_KINDS = {
  quote: { label: '견적 안내', subject: '견적서 송부의 건', body: '안녕하세요.\n\n문의 주신 내용에 대한 견적서를 보내 드립니다.\n첨부 자료 확인 부탁드리며, 궁금하신 점은 언제든 연락 주세요.\n\n감사합니다.' },
  proposal: { label: '제안서 송부', subject: '제안서 송부의 건', body: '안녕하세요.\n\n문의 주신 건과 관련해 제안서를 보내 드립니다.\n검토 후 의견 주시면 맞춰서 안내드리겠습니다.\n\n감사합니다.' },
  official: { label: '공문 송부', subject: '공문 송부의 건', body: '안녕하세요.\n\n관련 공문을 첨부와 같이 보내 드립니다.\n확인 부탁드립니다.\n\n감사합니다.' },
  invoice: { label: '용역비 청구', subject: '용역비 청구의 건', body: '안녕하세요.\n\n용역비 청구서를 첨부와 같이 보내 드립니다.\n확인 후 지급 일정 안내 부탁드립니다.\n\n감사합니다.' },
  material: { label: '자료 송부', subject: '요청하신 자료 송부', body: '안녕하세요.\n\n요청하신 자료를 보내 드립니다.\n확인 부탁드립니다.\n\n감사합니다.' },
} as const;
export type MailKind = keyof typeof MAIL_KINDS;

export async function canSend(u: SessionUser, sql: Sql = db()) {
  return RANK[await menuLevel(u, 'send_external', sql)] >= RANK.use;
}
async function loadTaskForMail(u: SessionUser, taskId: string) {
  const { loadTaskForUser } = await import('./access');
  await loadTaskForUser(u, taskId); // 못 보는 업무·다른 조직은 404
  const [t] = await db()<{ title: string }[]>`select title from tasks where id = ${taskId}`;
  return { task: t };
}
/** 문의 업무면 문의자 이메일·전화·기관명 */
async function inquiryContact(taskId: string, sql: Sql) {
  const [q] = await sql<{ payload: any; organization: string | null; site: string }[]>`select payload, organization, site from inquiries where task_id = ${taskId} limit 1`;
  if (!q) return null;
  const p = q.payload ?? {};
  return { name: p.name ?? null, email: typeof p.email === 'string' && /@/.test(p.email) ? p.email : null, phone: p.phone ?? null, organization: q.organization, site: q.site };
}

/** 업무의 메일 시안 기본값 + 보낼 수 있는 첨부 + 이 업무 발송 기록 */
export async function mailContext(u: SessionUser, taskId: string) {
  const { task } = await loadTaskForMail(u, taskId);
  const sql = db(); const t = tenantOf(u);
  const [profiles, account, contact, me, atts, history] = await Promise.all([
    companyProfiles(t, sql) as Promise<SigProfile[]>,
    loadAccount(t, sql), inquiryContact(taskId, sql), sender(u.id, sql),
    sql`select id, file_name, mime_type, size_bytes, doc_title from attachments where task_id = ${taskId} and kind = 'file' and deleted_at is null and upload_status = 'ready' order by created_at`,
    taskOutbox(taskId, sql),
  ]);
  const sigs = await Promise.all(profiles.map(async (p) => ({ key: p.key, name: p.name, isDefault: p.is_default, html: signatureHtml(p, me), smsLine: smsSignLine(p, me) })));
  // 문의 사이트에 맞는 회사(하이링크 문의 → hilink)가 있으면 그 회사, 아니면 기본 회사
  const guess = contact?.site && profiles.some((p) => p.key === contact.site) ? contact.site : (profiles.find((p) => p.is_default) ?? profiles[0])?.key ?? null;
  return {
    canSend: await canSend(u, sql), account: account ? { fromEmail: account.from_email, fromName: account.from_name, lastOkAt: account.last_ok_at } : null,
    kinds: Object.entries(MAIL_KINDS).map(([k, v]) => ({ key: k, ...v })), companies: sigs, company: guess,
    to: contact?.email ? [contact.email] : [], contact, me: { name: me.name, title: me.title, phone: me.phone, email: me.email },
    attachments: atts.map((a: any) => ({ id: a.id, name: a.file_name, size: Number(a.size_bytes), mime: a.mime_type, title: a.doc_title })),
    linkThresholdBytes: LINK_THRESHOLD, history, taskTitle: task.title,
  };
}
async function taskOutbox(taskId: string, sql: Sql) {
  return sql`select o.id, o.channel, o.status, o.to_addrs, o.cc_addrs, o.subject, o.files, o.as_link, o.attempts, o.last_error, o.error_kind, o.sent_at, o.created_at,
      o.next_attempt_at, u.name as sender_name, s.first_opened_at
    from outbox o join users u on u.id = o.created_by left join share_links s on s.id = o.share_id
    where o.task_id = ${taskId} order by o.created_at desc limit 50`;
}
export async function listTaskOutbox(u: SessionUser, taskId: string) {
  await loadTaskForMail(u, taskId);
  return { items: await taskOutbox(taskId, db()), canSend: await canSend(u) };
}

// ---------------- 보내기 → 보관함 ----------------
/** 네이버 첨부 한도 대비: 합계가 이 크기를 넘으면 첨부 대신 기간 다운로드 링크(14일) */
export const LINK_THRESHOLD = 10 * 1024 * 1024;
const SHARE_DAYS = 14;
const emails = z.array(z.string().trim().email('메일 주소 형식이 아닙니다').max(200)).max(20);
export const sendInput = z.object({
  taskId: z.string().uuid(),
  company: z.string().regex(/^[a-z0-9_-]{2,30}$/),
  to: emails.min(1, '받는 사람을 넣어 주세요'),
  cc: emails.optional(),
  subject: z.string().trim().min(1, '제목을 넣어 주세요').max(200),
  body: z.string().max(20000),
  attachmentIds: z.array(z.string().uuid()).max(20).optional(),
  /** 보내는 사람 명함 정보가 비어 있을 때 한 번 받아 프로필에 저장(학습) */
  senderTitle: z.string().trim().max(50).optional(),
  senderPhone: z.string().trim().max(40).optional(),
});

export async function queueMail(u: SessionUser, i: z.infer<typeof sendInput>, ip: string | null) {
  if (!(await canSend(u))) throw forbidden('메일 보내기 권한이 없습니다 — 대표에게 요청하세요(설정 > 메뉴 권한 > 외부 발송)');
  const { task } = await loadTaskForMail(u, i.taskId);
  const sql = db(); const t = tenantOf(u);
  const account = await loadAccount(t, sql);
  if (!account) throw new HttpError(409, 'mail_account_missing', '회사 메일 계정이 연결되지 않았습니다 — 설정 > 메일 계정에서 먼저 연결하세요');
  const [profile] = (await companyProfiles(t, sql)).filter((p) => p.key === i.company) as SigProfile[];
  if (!profile) throw notFound('회사 정보가 없습니다');
  // 명함 학습: 직급·휴대폰이 비어 있으면 이번에 받은 값을 프로필에 저장
  if (i.senderTitle || i.senderPhone) {
    await sql`update users set title = coalesce(nullif(title, ''), ${i.senderTitle || null}), phone = coalesce(nullif(phone, ''), ${i.senderPhone || null}), updated_at = now() where id = ${u.id}`;
  }
  const me = await sender(u.id, sql);
  const ids = [...new Set(i.attachmentIds ?? [])];
  const files = ids.length ? await sql<{ id: string; file_name: string; size_bytes: string; mime_type: string }[]>`
    select id, file_name, size_bytes, mime_type from attachments where id = any(${ids}::uuid[]) and task_id = ${i.taskId} and kind = 'file' and deleted_at is null and upload_status = 'ready'` : [];
  if (files.length !== ids.length) throw badRequest('이 업무의 첨부만 보낼 수 있습니다');
  const list = ids.map((id) => files.find((f) => f.id === id)!).map((f) => ({ attachmentId: f.id, name: f.file_name, size: Number(f.size_bytes), mime: f.mime_type }));
  const total = list.reduce((s, f) => s + f.size, 0);
  const asLink = total > LINK_THRESHOLD;
  let linkBlock = ''; let linkText = ''; let shareId: string | null = null;
  if (asLink) {
    const s = await createShare(sql, t, i.taskId, u.id, list);
    shareId = s.id;
    linkBlock = `<p style="margin:0 0 12px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc">첨부 자료 ${list.length}개 (${(total / 1048576).toFixed(1)}MB)는 용량이 커서 링크로 보내 드립니다.<br><a href="${esc(s.url)}">${esc(s.url)}</a><br><span style="font-size:12px;color:#64748b">${s.expiresAt.slice(0, 10)}까지 내려받을 수 있습니다.</span></p>`;
    linkText = `\n\n첨부 자료(${list.length}개)는 용량이 커서 링크로 보내 드립니다: ${s.url} (${s.expiresAt.slice(0, 10)}까지)`;
  }
  const html = bodyHtml(i.body, signatureHtml(profile, me), linkBlock);
  const text = `${i.body}${linkText}\n\n${signatureText(profile, me)}`;
  const domain = account.from_email.split('@')[1] ?? 'workin';
  const id = randomUUID();
  await sql`insert into outbox (id, tenant, channel, status, task_id, company_key, created_by, from_email, to_addrs, cc_addrs, subject, body_text, body_html, files, as_link, share_id, message_id)
    values (${id}, ${t}, 'email:smtp', 'queued', ${i.taskId}, ${i.company}, ${u.id}, ${account.from_email}, ${i.to}, ${i.cc ?? []}, ${i.subject}, ${text}, ${html},
      ${sql.json(list as never)}, ${asLink}, ${shareId}, ${`<${id}@${domain}>`})`;
  await activity(sql, 'task', i.taskId, u.id, 'mail_queued', { to: i.to, subject: i.subject, files: list.map((f) => f.name), asLink });
  await audit(sql, u.id, 'mail.queue', 'task', i.taskId, { outboxId: id, to: i.to, files: list.length, asLink }, ip);
  return { id, status: 'queued', asLink, taskTitle: task.title };
}

/** 실패 행 다시 보내기 (같은 Message-ID — 받는 쪽 중복 판별 가능) */
export async function retryOutbox(u: SessionUser, id: string) {
  if (!(await canSend(u))) throw forbidden('메일 보내기 권한이 없습니다');
  const sql = db();
  const [o] = await sql<{ task_id: string | null; status: string }[]>`select task_id, status from outbox where id = ${id} and tenant = ${tenantOf(u)}`;
  if (!o) throw notFound();
  if (o.task_id) await loadTaskForMail(u, o.task_id);
  if (o.status !== 'failed') throw badRequest('실패한 발송만 다시 보낼 수 있습니다');
  await sql`update outbox set status = 'queued', attempts = 0, next_attempt_at = now(), last_error = null, error_kind = null where id = ${id} and status = 'failed'`;
  return { ok: true };
}

const RETRY_MIN = [1, 5, 15]; // 일시 오류 자동 재시도 3회

/** 한 행 발송 — 잠금(같은 행 동시 처리 금지)·상태 확인 후에만 SMTP 를 연다 */
export async function processOutbox(id: string): Promise<string> {
  const sql = db();
  const [o] = await sql<any[]>`update outbox set status = 'sending', locked_until = now() + interval '3 minutes', attempts = attempts + 1
    where id = ${id} and status in ('queued', 'retry') and next_attempt_at <= now()
      and (locked_until is null or locked_until < now()) returning *`;
  if (!o) return 'skipped';
  try {
    const account = await loadAccount(o.tenant, sql);
    if (!account) throw Object.assign(new Error('메일 계정이 연결되지 않았습니다'), { code: 'NOACCOUNT' });
    const attachments = o.as_link ? [] : await Promise.all((o.files as { attachmentId: string; name: string; mime: string }[]).map(async (f) => {
      const [a] = await sql<{ storage_key: string }[]>`select storage_key from attachments where id = ${f.attachmentId}`;
      if (!a) throw Object.assign(new Error(`첨부가 지워졌습니다: ${f.name}`), { code: 'NOFILE' });
      const { getObject } = await import('./storage');
      return { filename: f.name, content: await getObject(a.storage_key), contentType: f.mime };
    }));
    await transport({ host: account.host, port: account.port, secure: account.secure, username: account.username, password: decrypt(account.password_enc), provider: account.provider })
      .sendMail({ from: { name: account.from_name || account.from_email, address: account.from_email }, to: o.to_addrs, cc: o.cc_addrs?.length ? o.cc_addrs : undefined,
        subject: o.subject, text: o.body_text, html: o.body_html ?? undefined, attachments, messageId: o.message_id, replyTo: account.from_email });
    await sql`update outbox set status = 'sent', sent_at = now(), locked_until = null, last_error = null, error_kind = null where id = ${id}`;
    await sql`update mail_accounts set last_ok_at = now(), last_error = null where tenant = ${o.tenant}`;
    if (o.task_id) {
      await activity(sql, 'task', o.task_id, o.created_by, 'mail_sent', { to: o.to_addrs, subject: o.subject, files: (o.files as any[]).map((f) => f.name), asLink: o.as_link });
      await crmSteps(sql, o.task_id, o.subject, o.files as any[]);
    }
    return 'sent';
  } catch (e: any) {
    const c = e?.code === 'NOACCOUNT' || e?.code === 'NOFILE' ? { kind: 'config' as const, message: e.message } : classifySmtpError(e);
    const retry = c.kind === 'transient' && o.attempts <= RETRY_MIN.length;
    await sql`update outbox set status = ${retry ? 'retry' : 'failed'}, locked_until = null, last_error = ${c.message}, error_kind = ${c.kind},
      next_attempt_at = now() + make_interval(mins => ${retry ? RETRY_MIN[o.attempts - 1] : 0}) where id = ${id}`;
    if (c.kind === 'auth') await sql`update mail_accounts set last_error = ${c.message} where tenant = ${o.tenant}`;
    if (!retry) {
      if (o.task_id) await activity(sql, 'task', o.task_id, o.created_by, 'mail_failed', { to: o.to_addrs, subject: o.subject, error: c.message });
      // 보낸 사람 + 대표에게 알림 (다시 보내기는 업무 화면)
      const owners = (await sql<{ id: string }[]>`select id from users where tenant = ${o.tenant} and role = 'owner' and status = 'active' and not is_demo`).map((r) => r.id);
      await notify(sql, { userIds: [o.created_by, ...owners], type: 'mail_status', title: `메일 발송 실패: ${o.subject}`, body: c.message,
        link: o.task_id ? `/tasks/${o.task_id}` : '/admin/mail', entityType: 'task', entityId: o.task_id ?? undefined, dedupeKey: `mail_failed:${id}:${o.attempts}` });
    }
    if (c.kind === 'config') await logError('outbox', e);
    return retry ? 'retry' : 'failed';
  }
}

/** CRM 단계 자동 체크: 자료·제안서 첨부 메일 → "자료/제안서 발송", 견적서 포함 → "견적" (문의 업무 체크리스트) */
async function crmSteps(sql: Sql, taskId: string, subject: string, files: { name: string }[]) {
  const names = files.map((f) => f.name).join(' ') + ' ' + subject;
  const steps: string[] = [];
  if (files.length || /제안|자료|소개/.test(subject)) steps.push('자료/제안서 발송');
  if (/견적/.test(names)) steps.push('견적');
  for (const s of steps) await sql`update task_checklist_items set done = true, done_at = coalesce(done_at, now()), done_by = (select created_by from outbox where task_id = ${taskId} order by sent_at desc nulls last limit 1) where task_id = ${taskId} and text = ${s} and not done`.catch(() => {});
}

/** 보관함 처리(정기 실행·[보내기] 직후): 기한이 된 행만, 한 번에 20건 */
export async function outboxJob(limit = 20) {
  const sql = db();
  const due = await sql<{ id: string }[]>`select id from outbox where status in ('queued', 'retry') and next_attempt_at <= now()
    and (locked_until is null or locked_until < now()) order by next_attempt_at limit ${limit}`;
  // 오래 "보내는 중"으로 멈춘 행(함수 중단)은 잠금이 풀리면 다시 — 단, 이미 SMTP 가 받았을 수 있어 일시 오류처럼 재시도 한도 안에서만
  await sql`update outbox set status = 'retry' where status = 'sending' and locked_until < now() and attempts <= ${RETRY_MIN.length}`;
  await sql`update outbox set status = 'failed', last_error = coalesce(last_error, '발송 중 멈춤 — 다시 보내기로 확인하세요') where status = 'sending' and locked_until < now()`;
  const out: Record<string, number> = {};
  for (const r of due) { const s = await processOutbox(r.id); out[s] = (out[s] ?? 0) + 1; }
  return { due: due.length, ...out };
}

// ---------------- 기간 다운로드 링크 ----------------
async function createShare(sql: Sql, tenant: string, taskId: string | null, userId: string, files: { attachmentId: string; name: string; size: number }[]) {
  const token = newToken(24);
  const expiresAt = new Date(Date.now() + SHARE_DAYS * 86400_000).toISOString();
  const [s] = await sql<{ id: string }[]>`insert into share_links (tenant, token_hash, task_id, created_by, files, expires_at)
    values (${tenant}, ${sha256(token)}, ${taskId}, ${userId}, ${sql.json(files.map((f) => ({ attachmentId: f.attachmentId, name: f.name, size: f.size })) as never)}, ${expiresAt}) returning id`;
  return { id: s.id, url: `${appUrl()}/d/${token}`, expiresAt };
}
/** 문자에 넣을 링크 등 — 사람이 고른 첨부로 링크만 만든다 */
export const shareInput = z.object({ taskId: z.string().uuid(), attachmentIds: z.array(z.string().uuid()).min(1).max(20) });
export async function createTaskShare(u: SessionUser, i: z.infer<typeof shareInput>) {
  await loadTaskForMail(u, i.taskId);
  const sql = db();
  const files = await sql<{ id: string; file_name: string; size_bytes: string }[]>`select id, file_name, size_bytes from attachments
    where id = any(${i.attachmentIds}::uuid[]) and task_id = ${i.taskId} and kind = 'file' and deleted_at is null and upload_status = 'ready'`;
  if (files.length !== new Set(i.attachmentIds).size) throw badRequest('이 업무의 첨부만 링크로 만들 수 있습니다');
  const s = await createShare(sql, tenantOf(u), i.taskId, u.id, files.map((f) => ({ attachmentId: f.id, name: f.file_name, size: Number(f.size_bytes) })));
  await activity(sql, 'task', i.taskId, u.id, 'share_created', { files: files.map((f) => f.file_name), expiresAt: s.expiresAt });
  return s;
}
async function loadShare(token: string) {
  const [s] = await db()<any[]>`select s.*, coalesce(c.name, '') as company from share_links s left join lateral (
      select p.name from company_profiles p where p.tenant = s.tenant order by p.is_default desc limit 1) c on true where s.token_hash = ${sha256(token)}`;
  if (!s || new Date(s.expires_at) < new Date()) throw notFound('링크가 없거나 기간이 지났습니다');
  return s;
}
/** 공개 다운로드 페이지(로그인 없음): 파일 이름·크기만 보여 주고 열람 기록 */
export async function openShare(token: string, ip: string | null, ua: string | null) {
  const s = await loadShare(token);
  const sql = db();
  await sql`insert into share_link_views (link_id, file_index, ip, user_agent) values (${s.id}, null, ${ip}, ${(ua ?? '').slice(0, 300)})`;
  if (!s.first_opened_at) {
    const [first] = await sql`update share_links set first_opened_at = now() where id = ${s.id} and first_opened_at is null returning id`;
    if (first && s.task_id) {
      await activity(sql, 'task', s.task_id, null, 'share_opened', { files: (s.files as any[]).map((f) => f.name) });
      await notify(sql, { userIds: [s.created_by], type: 'mail_status', title: '고객이 보낸 자료를 열어 봤습니다', body: (s.files as any[]).map((f) => f.name).join(', ').slice(0, 200),
        link: `/tasks/${s.task_id}`, entityType: 'task', entityId: s.task_id, dedupeKey: `share_opened:${s.id}` });
    }
  }
  return { company: s.company as string, expiresAt: new Date(s.expires_at).toISOString(), files: (s.files as any[]).map((f, n) => ({ n, name: f.name as string, size: Number(f.size) })) };
}
export async function shareDownload(token: string, n: number, ip: string | null, ua: string | null) {
  const s = await loadShare(token);
  const f = (s.files as any[])[n];
  if (!f) throw notFound();
  const sql = db();
  const [a] = await sql<{ storage_key: string }[]>`select storage_key from attachments where id = ${f.attachmentId} and upload_status = 'ready'`;
  if (!a) throw notFound('파일이 지워졌습니다');
  await sql`insert into share_link_views (link_id, file_index, ip, user_agent) values (${s.id}, ${n}, ${ip}, ${(ua ?? '').slice(0, 300)})`;
  const { downloadUrl } = await import('./storage');
  return downloadUrl(a.storage_key, f.name, false);
}

/** 메일 명함 로고(메일 프로그램이 로그인 없이 불러감) — 서명된 주소만 */
export async function mailLogo(profileId: string, sig: string) {
  const [p] = await db()<{ logo_file_id: string | null; storage_key: string | null; file_name: string | null }[]>`select p.logo_file_id, f.storage_key, f.file_name
    from company_profiles p left join library_files f on f.id = p.logo_file_id where p.id = ${profileId}`;
  if (!p?.logo_file_id || !p.storage_key || hmac(`mail-logo:${profileId}:${p.logo_file_id}`).slice(0, 24) !== sig) throw notFound();
  const { getObject } = await import('./storage');
  return { data: await getObject(p.storage_key), name: p.file_name ?? 'logo' };
}

/** 정기 실행 단계: 기한 된 행이 있으면 서울 지역 처리 주소(/api/mail/run)를 부르고, 못 부르면 여기서 직접 처리 */
export async function outboxTick() {
  const [{ n }] = await db()<{ n: number }[]>`select count(*)::int n from outbox where status in ('queued', 'retry', 'sending') and next_attempt_at <= now()`;
  if (!n) return { due: 0 };
  if (process.env.VERCEL && process.env.CRON_SECRET) {
    try {
      const r = await fetch(`${appUrl()}/api/mail/run`, { method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(55_000) });
      if (r.ok) return { via: 'icn1', ...(await r.json()) };
    } catch { /* 아래에서 직접 */ }
  }
  return outboxJob();
}
