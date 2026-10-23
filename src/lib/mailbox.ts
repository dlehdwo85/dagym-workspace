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
  naver: { label: '네이버 메일', host: 'smtp.naver.com', port: 465, secure: true, help: '네이버 메일 > 환경설정 > POP3/IMAP 설정 > SMTP 사용 "사용함". 2단계 인증을 쓰면 [내정보 > 보안설정 > 애플리케이션 비밀번호]로 발급한 비밀번호를 넣으세요.',
    steps: [['네이버 메일 열기 → 왼쪽 아래 [환경설정]', 'https://mail.naver.com'], ['[POP3/IMAP 설정] 탭 → "IMAP/SMTP 사용" 을 [사용함] → 저장', ''], ['2단계 인증을 쓰면: 네이버 [내정보] → [보안설정] → [애플리케이션 비밀번호 관리] → 종류 "기타", 이름 "워크인" → 생성', 'https://nid.naver.com/user2/help/myInfo'], ['생성된 비밀번호(12자리)를 아래 "앱 비밀번호" 칸에 붙여넣기 — 2단계 인증을 안 쓰면 네이버 비밀번호', '']] },
  naverworks: { label: '네이버웍스', host: 'smtp.worksmobile.com', port: 465, secure: true, help: '네이버웍스 관리자에서 외부 메일 앱(SMTP) 사용을 켜고 앱 비밀번호를 발급하세요.' },
  daum: { label: '다음(카카오) 메일', host: 'smtp.daum.net', port: 465, secure: true, help: '다음 메일 > 환경설정 > IMAP/SMTP 사용 설정. 2단계 인증이면 앱 비밀번호.',
    steps: [['다음 메일 열기 → [환경설정]', 'https://mail.daum.net'], ['[IMAP/SMTP] → "사용함" → 저장', ''], ['카카오계정 2단계 인증을 쓰면: 카카오계정 → [계정 보안] → [앱 비밀번호] 발급', 'https://accounts.kakao.com'], ['발급한 비밀번호를 아래 "앱 비밀번호" 칸에 붙여넣기', '']] },
  gmail: { label: 'Gmail (앱 비밀번호)', host: 'smtp.gmail.com', port: 465, secure: true, help: 'Google 계정 2단계 인증 → 앱 비밀번호 16자리를 넣으세요.',
    steps: [['Google 계정 2단계 인증 켜기', 'https://myaccount.google.com/security'], ['앱 비밀번호 만들기 → 이름 "워크인" → 16자리 복사', 'https://myaccount.google.com/apppasswords'], ['아래 "앱 비밀번호" 칸에 붙여넣기(띄어쓰기는 지워도 됨)', '']] },
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
/** V32 6: 회사 기본 발송 방식·보내는 주소·회사 메일 계정은 회사 관리자(대표·관리자)만 — 메뉴 권한이 있어도 직원은 읽기 전용 */
export const isMailAdmin = (u: SessionUser) => ['owner', 'admin'].includes(u.role);
function requireMailAdmin(u: SessionUser) { if (!isMailAdmin(u)) throw forbidden('회사 기본 메일 설정은 대표·관리자만 바꿀 수 있습니다'); }
/** 직원이 회신 주소(업무 이메일)를 바꿀 수 있는지 */
export async function replyToEditable(u: SessionUser, sql: Sql = db()) {
  if (isMailAdmin(u)) return true;
  const [t] = await sql<{ allow_staff_reply_to: boolean }[]>`select allow_staff_reply_to from tenants where id = ${tenantOf(u)}`;
  return t?.allow_staff_reply_to ?? true;
}

async function loadAccount(tenant: string, sql: Sql = db()) {
  const [a] = await sql<AccountRow[]>`select * from mail_accounts where tenant = ${tenant}`;
  return a ?? null;
}
// ---------------- V33 4 (#184) 직원 개인 메일 계정 ----------------
type UserAccountRow = AccountRow & { user_id: string };
async function loadUserAccount(userId: string, sql: Sql = db()) {
  const [a] = await sql<UserAccountRow[]>`select * from user_mail_accounts where user_id = ${userId}`;
  return a ?? null;
}
/** 회사 정책: 직원 개인 메일 계정 연결 허용 여부·허용 도메인(비어 있으면 제한 없음) */
export async function staffMailPolicy(tenant: string, sql: Sql = db()) {
  const [t] = await sql<{ staff_mail_accounts: boolean; staff_mail_domains: string[] }[]>`select staff_mail_accounts, staff_mail_domains from tenants where id = ${tenant}`;
  return { allowed: !!t?.staff_mail_accounts, domains: (t?.staff_mail_domains ?? []).map((d) => d.toLowerCase()) };
}
/** 이 사람의 발송에 쓸 개인 계정 — 회사가 허용했고 연결돼 있을 때만(허용을 끄면 회사 기본 방식으로 돌아감) */
async function personalAccount(u: SessionUser, sql: Sql) {
  const pol = await staffMailPolicy(tenantOf(u), sql);
  if (!pol.allowed) return null;
  const a = await loadUserAccount(u.id, sql);
  return a && a.tenant === tenantOf(u) ? a : null;
}
// ---------------- V29 워크인 발송(설정 없이) ----------------
/** RESEND_API_KEY + MAIL_FROM_DOMAIN(예: mail.work-in.dev, Resend 에서 인증된 도메인)이 있으면 켜짐 */
export const workinMailEnabled = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM_DOMAIN);
const workinFrom = () => `noreply@${process.env.MAIL_FROM_DOMAIN}`;
export type MailMode = 'auto' | 'workin' | 'smtp';
async function mailMode(tenant: string, sql: Sql): Promise<MailMode> {
  const [r] = await sql<{ mail_mode: MailMode }[]>`select mail_mode from tenants where id = ${tenant}`;
  return r?.mail_mode ?? 'auto';
}
/** 이번 발송 경로: 회사 설정 + 준비 상태. 둘 다 안 되면 null */
export async function pickChannel(tenant: string, sql: Sql): Promise<'email:smtp' | 'email:workin' | null> {
  const [mode, acc] = await Promise.all([mailMode(tenant, sql), loadAccount(tenant, sql)]);
  if (mode === 'smtp') return acc ? 'email:smtp' : null;
  if (mode === 'workin') return workinMailEnabled() ? 'email:workin' : acc ? 'email:smtp' : null;
  return acc ? 'email:smtp' : workinMailEnabled() ? 'email:workin' : null;
}
export const mailModeInput = z.object({ mode: z.enum(['auto', 'workin', 'smtp']).optional(), allowStaffReplyTo: z.boolean().optional(),
  staffAccounts: z.boolean().optional(), staffDomains: z.array(z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, '도메인 형식(예: company.co.kr)')).max(10).optional() });
export async function setMailMode(u: SessionUser, i: z.infer<typeof mailModeInput>) {
  await requireMenu(u, mailSettingsMenu, 'edit');
  requireMailAdmin(u);
  const sql = db();
  if (i.mode) await sql`update tenants set mail_mode = ${i.mode} where id = ${tenantOf(u)}`;
  if (i.allowStaffReplyTo !== undefined) await sql`update tenants set allow_staff_reply_to = ${i.allowStaffReplyTo} where id = ${tenantOf(u)}`;
  if (i.staffAccounts !== undefined) await sql`update tenants set staff_mail_accounts = ${i.staffAccounts} where id = ${tenantOf(u)}`;
  if (i.staffDomains !== undefined) await sql`update tenants set staff_mail_domains = ${[...new Set(i.staffDomains)]} where id = ${tenantOf(u)}`;
  await audit(sql, u.id, 'mail.mode', null, null, { mode: i.mode ?? null, allowStaffReplyTo: i.allowStaffReplyTo ?? null }, null);
  return { ok: true, mode: await mailMode(tenantOf(u), sql), channel: await pickChannel(tenantOf(u), sql) };
}
type ResendMail = { from: string; to: string[]; cc?: string[]; bcc?: string[]; replyTo?: string; subject: string; text: string; html?: string; messageId: string;
  attachments: { filename: string; content: Buffer; contentType?: string }[] };
/** Resend HTTP API 로 보냄 — 실패는 SMTP 와 같은 분류(auth·address·transient·config)로 */
async function resendSend(m: ResendMail) {
  const base = (process.env.RESEND_API_BASE ?? 'https://api.resend.com').replace(/\/$/, '');
  let r: Response;
  try {
    r = await fetch(`${base}/emails`, { method: 'POST', signal: AbortSignal.timeout(30_000), headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json', 'idempotency-key': m.messageId },
      body: JSON.stringify({ from: m.from, to: m.to, cc: m.cc?.length ? m.cc : undefined, bcc: m.bcc?.length ? m.bcc : undefined, reply_to: m.replyTo || undefined, subject: m.subject, text: m.text, html: m.html,
        headers: { 'Message-ID': m.messageId }, attachments: m.attachments.map((a) => ({ filename: a.filename, content: a.content.toString('base64'), content_type: a.contentType })) }) });
  } catch (e: any) { throw Object.assign(new Error(`워크인 발송 서버에 연결하지 못했습니다(${e?.name ?? 'network'})`), { kind: 'transient' }); }
  if (r.ok) return;
  const j = await r.json().catch(() => ({})) as { message?: string; name?: string };
  const kind = r.status === 429 || r.status >= 500 ? 'transient' : r.status === 422 && /email|recipient|to/i.test(j.message ?? '') ? 'address' : 'config';
  throw Object.assign(new Error(kind === 'address' ? `받는 주소를 확인해 주세요: ${j.message ?? ''}` : kind === 'transient' ? '워크인 발송이 잠시 바쁩니다 — 자동으로 다시 보냅니다' : `워크인 발송 설정 오류(${r.status}) — 운영팀에 알려 주세요`), { kind });
}

/** 화면용 — 비밀번호는 절대 돌려주지 않는다 */
const publicAccount = (a: AccountRow | null) => a && { provider: a.provider, providerLabel: MAIL_PRESETS[a.provider as MailProvider]?.label ?? a.provider, host: a.host, port: a.port, secure: a.secure,
  username: a.username, fromEmail: a.from_email, fromName: a.from_name, lastOkAt: a.last_ok_at, lastError: a.last_error, updatedAt: a.updated_at };

export async function getMailAccount(u: SessionUser) {
  await requireMenu(u, mailSettingsMenu, 'view');
  const sql = db(), t = tenantOf(u);
  return { account: publicAccount(await loadAccount(t, sql)), presets: Object.entries(MAIL_PRESETS).map(([k, v]) => ({ key: k, ...v })),
    mode: await mailMode(t, sql), channel: await pickChannel(t, sql), workin: { enabled: workinMailEnabled(), from: workinMailEnabled() ? workinFrom() : null },
    canEdit: isMailAdmin(u), allowStaffReplyTo: (await sql<{ a: boolean }[]>`select allow_staff_reply_to a from tenants where id = ${t}`)[0]?.a ?? true,
    // V33 4: 직원 개인 메일 계정 정책 + 연결 현황(누가 어떤 주소로 — 비밀번호는 없음), 현황은 대표·관리자만
    staff: { ...(await staffMailPolicy(t, sql)), connections: isMailAdmin(u) ? await sql<{ userId: string; name: string; fromEmail: string; provider: string; lastOkAt: string | null; lastError: string | null }[]>`
      select a.user_id as "userId", x.name, a.from_email as "fromEmail", a.provider, a.last_ok_at as "lastOkAt", a.last_error as "lastError" from user_mail_accounts a join users x on x.id = a.user_id where a.tenant = ${t} order by x.name` : [] } };
}
/** V33 4 내 메일 계정: 설정 › 내 메일 계정 — 회사가 허용했을 때만 연결할 수 있고, 연결되면 내 발송은 이 계정으로(보낸메일함에도 남음) */
export async function getMyMailAccount(u: SessionUser) {
  const sql = db(); const t = tenantOf(u);
  const pol = await staffMailPolicy(t, sql);
  const a = await loadUserAccount(u.id, sql);
  return { account: publicAccount(a && a.tenant === t ? a : null), presets: Object.entries(MAIL_PRESETS).map(([k, v]) => ({ key: k, ...v })), allowed: pol.allowed, domains: pol.domains, workEmail: u.email };
}
export async function saveMyMailAccount(u: SessionUser, i: z.infer<typeof accountInput>, ip: string | null) {
  const sql = db(); const t = tenantOf(u);
  const pol = await staffMailPolicy(t, sql);
  if (!pol.allowed) throw forbidden('회사 설정에서 직원 개인 메일 계정 연결이 꺼져 있습니다 — 대표·관리자에게 요청하세요(관리 › 메일 계정·명함)');
  const dom = i.fromEmail.split('@')[1]?.toLowerCase() ?? '';
  if (pol.domains.length && !pol.domains.includes(dom)) throw badRequest(`회사가 허용한 메일 도메인(${pol.domains.map((d) => '@' + d).join(', ')})만 연결할 수 있습니다`);
  const prev = await loadUserAccount(u.id, sql);
  const preset = MAIL_PRESETS[i.provider];
  const host = (i.provider === 'custom' ? i.host : i.host || preset.host)?.trim();
  if (!host) throw badRequest('SMTP 서버 주소를 넣어 주세요');
  const port = i.port ?? preset.port; const secure = i.secure ?? preset.secure;
  const password = i.password?.length ? i.password : prev ? decrypt(prev.password_enc) : '';
  if (!password) throw badRequest('앱 비밀번호를 넣어 주세요');
  const conn: Conn = { host, port, secure, username: i.username, password, provider: i.provider };
  const to = i.testTo ?? i.fromEmail;
  try {
    await transport(conn).sendMail({ from: { name: i.fromName || i.fromEmail, address: i.fromEmail }, to, subject: '[워크인] 내 메일 계정 연결 시험',
      text: `워크인에서 보낸 연결 시험 메일입니다.\n이 메일이 받은편지함에 왔고 "보낸메일함"에도 남았는지 확인해 주세요.`, messageId: `<test-${randomUUID()}@workin>` });
  } catch (e) {
    const c = classifySmtpError(e);
    await audit(sql, u.id, 'user_mail_account.test_failed', 'user', u.id, { provider: i.provider, host, kind: c.kind }, ip);
    throw new HttpError(400, 'mail_test_failed', `연결 시험 실패 — ${c.message}. 저장하지 않았습니다.`);
  }
  await sql`insert into user_mail_accounts (user_id, tenant, provider, host, port, secure, username, from_email, from_name, password_enc, last_ok_at, last_error)
    values (${u.id}, ${t}, ${i.provider}, ${host}, ${port}, ${secure}, ${i.username}, ${i.fromEmail}, ${i.fromName ?? null}, ${encrypt(password)}, now(), null)
    on conflict (user_id) do update set tenant = excluded.tenant, provider = excluded.provider, host = excluded.host, port = excluded.port, secure = excluded.secure, username = excluded.username,
      from_email = excluded.from_email, from_name = excluded.from_name, password_enc = excluded.password_enc, last_ok_at = now(), last_error = null, updated_at = now()`;
  await audit(sql, u.id, 'user_mail_account.save', 'user', u.id, { provider: i.provider, host, fromEmail: i.fromEmail }, ip);
  return { ok: true, testSentTo: to, account: publicAccount(await loadUserAccount(u.id, sql)) };
}
export async function deleteMyMailAccount(u: SessionUser, ip: string | null) {
  const sql = db();
  await sql`delete from user_mail_accounts where user_id = ${u.id}`;
  await audit(sql, u.id, 'user_mail_account.delete', 'user', u.id, {}, ip);
  return { ok: true };
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
  requireMailAdmin(u);
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
  requireMailAdmin(u);
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
  return { me: { name: me.name, title: me.title, phone: me.phone, email: me.email, workEmail: me.workEmail }, companies: profiles.map((p) => ({ key: p.key, name: p.name, isDefault: p.is_default,
    sigIntro: p.sig_intro ?? null, sigDisclaimer: p.sig_disclaimer ?? null, sigDisclaimerEn: p.sig_disclaimer_en ?? null, hasLogo: !!p.logo_file_id, html: signatureHtml(p, me) })) };
}

type Sender = { name: string; title: string | null; phone: string | null; email: string };
type SigProfile = CompanyProfile & { sig_intro?: string | null; sig_disclaimer?: string | null; sig_disclaimer_en?: string | null };
/** 메일 명함: 표(table)+인라인 스타일(메일 프로그램 호환). 이름·직급·연락처·이메일 = 보내는 사람, 나머지 = 회사 설정 */
/** 대표 지적(10/19): 명함·서명 주소는 'n층'까지만(호수 등 상세 뺌). 층이 없으면 그대로. 회사 정보의 원래 주소는 바꾸지 않음 */
export function cardAddress(a: string | null | undefined) {
  if (!a) return a ?? null;
  const m = a.match(/^(.*?(?:지하\s*)?\d+\s*층)/);
  return m ? m[1].trim() : a;
}
export function signatureHtml(p: SigProfile, s: Sender) {
  const color = p.brand_color ?? '#0F766E';
  const logo = logoUrl(p);
  const line = (label: string, v: string | null | undefined, href?: string) => v ? `<tr><td style="padding:1px 0;color:#64748b;font-size:12px;width:44px">${label}</td><td style="padding:1px 0;font-size:12px;color:#334155">${href ? `<a href="${esc(href)}" style="color:#334155;text-decoration:none">${esc(v)}</a>` : esc(v)}</td></tr>` : '';
  const web = p.website ? (/^https?:\/\//.test(p.website) ? p.website : `https://${p.website}`) : null;
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;border-collapse:collapse;font-family:'Apple SD Gothic Neo','Malgun Gothic',Arial,sans-serif" data-sig="${esc(p.key)}">
<tr><td colspan="2" style="border-top:2px solid ${color};padding:0;height:12px;line-height:12px;font-size:0">&nbsp;</td></tr>
<tr>${logo ? `<td style="vertical-align:middle;padding:0 18px 0 0;text-align:center"><img src="${esc(logo)}" alt="${esc(p.name)}" width="96" style="display:inline-block;width:96px;max-width:96px;height:auto;border:0;vertical-align:middle"></td>` : ''}
<td style="vertical-align:top;padding:0 0 0 ${logo ? 18 : 0}px;${logo ? 'border-left:1px solid #e2e8f0' : ''}">
<div style="font-size:15px;font-weight:bold;color:#0f172a">${esc(s.name)}${s.title ? ` <span style="font-size:12px;font-weight:normal;color:#475569">${esc(s.title)}</span>` : ''}</div>
<div style="font-size:13px;font-weight:bold;color:${color};margin:2px 0 6px">${esc(p.name)}</div>
<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
${line('T', p.phone, p.phone ? `tel:${p.phone.replace(/[^0-9+]/g, '')}` : undefined)}${line('M', s.phone, s.phone ? `tel:${s.phone.replace(/[^0-9+]/g, '')}` : undefined)}${line('F', p.fax)}
${s.email ? line('E', s.email, `mailto:${s.email}`) : ''}${line('W', p.website, web ?? undefined)}${line('A', cardAddress(p.address))}
</table></td></tr>
${p.sig_intro ? `<tr><td colspan="2" style="padding:10px 0 0;font-size:12px;color:#475569">${esc(p.sig_intro)}</td></tr>` : ''}
${p.sig_disclaimer || p.sig_disclaimer_en ? `<tr><td colspan="2" style="padding:10px 0 0;font-size:10px;line-height:1.5;color:#94a3b8">${esc(p.sig_disclaimer)}${p.sig_disclaimer && p.sig_disclaimer_en ? '<br>' : ''}${esc(p.sig_disclaimer_en)}</td></tr>` : ''}
</table>`;
}
export function signatureText(p: SigProfile, s: Sender) {
  return ['--', `${s.name}${s.title ? ' ' + s.title : ''}`, p.name, [p.phone && `T ${p.phone}`, s.phone && `M ${s.phone}`].filter(Boolean).join(' · '), s.email, p.website, cardAddress(p.address)]
    .filter(Boolean).join('\n');
}
/** V32 7-2 문자 서명(명함형 3줄): "이름 직급 · 회사" / "휴대폰 010-…" / "메일 …" — 보내는 직원 프로필에서, 없는 칸은 생략. 회사 대표번호는 회사 설정 '서명에 대표번호도 넣기'일 때만(기본 끔) */
export const smsSignLine = (p: CompanyProfile, s: Sender, companyPhone = false) =>
  [`${s.name}${s.title ? ' ' + s.title : ''} · ${p.name}`, s.phone ? `휴대폰 ${s.phone}` : '', s.email ? `메일 ${s.email}` : '', companyPhone && p.phone ? `대표 ${p.phone}` : ''].filter(Boolean).join('\n');
/** V32 7-2 회사 설정: 문자 서명에 회사 대표번호도 넣기 */
export async function getSmsSign(u: SessionUser) {
  const [r] = await db()<{ sms_sign_phone: boolean }[]>`select sms_sign_phone from tenants where id = ${tenantOf(u)}`;
  return { companyPhone: !!r?.sms_sign_phone };
}
export async function setSmsSign(u: SessionUser, companyPhone: boolean) {
  await (await import('./menuPerms')).requireAnyMenu(u, ['company', 'ops'], 'edit');
  const sql = db();
  await sql`update tenants set sms_sign_phone = ${companyPhone} where id = ${tenantOf(u)}`;
  await audit(sql, u.id, 'sms_sign.set', 'tenant', null, { companyPhone }, null).catch(() => {});
  return getSmsSign(u);
}

export function bodyHtml(text: string, sig: string, linkBlock = '') {
  const paras = esc(text).replace(/\r\n/g, '\n').split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`).join('');
  return `<div style="font-family:'Apple SD Gothic Neo','Malgun Gothic',Arial,sans-serif;font-size:14px;line-height:1.6;color:#0f172a">${paras}${linkBlock}${sig}</div>`;
}

/** 명함의 보내는 사람: 이메일은 로그인 이메일(개인 메일일 수 있음)을 쓰지 않고 업무 이메일 → 없으면 회사 메일 계정 주소 */
async function sender(userId: string, sql: Sql): Promise<Sender & { workEmail: string | null }> {
  const [s] = await sql<{ name: string; title: string | null; phone: string | null; work_email: string | null; tenant: string }[]>`select name, title, phone, work_email, tenant from users where id = ${userId}`;
  const acc = s.work_email ? null : await loadAccount(s.tenant, sql);
  return { name: s.name, title: s.title, phone: s.phone, email: s.work_email || acc?.from_email || '', workEmail: s.work_email };
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

/** 대표 05:20 ②: 받는 사람 자동 채움 후보 — 문의자 → 업무에 연결된 연락처 → 리드 → 업무 설명에 적힌 이메일·전화 순. 첫 값을 채우고 나머지는 제안 칩 */
export type Candidate = { value: string; label: string; source: 'inquiry' | 'contact' | 'lead' | 'description' };
async function recipientCandidates(taskId: string, contact: Awaited<ReturnType<typeof inquiryContact>>, sql: Sql) {
  const emails: Candidate[] = []; const phones: Candidate[] = [];
  const seenE = new Set<string>(); const seenP = new Set<string>();
  const addE = (v: string | null | undefined, label: string, source: Candidate['source']) => { const x = String(v ?? '').trim().toLowerCase(); if (!x || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x) || seenE.has(x)) return; seenE.add(x); emails.push({ value: x, label, source }); };
  const addP = (v: string | null | undefined, label: string, source: Candidate['source']) => { const d = String(v ?? '').replace(/\D/g, ''); if (d.length < 9 || d.length > 12 || seenP.has(d)) return; seenP.add(d); phones.push({ value: d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : String(v).trim(), label, source }); };
  if (contact) { addE(contact.email, `문의자${contact.name ? ` ${contact.name}` : ''}`, 'inquiry'); addP(contact.phone, `문의자${contact.name ? ` ${contact.name}` : ''}`, 'inquiry'); }
  const linked = await sql<{ name: string; organization: string | null; email: string | null; phone: string | null }[]>`select c.name, c.organization, c.email, c.phone from contacts c join contact_tasks ct on ct.contact_id = c.id where ct.task_id = ${taskId} and c.deleted_at is null order by ct.linked_at`;
  for (const c of linked) { const l = `연락처 ${c.name}${c.organization ? `(${c.organization})` : ''}`; addE(c.email, l, 'contact'); addP(c.phone, l, 'contact'); }
  const [task] = await sql<{ description: string | null; lead_id: string | null }[]>`select description, lead_id from tasks where id = ${taskId}`;
  if (task?.lead_id) {
    const [lead] = await sql<{ name: string; contact_name: string | null; email: string | null; phone: string | null }[]>`select name, contact_name, email, phone from sales_leads where id = ${task.lead_id}`;
    if (lead) { const l = `리드 ${lead.name}${lead.contact_name ? ` · ${lead.contact_name}` : ''}`; addE(lead.email, l, 'lead'); addP(lead.phone, l, 'lead'); }
  }
  const desc = String(task?.description ?? '');
  for (const m of desc.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) addE(m, '업무 설명', 'description');
  for (const m of desc.match(/0\d{1,2}[-. ]?\d{3,4}[-. ]?\d{4}/g) ?? []) addP(m, '업무 설명', 'description');
  return { emails: emails.slice(0, 6), phones: phones.slice(0, 6) };
}

/** 업무의 메일 시안 기본값 + 보낼 수 있는 첨부 + 이 업무 발송 기록 */
export async function mailContext(u: SessionUser, taskId: string) {
  const { task } = await loadTaskForMail(u, taskId);
  const sql = db(); const t = tenantOf(u);
  const [profiles, account, contact, me, atts, history] = await Promise.all([
    companyProfiles(t, sql) as Promise<SigProfile[]>,
    loadAccount(t, sql), inquiryContact(taskId, sql), sender(u.id, sql),
    sql`select id, file_name, mime_type, size_bytes, doc_title, storage_key, source from attachments where task_id = ${taskId} and kind = 'file' and deleted_at is null and upload_status = 'ready' order by created_at`,
    taskOutbox(taskId, sql),
  ]);
  const candidates = await recipientCandidates(taskId, contact, sql);
  const mine = await personalAccount(u, sql); // V33 4: 내 계정이 연결돼 있으면 시안의 보내는 주소·회신 주소가 그 계정
  const [tn] = await sql<{ sms_sign_phone: boolean }[]>`select sms_sign_phone from tenants where id = ${t}`;
  const sigs = await Promise.all(profiles.map(async (p) => ({ key: p.key, name: p.name, isDefault: p.is_default, html: signatureHtml(p, me), smsLine: smsSignLine(p, me, !!tn?.sms_sign_phone) })));
  // 문의 사이트에 맞는 회사(하이링크 문의 → hilink)가 있으면 그 회사, 아니면 기본 회사
  const guess = contact?.site && profiles.some((p) => p.key === contact.site) ? contact.site : (profiles.find((p) => p.is_default) ?? profiles[0])?.key ?? null;
  return {
    canSend: await canSend(u, sql), account: mine ? { fromEmail: mine.from_email, fromName: mine.from_name, lastOkAt: mine.last_ok_at, mine: true } : account ? { fromEmail: account.from_email, fromName: account.from_name, lastOkAt: account.last_ok_at, mine: false } : null,
    channel: mine ? 'email:smtp' as const : await pickChannel(t, sql), workinFrom: workinMailEnabled() ? workinFrom() : null,
    defaults: { fromName: defaultFromName(me, (profiles.find((p) => p.key === guess) ?? profiles[0])?.name ?? ''), replyTo: mine ? mine.from_email : me.workEmail || account?.from_email || u.email },
    replyToEditable: await replyToEditable(u, sql),
    kinds: Object.entries(MAIL_KINDS).map(([k, v]) => ({ key: k, ...v })), companies: sigs, company: guess,
    to: candidates.emails[0] ? [candidates.emails[0].value] : [], phone: candidates.phones[0]?.value ?? null, candidates, contact, me: { name: me.name, title: me.title, phone: me.phone, email: me.email, workEmail: me.workEmail },
    // V34 C1: 기밀·자료실에서 지운 첨부는 외부 발송 불가 — 대표 05:20 ①: 목록에서 조용히 빼지 않고 '왜 못 보내는지'와 함께 보여 준다(자료실 연결 첨부는 출처 '자료실' 배지)
    attachments: (await Promise.all(atts.map(async (a: any) => { const sec = await (await import('./library')).storageSecurity(t, a.storage_key); const blocked = sec?.deleted ? 'deleted' : sec?.security === 'confidential' ? 'confidential' : null;
      return { id: a.id, name: a.file_name, size: Number(a.size_bytes), mime: a.mime_type, title: a.doc_title, source: a.source ?? 'upload', blocked }; }))),
    linkThresholdBytes: LINK_THRESHOLD, history, taskTitle: task.title,
  };
}
async function taskOutbox(taskId: string, sql: Sql) {
  return sql`select o.id, o.channel, o.status, o.to_addrs, o.cc_addrs, o.bcc_addrs, o.from_name, o.reply_to, o.subject, left(o.body_text, 200) as preview, o.files, o.as_link, o.attempts, o.last_error, o.error_kind, o.sent_at, o.created_at,
      o.next_attempt_at, o.scheduled_at, o.created_by, u.name as sender_name, s.first_opened_at, case when o.channel like 'sms:%' then o.body_text end as sms_body
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
  confirmConfidential: z.boolean().optional(), // V38 4: 이름 규칙상 기밀로 분류된 업무 첨부 — 경고 확인 후 보냄
  company: z.string().regex(/^[a-z0-9_-]{2,30}$/),
  to: emails.min(1, '받는 사람을 넣어 주세요'),
  cc: emails.optional(),
  bcc: emails.optional(),
  /** B1: 보내는 이름·회신 주소 — 비우면 "이름 직급 (회사)" · 직원 업무 이메일 */
  fromName: z.string().trim().max(80).optional(),
  replyTo: z.string().trim().email('회신 주소 형식이 아닙니다').max(200).optional().or(z.literal('')),
  subject: z.string().trim().min(1, '제목을 넣어 주세요').max(200),
  body: z.string().max(20000),
  attachmentIds: z.array(z.string().uuid()).max(20).optional(),
  /** 로컬 검수 10/17 보안: 자료실에서 고른 파일은 업무 첨부로 붙이지 않고 이 발송에만 담는다 */
  libraryFileIds: z.array(z.string().uuid()).max(20).optional(),
  /** 보내는 사람 명함 정보가 비어 있을 때 한 번 받아 프로필에 저장(학습) */
  senderTitle: z.string().trim().max(50).optional(),
  senderPhone: z.string().trim().max(40).optional(),
  senderWorkEmail: z.string().trim().email('업무 이메일 형식이 아닙니다').max(200).optional(),
  /** 대표 요청(10/19): 예약 보내기 — 이 시각(KST 로 고른 값, 오프셋 포함)에 정기 실행이 보냄. 비우면 바로 */
  sendAt: z.string().datetime({ offset: true }).optional(),
});
/** 예약 시각 검사: 1분 뒤 ~ 60일 안 */
function checkSendAt(v: string) {
  const at = new Date(v);
  if (at.getTime() < Date.now() + 60_000) throw badRequest('예약 시각은 지금보다 뒤여야 합니다');
  if (at.getTime() > Date.now() + 60 * 86400_000) throw badRequest('예약은 60일 안으로만 할 수 있습니다');
  return at;
}

export async function queueMail(u: SessionUser, i: z.infer<typeof sendInput>, ip: string | null) {
  if (!(await canSend(u))) throw forbidden('메일 보내기 권한이 없습니다 — 대표에게 요청하세요(설정 > 메뉴 권한 > 외부 발송)');
  const { task } = await loadTaskForMail(u, i.taskId);
  const sql = db(); const t = tenantOf(u);
  const mine = await personalAccount(u, sql); // V33 4: 내 메일 계정이 연결돼 있으면 그걸로(내 보낸메일함에도 남음)
  const channel = mine ? 'email:smtp' : await pickChannel(t, sql);
  if (!channel) throw new HttpError(409, 'mail_account_missing', '메일을 보낼 방법이 아직 없습니다 — 설정 > 메일에서 회사 메일 계정을 연결하거나 워크인 발송을 켜 주세요');
  const account = mine ?? (channel === 'email:smtp' ? await loadAccount(t, sql) : null);
  const [profile] = (await companyProfiles(t, sql)).filter((p) => p.key === i.company) as SigProfile[];
  if (!profile) throw notFound('회사 정보가 없습니다');
  // 명함 학습: 직급·휴대폰이 비어 있으면 이번에 받은 값을 프로필에 저장
  if (i.senderTitle || i.senderPhone || i.senderWorkEmail) {
    await sql`update users set title = coalesce(nullif(title, ''), ${i.senderTitle || null}), phone = coalesce(nullif(phone, ''), ${i.senderPhone || null}),
      work_email = coalesce(nullif(work_email, ''), ${i.senderWorkEmail || null}), updated_at = now() where id = ${u.id}`;
  }
  const me = await sender(u.id, sql);
  const ids = [...new Set(i.attachmentIds ?? [])];
  const files = ids.length ? await sql<{ id: string; file_name: string; size_bytes: string; mime_type: string; storage_key: string }[]>`
    select id, file_name, size_bytes, mime_type, storage_key from attachments where id = any(${ids}::uuid[]) and task_id = ${i.taskId} and kind = 'file' and deleted_at is null and upload_status = 'ready'` : [];
  if (files.length !== ids.length) throw badRequest('이 업무의 첨부만 보낼 수 있습니다');
  const lib = await libraryFilesForSend(u, i.libraryFileIds);
  await assertExportable(t, [...files, ...lib], { u, confirm: i.confirmConfidential, how: 'mail' }); // V34 C1 기밀·지운 자료는 외부 메일로 안 나감
  const list: SendFile[] = [...ids.map((id) => files.find((f) => f.id === id)!).map((f) => ({ attachmentId: f.id, name: f.file_name, size: Number(f.size_bytes), mime: f.mime_type })),
    ...lib.map((f) => ({ libraryFileId: f.id, name: f.file_name, size: Number(f.size_bytes), mime: f.mime_type }))];
  if (list.length > 20) throw badRequest('첨부는 20개까지 보낼 수 있습니다');
  const total = list.reduce((s, f) => s + f.size, 0);
  const asLink = total > LINK_THRESHOLD;
  let linkBlock = ''; let linkText = ''; let shareId: string | null = null;
  if (asLink) {
    const s = await createShare(sql, t, i.taskId, u.id, list, i.company);
    shareId = s.id;
    linkBlock = `<p style="margin:0 0 12px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc">첨부 자료 ${list.length}개 (${(total / 1048576).toFixed(1)}MB)는 용량이 커서 링크로 보내 드립니다.<br><a href="${esc(s.url)}">${esc(s.url)}</a><br><span style="font-size:12px;color:#64748b">${s.expiresAt.slice(0, 10)}까지 내려받을 수 있습니다.</span></p>`;
    linkText = `\n\n첨부 자료(${list.length}개)는 용량이 커서 링크로 보내 드립니다: ${s.url} (${s.expiresAt.slice(0, 10)}까지)`;
  }
  const html = bodyHtml(i.body, signatureHtml(profile, me), linkBlock);
  const text = `${i.body}${linkText}\n\n${signatureText(profile, me)}`;
  const fromEmail = account ? account.from_email : workinFrom();
  const domain = fromEmail.split('@')[1] ?? 'workin';
  // B1 보내는 사람별: 이름 "이름 직급 (회사)", 회신 = 직원 업무 이메일(없으면 회사 계정/로그인 이메일) — 둘 다 시안에서 바꿀 수 있음
  const fromName = (i.fromName || defaultFromName(me, profile.name)).slice(0, 80);
  // V32 6: 회사가 막았으면 직원 회신 주소는 늘 본인 업무 이메일
  const replyTo = ((await replyToEditable(u, sql)) && i.replyTo) || (mine ? mine.from_email : me.workEmail || account?.from_email || u.email);
  const id = randomUUID();
  const at = i.sendAt ? checkSendAt(i.sendAt) : null;
  await sql`insert into outbox (id, tenant, channel, status, task_id, company_key, created_by, from_email, from_name, reply_to, to_addrs, cc_addrs, bcc_addrs, subject, body_text, body_html, files, as_link, share_id, message_id, scheduled_at, next_attempt_at, account_user_id)
    values (${id}, ${t}, ${channel}, 'queued', ${i.taskId}, ${i.company}, ${u.id}, ${fromEmail}, ${fromName}, ${replyTo}, ${i.to}, ${i.cc ?? []}, ${i.bcc ?? []}, ${i.subject}, ${text}, ${html},
      ${sql.json(list as never)}, ${asLink}, ${shareId}, ${`<${id}@${domain}>`}, ${at}, ${at ?? new Date()}, ${mine ? u.id : null})`;
  await activity(sql, 'task', i.taskId, u.id, at ? 'mail_scheduled' : 'mail_queued', { to: i.to, subject: i.subject, files: list.map((f) => f.name), asLink, ...(at ? { sendAt: at.toISOString() } : {}) });
  await audit(sql, u.id, at ? 'mail.schedule' : 'mail.queue', 'task', i.taskId, { outboxId: id, to: i.to, files: list.length, asLink, sendAt: at?.toISOString() ?? null }, ip);
  await rememberSent(sql, t, u.id, i.taskId, [...i.to, ...(i.cc ?? [])].map((email) => ({ email })));
  return { id, status: 'queued', asLink, taskTitle: task.title, channel, scheduledAt: at?.toISOString() ?? null };
}
/**
 * 시스템 메일(당일 공고·브리핑 등) 경로 — #509(대표 10/23): 워크인 발송(Resend)을 먼저 쓰고 회사 SMTP 는 워크인 발송이 없을 때만.
 * 회사 계정으로 보내면 회사 메일함에는 보낸메일함에만 남고, 회사 주소로 받으려 해도 자기 자신에게 보내는 메일이 된다. smtpFrom = 회사 계정 주소(답장 주소 기본값·화면 안내)
 */
export async function systemChannel(tenant: string, sql: Sql = db()): Promise<{ channel: 'email:workin' | 'email:smtp' | null; smtpFrom: string | null }> {
  const acc = await loadAccount(tenant, sql);
  if (workinMailEnabled()) return { channel: 'email:workin', smtpFrom: acc?.from_email ?? null };
  return { channel: acc ? 'email:smtp' : null, smtpFrom: acc?.from_email ?? null };
}
/** 로컬 10/21 11:30: 시스템 메일을 큐에 넣는다(경로는 systemChannel). 경로가 없으면 null(호출 쪽이 다른 길을 씀).
 *  회사 SMTP 로 보낼 때는 받는 사람에서 보내는 주소(회사 주소)를 뺀다 — 남는 사람이 없으면 보내지 않고 skipped='self' */
export async function queueSystemMail(tenant: string, m: { to: string[]; subject: string; text: string; html?: string; replyTo?: string | null; createdBy: string; fromName?: string }, sql: Sql = db()) {
  const { channel } = await systemChannel(tenant, sql); if (!channel) return null;
  const account = channel === 'email:smtp' ? await loadAccount(tenant, sql) : null;
  const to = account ? m.to.filter((a) => a.toLowerCase() !== account.from_email.toLowerCase()) : m.to;
  if (!to.length) return { id: null, channel, to, skipped: 'self' as const };
  const fromEmail = account ? account.from_email : workinFrom(); const domain = fromEmail.split('@')[1] ?? 'workin';
  const id = randomUUID();
  await sql`insert into outbox (id, tenant, channel, status, created_by, from_email, from_name, reply_to, to_addrs, subject, body_text, body_html, message_id, next_attempt_at)
    values (${id}, ${tenant}, ${channel}, 'queued', ${m.createdBy}, ${fromEmail}, ${(m.fromName ?? account?.from_name ?? '워크인').slice(0, 80)}, ${m.replyTo || null}, ${to}, ${m.subject.slice(0, 200)}, ${m.text}, ${m.html ?? bodyHtml(m.text, '')}, ${`<${id}@${domain}>`}, now())`;
  return { id, channel, to, skipped: null };
}
export const defaultFromName = (me: { name: string; title: string | null }, company: string) => `${me.name}${me.title ? ` ${me.title}` : ''} (${company})`;

/** 예약 바꾸기·취소(보낸 사람·대표만, 아직 보내기 전인 예약만) */
export const scheduleInput = z.object({ sendAt: z.string().datetime({ offset: true }).optional(), cancel: z.boolean().optional() });
export async function rescheduleOutbox(u: SessionUser, id: string, i: z.infer<typeof scheduleInput>) {
  const sql = db();
  const [o] = await sql<{ task_id: string | null; status: string; created_by: string; scheduled_at: Date | null; subject: string }[]>`select task_id, status, created_by, scheduled_at, subject from outbox where id = ${id} and tenant = ${tenantOf(u)}`;
  if (!o) throw notFound();
  if (o.task_id) await loadTaskForMail(u, o.task_id);
  if (o.created_by !== u.id && u.role !== 'owner') throw forbidden('예약은 보낸 사람이나 대표만 바꿀 수 있습니다');
  if (!o.scheduled_at) throw badRequest('예약 메일이 아닙니다');
  if (i.cancel) {
    const r = await sql`update outbox set status = 'canceled' where id = ${id} and status in ('queued', 'due') and (locked_until is null or locked_until < now()) returning id`;
    if (!r.length) throw new HttpError(409, 'not_scheduled', '이미 보내는 중이거나 보낸 메일이라 취소할 수 없습니다');
    if (o.task_id) await activity(sql, 'task', o.task_id, u.id, 'mail_schedule_canceled', { subject: o.subject });
    return { ok: true, status: 'canceled' };
  }
  if (!i.sendAt) throw badRequest('바꿀 시각을 넣어 주세요');
  const at = checkSendAt(i.sendAt);
  const r = await sql`update outbox set scheduled_at = ${at}, next_attempt_at = ${at} where id = ${id} and status = 'queued' and (locked_until is null or locked_until < now()) returning id`;
  if (!r.length) throw new HttpError(409, 'not_scheduled', '이미 보내는 중이거나 보낸 메일이라 바꿀 수 없습니다');
  if (o.task_id) await activity(sql, 'task', o.task_id, u.id, 'mail_rescheduled', { subject: o.subject, sendAt: at.toISOString() });
  return { ok: true, scheduledAt: at.toISOString() };
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
  // #177 문자·카카오톡 예약: 서버는 보내지 못하므로(유료 발송 없음) '보낼 시간'(due)으로 바꾸고 보낸 사람에게 알림 → 휴대폰 문자앱에서 사람이 보내고 [보냈어요]
  if (/:handoff$/.test(o.channel)) {
    await sql`update outbox set status = 'due', locked_until = null where id = ${id}`;
    await notify(sql, { userIds: [o.created_by], type: 'sms_due', title: `예약한 문자를 보낼 시간입니다: ${(o.to_addrs as string[]).join(', ')}`, body: String(o.body_text ?? '').slice(0, 120),
      link: o.task_id ? `/tasks/${o.task_id}?sms=${id}` : '/tasks', entityType: 'task', entityId: o.task_id ?? undefined, dedupeKey: `sms_due:${id}`, push: true });
    if (o.task_id) await activity(sql, 'task', o.task_id, o.created_by, 'sms_due', { to: o.to_addrs });
    return 'due';
  }
  try {
    const workin = o.channel === 'email:workin';
    const account = workin ? null : o.account_user_id ? await loadUserAccount(o.account_user_id, sql) : await loadAccount(o.tenant, sql);
    if (!workin && !account) throw Object.assign(new Error('메일 계정이 연결되지 않았습니다'), { code: 'NOACCOUNT' });
    if (workin && !workinMailEnabled()) throw Object.assign(new Error('워크인 발송이 꺼져 있습니다 — 회사 메일 계정을 연결하세요'), { code: 'NOACCOUNT' });
    const attachments = o.as_link ? [] : await Promise.all((o.files as SendFile[]).map(async (f) => {
      const [a] = await fileKey(sql, f, o.tenant);
      if (!a) throw Object.assign(new Error(`첨부가 지워졌습니다: ${f.name}`), { code: 'NOFILE' });
      const { getObject } = await import('./storage');
      return { filename: f.name, content: await getObject(a.storage_key), contentType: f.mime };
    }));
    if (workin) {
      await resendSend({ from: `"${String(o.from_name ?? '워크인').replace(/"/g, '')}" <${workinFrom()}>`, to: o.to_addrs, cc: o.cc_addrs, bcc: o.bcc_addrs, replyTo: o.reply_to ?? undefined,
        subject: o.subject, text: o.body_text, html: o.body_html ?? undefined, messageId: o.message_id, attachments });
    } else {
      await transport({ host: account!.host, port: account!.port, secure: account!.secure, username: account!.username, password: decrypt(account!.password_enc), provider: account!.provider })
        .sendMail({ from: { name: o.from_name || account!.from_name || account!.from_email, address: account!.from_email }, to: o.to_addrs, cc: o.cc_addrs?.length ? o.cc_addrs : undefined,
          bcc: o.bcc_addrs?.length ? o.bcc_addrs : undefined, subject: o.subject, text: o.body_text, html: o.body_html ?? undefined, attachments, messageId: o.message_id, replyTo: o.reply_to || account!.from_email });
    }
    await sql`update outbox set status = 'sent', sent_at = now(), locked_until = null, last_error = null, error_kind = null where id = ${id}`;
    if (!workin) {
      if (o.account_user_id) await sql`update user_mail_accounts set last_ok_at = now(), last_error = null where user_id = ${o.account_user_id}`;
      else await sql`update mail_accounts set last_ok_at = now(), last_error = null where tenant = ${o.tenant}`;
    }
    if (o.task_id) {
      await activity(sql, 'task', o.task_id, o.created_by, 'mail_sent', { to: o.to_addrs, subject: o.subject, files: (o.files as any[]).map((f) => f.name), asLink: o.as_link });
      await crmSteps(sql, o.task_id, o.subject, o.files as any[]);
    }
    // 예약 메일은 보낸 사람에게 결과 알림(바로 보낸 메일은 화면에서 바로 보임)
    if (o.scheduled_at) await notify(sql, { userIds: [o.created_by], type: 'mail_sent', title: `예약 메일을 보냈습니다: ${o.subject}`, body: `받는 사람 ${(o.to_addrs as string[]).join(', ')}`,
      link: o.task_id ? `/tasks/${o.task_id}` : '/admin/mail', entityType: 'task', entityId: o.task_id ?? undefined, dedupeKey: `mail_sched_sent:${id}` });
    return 'sent';
  } catch (e: any) {
    const c = e?.code === 'NOACCOUNT' || e?.code === 'NOFILE' ? { kind: 'config' as const, message: e.message } : e?.kind ? { kind: e.kind as SendErrKind, message: e.message as string } : classifySmtpError(e);
    // 예약 메일: 일시 오류는 1번만 다시(대표 요청 10/19), 그다음 실패 알림
    const retry = c.kind === 'transient' && o.attempts <= (o.scheduled_at ? 1 : RETRY_MIN.length);
    await sql`update outbox set status = ${retry ? 'retry' : 'failed'}, locked_until = null, last_error = ${c.message}, error_kind = ${c.kind},
      next_attempt_at = now() + make_interval(mins => ${retry ? RETRY_MIN[o.attempts - 1] : 0}) where id = ${id}`;
    if (c.kind === 'auth' && o.channel === 'email:smtp') {
      if (o.account_user_id) await sql`update user_mail_accounts set last_error = ${c.message} where user_id = ${o.account_user_id}`;
      else await sql`update mail_accounts set last_error = ${c.message} where tenant = ${o.tenant}`;
    }
    if (!retry) {
      if (o.task_id) await activity(sql, 'task', o.task_id, o.created_by, 'mail_failed', { to: o.to_addrs, subject: o.subject, error: c.message });
      // 보낸 사람 + 대표에게 알림 (다시 보내기는 업무 화면)
      const owners = (await sql<{ id: string }[]>`select id from users where tenant = ${o.tenant} and role = 'owner' and status = 'active' and not is_demo`).map((r) => r.id);
      await notify(sql, { userIds: [o.created_by, ...owners], type: 'mail_status', title: `${o.scheduled_at ? '예약 ' : ''}메일 발송 실패: ${o.subject}`, body: c.message,
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
/** V34 C1: 기밀 자료(자료실 등급·폴더 상속)·자료실에서 지운 파일은 공개 링크·외부 메일로 내보내지 않는다 */
async function assertExportable(tenant: string, files: { storage_key: string; file_name: string }[], ctx?: { u: SessionUser; confirm?: boolean; how: 'mail' | 'share' }) {
  const { storageSecurity } = await import('./library');
  for (const f of files) {
    const s = await storageSecurity(tenant, f.storage_key);
    if (s?.deleted) throw badRequest(`자료실에서 지운 파일입니다: ${f.file_name}`);
    if (s?.security === 'confidential') throw forbidden(`기밀 자료는 외부 링크·메일로 보낼 수 없습니다: ${f.file_name}`);
  }
  // V38 4(로컬 검수): 업무에서 올린 파일이 이름 규칙으로 기밀 분류(자동 등록 행)됐으면 막지 않고 경고 + 확인 한 번, 보내면 감사 기록
  const keys = files.map((f) => f.storage_key).filter(Boolean);
  if (!ctx || !keys.length) return;
  const sql = db();
  const flagged = await sql<{ id: string; storage_key: string }[]>`select id, storage_key from library_files where tenant = ${tenant} and storage_key = any(${keys}::text[])
    and source = 'task_attach' and security = 'confidential' and deleted_at is null`;
  if (!flagged.length) return;
  const names = files.filter((f) => flagged.some((x) => x.storage_key === f.storage_key)).map((f) => f.file_name);
  if (!ctx.confirm) throw new HttpError(409, 'confirm_confidential', `이 파일은 기밀로 분류됐습니다(파일 이름 규칙): ${names.join(', ')}\n외부로 보내시겠어요?`, { files: names });
  for (const x of flagged) await audit(sql, ctx.u.id, 'library.confidential_share_confirmed', 'library_file', x.id, { how: ctx.how, files: names }, null);
}
type SendFile = { attachmentId?: string; libraryFileId?: string; name: string; size: number; mime?: string };
/** 보낼 파일의 저장 위치 — 업무 첨부 또는 (업무에 붙이지 않은) 자료실 파일 */
function fileKey(sql: Sql, f: SendFile, tenant: string, live = false) {
  return f.libraryFileId
    ? sql<{ storage_key: string }[]>`select storage_key from library_files where id = ${f.libraryFileId} and tenant = ${tenant} and upload_status = 'ready' and (${!live} or deleted_at is null)`
    : sql<{ storage_key: string }[]>`select storage_key from attachments where id = ${f.attachmentId ?? null} and (${!live} or (upload_status = 'ready' and deleted_at is null))`;
}
async function libraryFilesForSend(u: SessionUser, ids?: string[]) {
  const { loadLibraryFile } = await import('./library');
  const out: { id: string; file_name: string; size_bytes: string; mime_type: string; storage_key: string }[] = [];
  for (const id of [...new Set(ids ?? [])]) {
    const f = await loadLibraryFile(u, id, 'meta'); // 볼 수 없는 자료는 404
    if (f.upload_status !== 'ready') throw badRequest('아직 올리는 중인 자료입니다');
    out.push(f);
  }
  return out;
}
async function createShare(sql: Sql, tenant: string, taskId: string | null, userId: string, files: SendFile[], companyKey: string | null = null) {
  const token = newToken(24);
  const expiresAt = new Date(Date.now() + SHARE_DAYS * 86400_000).toISOString();
  const [s] = await sql<{ id: string }[]>`insert into share_links (tenant, token_hash, task_id, created_by, files, expires_at, company_key)
    values (${tenant}, ${sha256(token)}, ${taskId}, ${userId}, ${sql.json(files.map((f) => ({ ...(f.libraryFileId ? { libraryFileId: f.libraryFileId } : { attachmentId: f.attachmentId }), name: f.name, size: f.size })) as never)}, ${expiresAt}, ${companyKey}) returning id`;
  return { id: s.id, url: `${appUrl()}/d/${token}`, expiresAt };
}
/** 문자에 넣을 링크 등 — 사람이 고른 첨부로 링크만 만든다 */
export const shareInput = z.object({ taskId: z.string().uuid(), confirmConfidential: z.boolean().optional(), attachmentIds: z.array(z.string().uuid()).max(20).default([]),
  libraryFileIds: z.array(z.string().uuid()).max(20).optional(), company: z.string().regex(/^[a-z0-9_-]{2,30}$/).optional() })
  .refine((x) => x.attachmentIds.length + (x.libraryFileIds?.length ?? 0) > 0, '보낼 파일을 골라 주세요');
export async function createTaskShare(u: SessionUser, i: z.infer<typeof shareInput>) {
  await loadTaskForMail(u, i.taskId);
  const sql = db();
  const files = await sql<{ id: string; file_name: string; size_bytes: string; storage_key: string }[]>`select id, file_name, size_bytes, storage_key from attachments
    where id = any(${i.attachmentIds}::uuid[]) and task_id = ${i.taskId} and kind = 'file' and deleted_at is null and upload_status = 'ready'`;
  if (files.length !== new Set(i.attachmentIds).size) throw badRequest('이 업무의 첨부만 링크로 만들 수 있습니다');
  const lib = await libraryFilesForSend(u, i.libraryFileIds);
  await assertExportable(tenantOf(u), [...files, ...lib], { u, confirm: i.confirmConfidential, how: 'share' });
  const s = await createShare(sql, tenantOf(u), i.taskId, u.id, [...files.map((f) => ({ attachmentId: f.id, name: f.file_name, size: Number(f.size_bytes) })),
    ...lib.map((f) => ({ libraryFileId: f.id, name: f.file_name, size: Number(f.size_bytes) }))], i.company ?? null);
  await activity(sql, 'task', i.taskId, u.id, 'share_created', { files: [...files, ...lib].map((f) => f.file_name), expiresAt: s.expiresAt });
  return s;
}
async function loadShare(token: string) {
  // V34 A5: 보낸 회사 = 메일·문자에서 고른 회사(없으면 회사 기본)
  const [s] = await db()<any[]>`select s.*, coalesce(c.name, '') as company from share_links s left join lateral (
      select p.name from company_profiles p where p.tenant = s.tenant order by (p.key = s.company_key) desc nulls last, p.is_default desc limit 1) c on true where s.token_hash = ${sha256(token)}`;
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
      await notify(sql, { userIds: [s.created_by], type: 'mail_sent', title: '고객이 보낸 자료를 열어 봤습니다', body: (s.files as any[]).map((f) => f.name).join(', ').slice(0, 200),
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
  const [a] = await fileKey(sql, f, s.tenant, true);
  if (!a) throw notFound('파일이 지워졌습니다');
  // V34 C1: 링크를 만든 뒤 기밀로 바뀌었거나 자료실에서 지웠으면 내려받지 못함
  const { storageSecurity } = await import('./library');
  const sec = await storageSecurity(s.tenant, a.storage_key);
  if (sec?.deleted || sec?.security === 'confidential') throw notFound('보낸 분이 더 이상 공유하지 않는 파일입니다');
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

// ---------------- V21 2차: AI 초안·자료 추천 / 문자 넘기기 기록 ----------------
export const DRAFT_INTENTS = { send: '자료 보냄', progress: '진행 안내', schedule: '일정 확인', thanks: '감사 인사' } as const;
export const draftInput = z.object({ taskId: z.string().uuid(), kind: z.enum(Object.keys(MAIL_KINDS) as [MailKind, ...MailKind[]]), company: z.string().regex(/^[a-z0-9_-]{2,30}$/).optional(), channel: z.enum(['email', 'sms']).default('email'),
  intent: z.enum(Object.keys(DRAFT_INTENTS) as [keyof typeof DRAFT_INTENTS, ...(keyof typeof DRAFT_INTENTS)[]]).optional(), hasFiles: z.boolean().optional() });
const korDate = (d: string) => `${+d.slice(5, 7)}월 ${+d.slice(8, 10)}일(${'일월화수목금토'[new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))).getUTCDay()]})`;
/** V32 7-1 초안 후처리: 대괄호 빈칸([날짜]·[이름])이 남으면 경고, 문자 90바이트 넘으면 LMS 안내 */
export function draftWarnings(body: string, channel: 'email' | 'sms') {
  const w: string[] = [];
  const ph = [...new Set(body.match(/\[[^\]\n]{1,12}\]/g) ?? [])];
  if (ph.length) w.push(`빈칸이 남아 있습니다: ${ph.join(' ')} — 보내기 전에 실제 값으로 채워 주세요`);
  if (channel === 'sms') { const b = [...body].reduce((n, ch) => n + (ch.charCodeAt(0) > 127 ? 2 : 1), 0); if (b > 90) w.push(`${b}바이트 — 90바이트를 넘어 LMS(장문)로 갑니다. 핵심 2~3문장이면 충분합니다`); }
  return w;
}
const DRAFT_SYSTEM = `회사 영업·고객 응대 메일(또는 문자) 초안을 씁니다. 사람이 보고 고친 뒤 직접 보냅니다.
- 한국어 존댓말, 짧고 정중하게. 메일 본문은 3~6문장, 2~3문장마다 빈 줄. 문자는 2~3문장(명함·서명·링크는 시스템이 붙이므로 쓰지 않음).
- 업무 내용·문의 내용에 있는 사실만 씁니다. 금액·날짜·약속을 지어내지 않습니다.
- 대괄호 빈칸([날짜]·[이름]·[금액] 등)은 절대 쓰지 않습니다. 모르는 값은 그 문장을 빼고 씁니다.
- [첨부] 있음이면 "요청하신 ○○ 자료를 보내드립니다. 아래 링크(14일)에서 받아 보세요" 처럼 '보내드림' 문장이 기본입니다(업무 상태와 무관, "확인 중·다시 안내" 금지).
  [첨부] 없음이고 진행 중이면 진행 안내 — [업무 마감]이 있으면 그 날짜로 "○월 ○일(○)까지 안내드리겠습니다", 없으면 날짜 문장을 뺍니다.
- 받는 사람 전화·이메일은 쓰지 않습니다. 호칭은 [받는 사람 호칭]이 있으면 그것(예: "관리소장님"), 없으면 "안녕하세요."로 시작합니다("담당자님" 금지).
- [의도]가 있으면 그 목적에 맞게만 씁니다(자료 보냄 / 진행 안내 / 일정 확인 / 감사 인사).
- [쓰는 사람]이 [우리 회사]를 대표해 보내는 글입니다. 그 사람의 직책에 맞는 어조로, 회사의 사업 방향·주요 고객·말투에 맞춰 씁니다. 자기소개가 필요하면 "(회사) (직책) (이름)입니다".
- recommend: 보낼 자료 후보 목록에서 이 고객에게 보내면 좋은 자료 번호를 최대 3개(없으면 빈 배열).`;
const DRAFT_SCHEMA = { type: 'object', additionalProperties: false, required: ['subject', 'body', 'recommend'],
  properties: { subject: { type: 'string' }, body: { type: 'string' }, recommend: { type: 'array', items: { type: 'integer' } } } };

/** [AI 초안]: 제목·본문 + 자료실 추천 상위 3 (초안만 — 보내기는 사람) */
export async function draftMail(u: SessionUser, i: z.infer<typeof draftInput>) {
  const { task } = await loadTaskForMail(u, i.taskId);
  await requireMenu(u, 'assistant', 'use');
  const P = await import('./ai/provider');
  if (!P.aiEnabled()) throw new HttpError(503, 'ai_off', 'AI 가 설정되지 않았습니다 — 양식 문구로 작성해 주세요');
  const G = await import('./ai/guard');
  await G.assertUserBudget(u);
  await (await import('./plans')).assertAiRequest(u);
  const sql = db();
  const [t] = await sql<{ description: string | null; due_date: string | null }[]>`select description, due_date::text as due_date from tasks where id = ${i.taskId}`;
  const items = await sql<{ text: string; done: boolean }[]>`select text, done from task_checklist_items where task_id = ${i.taskId} order by sort`;
  const contact = await inquiryContact(i.taskId, sql);
  const lib = await (await import('./library')).listLibrary(u, { limit: 60 }).catch(() => ({ files: [] as any[] }));
  // V38 4: 이 업무에 이미 올린 첨부(자동 등록된 자료실 행)는 추천 후보에서 뺀다 — 같은 파일을 다시 권하지 않게
  const cands = (lib.files as any[]).filter((f) => f.effective_security !== 'confidential' && f.task_id !== i.taskId).slice(0, 60);
  const desc = (t?.description ?? '').replace(/\*\*연락처[\s\S]*?(?=\*\*문의 내용 원문\*\*|$)/, ''); // 연락처는 AI 에 보내지 않는다
  const kind = MAIL_KINDS[i.kind];
  const profile = i.company ? (await companyProfiles(tenantOf(u), sql)).find((p) => p.key === i.company) : null;
  const Pn = await import('./ai/persona');
  const [co, me] = await Promise.all([Pn.companyAi(u, sql), Pn.writerOf(u, sql)]);
  const honor = contact?.name ? `${String(contact.name).replace(/\s*(님|씨)$/, '')}님` : '';
  const prompt = [`[종류] ${i.channel === 'sms' ? '문자' : '메일'} · ${kind.label}`, i.intent ? `[의도] ${DRAFT_INTENTS[i.intent]}` : '', `[첨부] ${i.hasFiles ? '있음(링크로 전달)' : '없음'}`,
    t?.due_date ? `[업무 마감] ${korDate(t.due_date)}` : '', honor ? `[받는 사람 호칭] ${honor}` : '', Pn.companyBlock(co), Pn.writerLine(me), profile ? `[보내는 회사] ${profile.name}` : '', `[업무 제목] ${task.title}`,
    contact?.organization ? `[고객 기관] ${contact.organization}` : '', `[업무 내용]\n${desc.slice(0, 3000)}`,
    items.length ? `[진행 단계]\n${items.map((x) => `${x.done ? '✔' : '·'} ${x.text}`).join('\n')}` : '',
    `[기본 문구 참고]\n제목: ${kind.subject}\n${kind.body}`,
    `[보낼 자료 후보]\n${cands.map((f, n) => `${n + 1}. ${f.title || f.file_name} (${f.folder || '최상위'}${f.tags?.length ? ' · ' + f.tags.join(',') : ''})`).join('\n') || '없음'}`].filter(Boolean).join('\n\n');
  const p = P.anthropicProvider({ tier: 'fast' });
  const r = await p.chat({ system: DRAFT_SYSTEM, tools: [], messages: [{ role: 'user', content: prompt }], format: DRAFT_SCHEMA });
  await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
    values (${tenantOf(u)}, ${u.id}, ${randomUUID()}, ${p.name}, ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, ${r.usage.cache_read_input_tokens ?? 0},
      ${r.usage.cache_creation_input_tokens ?? 0}, ${P.costUsd(r.model ?? p.model, r.usage)}, 'mail_draft')`;
  const text = r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  let out: { subject?: string; body?: string; recommend?: number[] } = {};
  try { out = JSON.parse(text); } catch { out = { body: text }; }
  const picks = [...new Set((out.recommend ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= cands.length))].slice(0, 3).map((n) => cands[n - 1]);
  await G.userBudgetAlerts(u).catch(() => {});
  let body = String(out.body ?? kind.body).slice(0, 5000);
  if (!honor) body = body.replace(/담당자님[,.]?\s?/g, '').replace(/^안녕하세요\s*$/m, '안녕하세요.'); // 7-1: "담당자님" 기본값 금지
  return { subject: String(out.subject ?? kind.subject).slice(0, 200), body, warnings: draftWarnings(body, i.channel),
    recommend: picks.map((f) => ({ id: f.id, title: f.title || f.file_name, folder: f.folder, size: Number(f.size_bytes) })) };
}

/** 문자 A 방식(휴대폰 문자앱으로 넘김): 사람이 [보냈어요]를 누른 것만 기록 */
/** V28-2A 카카오톡 공유 — 받는 사람은 카카오톡에서 고르므로 이름(선택)만 남긴다. [보냈어요]를 누른 것만 기록 */
export const kakaoLogInput = z.object({ taskId: z.string().uuid(), to: z.string().trim().max(100).optional(), body: z.string().min(1).max(2000) });
export async function logKakao(u: SessionUser, i: z.infer<typeof kakaoLogInput>, ip: string | null) {
  await loadTaskForMail(u, i.taskId); // 못 보는 업무·다른 조직은 먼저 404
  if (!(await canSend(u))) throw forbidden('카카오톡 보내기 권한이 없습니다 — 대표에게 요청하세요(설정 > 메뉴 권한 > 외부 발송)');
  const sql = db(); const id = randomUUID();
  const to = [i.to || '카카오톡'];
  await sql`insert into outbox (id, tenant, channel, status, task_id, created_by, to_addrs, subject, body_text, message_id, sent_at)
    values (${id}, ${tenantOf(u)}, 'kakao:handoff', 'sent', ${i.taskId}, ${u.id}, ${to}, ${'카카오톡'}, ${i.body}, ${`kakao-${id}`}, now())`;
  await activity(sql, 'task', i.taskId, u.id, 'kakao_sent', { to, subject: i.body.slice(0, 40) });
  await audit(sql, u.id, 'kakao.handoff', 'task', i.taskId, { outboxId: id }, ip);
  return { id };
}
export const smsLogInput = z.object({ taskId: z.string().uuid(), to: z.array(z.string().trim().regex(/^[0-9+\-\s()]{8,20}$/, '전화번호 형식이 아닙니다')).min(1).max(20),
  body: z.string().max(2000), shareUrl: z.string().max(500).optional(), outboxId: z.string().uuid().optional() /* #177 예약 문자를 보낸 뒤 */,
  files: z.array(z.object({ name: z.string().trim().min(1).max(200), size: z.number().int().min(0).max(100 * 1024 * 1024) })).max(20).optional() /* #194 앱 1.1.3 문자에 바로 붙인 파일 */ });
/** #177 문자 예약: 서버는 보내지 못하므로 예약 시각에 '보낼 시간' 알림 → 사람이 휴대폰 문자앱에서 보내고 [보냈어요]. 자료 링크(14일)가 있으면 13일 안으로만 */
export const scheduleSmsInput = z.object({ taskId: z.string().uuid(), to: smsLogInput.shape.to, body: z.string().trim().min(1).max(2000), sendAt: z.string().datetime({ offset: true }), shareUrl: z.string().max(500).optional() });
export async function scheduleSms(u: SessionUser, i: z.infer<typeof scheduleSmsInput>) {
  const { task } = await loadTaskForMail(u, i.taskId);
  if (!(await canSend(u))) throw forbidden('문자 보내기 권한이 없습니다 — 대표에게 요청하세요(설정 > 메뉴 권한 > 외부 발송)');
  const at = checkSendAt(i.sendAt);
  const sql = db(); const id = randomUUID();
  let shareId: string | null = null;
  const tok = i.shareUrl?.match(/\/d\/([A-Za-z0-9_-]+)$/)?.[1];
  if (tok) { const [sl] = await sql<{ id: string }[]>`select id from share_links where token_hash = ${sha256(tok)} and tenant = ${tenantOf(u)}`; shareId = sl?.id ?? null; }
  if (shareId && at.getTime() > Date.now() + 13 * 86400_000) throw badRequest('자료 링크(14일)가 들어간 문자는 13일 안으로만 예약할 수 있습니다');
  await sql`insert into outbox (id, tenant, channel, status, task_id, created_by, to_addrs, subject, body_text, share_id, message_id, scheduled_at, next_attempt_at)
    values (${id}, ${tenantOf(u)}, 'sms:handoff', 'queued', ${i.taskId}, ${u.id}, ${i.to}, ${'문자'}, ${i.body}, ${shareId}, ${`sms-${id}`}, ${at}, ${at})`;
  await activity(sql, 'task', i.taskId, u.id, 'sms_scheduled', { to: i.to, sendAt: at.toISOString(), subject: i.body.slice(0, 40) });
  return { id, status: 'queued', scheduledAt: at.toISOString(), taskTitle: task.title };
}
export async function logSms(u: SessionUser, i: z.infer<typeof smsLogInput>, ip: string | null) {
  await loadTaskForMail(u, i.taskId); // 못 보는 업무·다른 조직은 먼저 404
  if (!(await canSend(u))) throw forbidden('문자 보내기 권한이 없습니다 — 대표에게 요청하세요(설정 > 메뉴 권한 > 외부 발송)');
  const sql = db(); const id = i.outboxId ?? randomUUID();
  let shareId: string | null = null;
  const tok = i.shareUrl?.match(/\/d\/([A-Za-z0-9_-]+)$/)?.[1];
  if (tok) { const [sl] = await sql<{ id: string }[]>`select id from share_links where token_hash = ${sha256(tok)} and tenant = ${tenantOf(u)}`; shareId = sl?.id ?? null; }
  if (i.outboxId) {
    const r = await sql`update outbox set status = 'sent', sent_at = now(), locked_until = null, to_addrs = ${i.to}, body_text = ${i.body} where id = ${i.outboxId} and tenant = ${tenantOf(u)} and created_by = ${u.id} and status in ('due', 'queued') returning id`;
    if (!r.length) throw new HttpError(409, 'not_due', '이미 처리된 예약 문자입니다');
  } else await sql`insert into outbox (id, tenant, channel, status, task_id, created_by, to_addrs, subject, body_text, files, share_id, message_id, sent_at)
    values (${id}, ${tenantOf(u)}, 'sms:handoff', 'sent', ${i.taskId}, ${u.id}, ${i.to}, ${'문자'}, ${i.body}, ${sql.json(i.files ?? [])}, ${shareId}, ${`sms-${id}`}, now())`;
  await activity(sql, 'task', i.taskId, u.id, 'sms_sent', { to: i.to, subject: i.body.slice(0, 40), ...(i.files?.length ? { files: i.files.map((f) => f.name) } : {}) });
  await audit(sql, u.id, 'sms.handoff', 'task', i.taskId, { outboxId: id, to: i.to.length }, ip);
  await rememberSent(sql, tenantOf(u), u.id, i.taskId, i.to.map((phone) => ({ phone })));
  if (shareId) await crmSteps(sql, i.taskId, i.body, [{ name: 'link' }]);
  return { id };
}

// ---------------- V32 6 내 명함·회신 주소(프로필) ----------------
export const myCardInput = z.object({
  title: z.string().trim().max(50).optional(), phone: z.string().trim().max(40).optional(),
  workEmail: z.string().trim().email('업무 이메일 형식이 아닙니다').max(200).optional().or(z.literal('')),
});
export async function myCard(u: SessionUser) {
  const sql = db();
  const [me] = await sql<{ title: string | null; phone: string | null; work_email: string | null; email: string }[]>`select title, phone, work_email, email from users where id = ${u.id}`;
  return { title: me?.title ?? '', phone: me?.phone ?? '', workEmail: me?.work_email ?? '', loginEmail: me?.email ?? '', replyToEditable: await replyToEditable(u, sql) };
}
export async function saveMyCard(u: SessionUser, i: z.infer<typeof myCardInput>, ip: string | null) {
  const sql = db();
  if (i.workEmail !== undefined && !(await replyToEditable(u, sql))) {
    const [me] = await sql<{ work_email: string | null }[]>`select work_email from users where id = ${u.id}`;
    if ((me?.work_email ?? '') !== i.workEmail) throw forbidden('회사 설정으로 회신 주소(업무 이메일)는 관리자만 바꿀 수 있습니다');
  }
  await sql`update users set title = coalesce(${i.title ?? null}, title), phone = coalesce(${i.phone ?? null}, phone),
    work_email = case when ${i.workEmail === undefined} then work_email else ${i.workEmail || null} end, updated_at = now() where id = ${u.id}`;
  await audit(sql, u.id, 'user.card', 'user', u.id, { title: i.title !== undefined, phone: i.phone !== undefined, workEmail: i.workEmail !== undefined }, ip);
  return myCard(u);
}

/** V31 ① 보낸 받는 사람을 회사 연락처에(문의 업무면 문의자 이름·기관으로). 실패해도 보내기는 그대로 */
async function rememberSent(sql: Sql, tenant: string, actorId: string, taskId: string, people: { email?: string; phone?: string }[]) {
  try {
    const c = await inquiryContact(taskId, sql);
    const { rememberContacts, normPhone } = await import('./contacts');
    const list = people.map((p) => {
      const same = c && ((p.email && c.email && p.email.toLowerCase() === c.email.toLowerCase()) || (p.phone && c.phone && normPhone(p.phone) === normPhone(c.phone)));
      return same ? { ...p, name: c!.name, organization: c!.organization } : p;
    });
    await rememberContacts(sql, tenant, actorId, list, { source: 'send', taskId });
  } catch (e) { console.warn('[contacts] remember failed', (e as Error).message); }
}
