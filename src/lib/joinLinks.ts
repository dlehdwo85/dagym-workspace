import { z } from 'zod';
import { db, type Sql } from './db';
import { badRequest, conflict, forbidden, HttpError, notFound } from './errors';
import { audit } from './log';
import { isAdmin, ensurePersonalCalendar } from './access';
import { encrypt, decrypt, hashPassword, newToken, sha256 } from './crypto';
import { tenantOf, type SessionUser } from './types';
import { zUuid } from './api';

/**
 * #1176(대표 11/26 "요금제를 구매한 회사가 직원을 초대할지, 직원이 가입하게 할지"): 셋을 함께 — DB 288
 *  ① 관리자 이메일 초대(그대로 — admin.ts inviteUser)
 *  ② 회사 초대 링크: 관리자가 링크 하나를 만들어 단체방 등에 공유 → 직원이 링크로 가입 신청(이메일·소셜) → '승인 대기' → 관리자가 승인(부서·팀·역할 고름)하면 들어옴
 *     링크는 만료일·사용 횟수 상한·끄기·다시 만들기. 승인으로 인원이 요금 구간을 넘으면 승인 창에 '다음 구간 금액'(결제 연동 A4 규칙 그대로)
 *  ③ 회사 메일 도메인 합류(선택): 자체 도메인을 쓰는 회사만(관리자 본인 메일 도메인 · 공용 메일 도메인은 막음) — 그 도메인으로 가입하면 새 회사 대신 합류 신청. 관리자 승인은 유지
 *  하지 않음: 승인 없는 자유 가입(인원·보안 통제 불가). 앱 심사(iOS 3.1.1): 앱 안에서는 '초대 링크로 합류'만 — 회사 만들기·결제는 보이지 않음(가입 화면은 웹)
 */
export const PUBLIC_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'naver.com', 'daum.net', 'hanmail.net', 'kakao.com', 'nate.com', 'empas.com', 'hanmir.com', 'korea.com', 'dreamwiz.com', 'paran.com', 'chol.com', 'lycos.co.kr',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.co.kr', 'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'aol.com', 'gmx.com', 'zoho.com', 'yandex.com', 'mail.com']);
export const domainOf = (email: string) => email.trim().toLowerCase().split('@')[1] ?? '';

const appUrl = async () => (await import('./mail')).appUrl();
const linkUrl = async (token: string) => `${await appUrl()}/join/${token}`;

function requireJoinAdmin(u: SessionUser) {
  if (!isAdmin(u) || u.isDemo) throw forbidden('회사 대표·관리자만 쓸 수 있습니다');
  if (u.support) throw forbidden('지원(대신 보기) 중에는 바꿀 수 없습니다');
}

// ---------------- 관리자: 링크·신청·도메인 ----------------
export async function joinAdminView(u: SessionUser) {
  requireJoinAdmin(u);
  const sql = db(); const t = tenantOf(u);
  const [link] = await sql<{ id: string; token_enc: string | null; expires_at: Date | null; max_uses: number | null; uses: number; created_at: Date }[]>`
    select id, token_enc, expires_at, max_uses, uses, created_at from join_links where tenant = ${t} and disabled_at is null order by created_at desc limit 1`;
  const requests = await sql<{ id: string; email: string; name: string; via: string; verified: boolean; status: string; created_at: Date; decided_at: Date | null; by: string | null; reject_reason: string | null }[]>`
    select r.id, r.email, r.name, r.via, (r.email_verified_at is not null) as verified, r.status, r.created_at, r.decided_at, d.name as by, r.reject_reason
    from join_requests r left join users d on d.id = r.decided_by
    where r.tenant = ${t} and (r.status = 'pending' or r.decided_at > now() - interval '30 days') order by (r.status = 'pending') desc, r.created_at desc limit 50`;
  const [tn] = await sql<{ join_domain: string | null }[]>`select join_domain from tenants where id = ${t}`;
  const myDomain = domainOf(u.email);
  let url: string | null = null;
  if (link?.token_enc) { try { url = await linkUrl(decrypt(link.token_enc)); } catch { url = null; } }
  const live = !!link && (!link.expires_at || link.expires_at > new Date()) && (link.max_uses == null || link.uses < link.max_uses);
  return {
    link: link ? { id: link.id, url, expiresAt: link.expires_at, maxUses: link.max_uses, uses: link.uses, createdAt: link.created_at, live } : null,
    requests,
    domain: { value: tn?.join_domain ?? null, mine: myDomain, canSet: !!myDomain && !PUBLIC_DOMAINS.has(myDomain), publicBlocked: PUBLIC_DOMAINS.has(myDomain) },
  };
}

export const linkInput = z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]).nullable().default(30), maxUses: z.number().int().min(1).max(1000).nullable().default(null) });
/** 새 링크(다시 만들기 = 예전 링크는 바로 끔) */
export async function createJoinLink(u: SessionUser, i: z.infer<typeof linkInput>, ip: string | null) {
  requireJoinAdmin(u);
  const sql = db(); const t = tenantOf(u);
  const token = newToken(18);
  const id = await sql.begin(async (tx) => {
    await tx`update join_links set disabled_at = now() where tenant = ${t} and disabled_at is null`;
    const [r] = await tx<{ id: string }[]>`insert into join_links (tenant, token_hash, token_enc, created_by, expires_at, max_uses)
      values (${t}, ${sha256(token)}, ${encrypt(token)}, ${u.id}, ${i.days ? tx`now() + make_interval(days => ${i.days})` : null}, ${i.maxUses}) returning id`;
    await audit(tx as unknown as Sql, u.id, 'join.link_create', 'join_link', r.id, { days: i.days, maxUses: i.maxUses }, ip);
    return r.id;
  });
  return { id, url: await linkUrl(token) };
}
export async function disableJoinLink(u: SessionUser, ip: string | null) {
  requireJoinAdmin(u);
  const sql = db();
  const r = await sql<{ id: string }[]>`update join_links set disabled_at = now() where tenant = ${tenantOf(u)} and disabled_at is null returning id`;
  for (const x of r) await audit(sql, u.id, 'join.link_disable', 'join_link', x.id, {}, ip);
  return { ok: true, disabled: r.length };
}

async function openRequest(sql: Sql, u: SessionUser, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const [r] = await sql<{ id: string; tenant: string; email: string; name: string; via: string; password_hash: string | null; provider: string | null; subject: string | null; secret: string | null;
    email_verified_at: Date | null; agree: Record<string, boolean> | null; status: string }[]>`select * from join_requests where id = ${id}`;
  if (!r || r.tenant !== tenantOf(u)) throw notFound();
  if (r.status !== 'pending') throw badRequest('이미 처리한 신청입니다');
  return r;
}
/** 승인 창: 승인하면 인원이 요금 구간을 넘는지(넘으면 다음 구간 금액) — A4 규칙(tenantBand) 그대로 */
export async function approvePreview(u: SessionUser, id: string) {
  requireJoinAdmin(u);
  const sql = db(); const r = await openRequest(sql, u, id);
  const { effectiveLimits } = await import('./plans');
  const { tenantBand, activePeople } = await import('./bands');
  const { limits } = await effectiveLimits(r.tenant, sql);
  const people = await activePeople(r.tenant, sql);
  const now = await tenantBand(r.tenant, limits, sql, people);
  const after = await tenantBand(r.tenant, limits, sql, people + 1);
  const seatLimit = limits.users ?? null;
  return { people, now, after, bandChanges: !!now && !!after && (now.label !== after.label || now.krw !== after.krw), seatFull: seatLimit != null && people >= seatLimit, seatLimit, verified: !!r.email_verified_at };
}

export const approveInput = z.object({
  role: z.enum(['admin', 'dept_lead', 'site_manager', 'staff']).default('staff'),
  orgUnitIds: z.array(zUuid).max(20).default([]), teamIds: z.array(zUuid).max(10).default([]), primaryTeamId: zUuid.nullable().optional(),
});
/** 승인 = 이메일 초대와 같은 길(inviteUser: 요금제 인원·부서·팀·공간 확인)로 계정을 만들고 바로 사용 중으로 — 이메일 신청은 그 비밀번호, 소셜 신청은 그 소셜 계정 연결 */
export async function approveJoin(u: SessionUser, id: string, i: z.infer<typeof approveInput>, ip: string | null) {
  requireJoinAdmin(u);
  const sql = db(); const r = await openRequest(sql, u, id);
  if (!r.email_verified_at) throw badRequest('신청한 분이 아직 메일 확인을 하지 않았습니다 — 메일의 확인 링크를 누른 뒤 승인할 수 있습니다');
  if ((await sql`select 1 from users where lower(email) = ${r.email.toLowerCase()} and status in ('active', 'disabled', 'left')`).length) throw conflict('이미 워크인 계정이 있는 이메일입니다 — 신청을 거절하고 그 계정으로 로그인하게 안내해 주세요');
  const { inviteUser } = await import('./admin');
  const inv = await inviteUser(u, { email: r.email, name: r.name, role: i.role, orgUnitIds: i.orgUnitIds, teamIds: i.teamIds, primaryTeamId: i.primaryTeamId ?? null }, ip, { mail: false });
  await sql.begin(async (tx) => {
    const [ok] = await tx<{ id: string }[]>`update join_requests set status = 'approved', decided_by = ${u.id}, decided_at = now(), user_id = ${inv.userId} where id = ${r.id} and status = 'pending' returning id`;
    if (!ok) throw badRequest('이미 처리한 신청입니다');
    await tx`update users set status = 'active', password_hash = coalesce(${r.password_hash}, password_hash), email_verified_at = coalesce(email_verified_at, now()), updated_at = now() where id = ${inv.userId}`;
    await tx`update invitations set accepted_at = now() where id = ${inv.invitationId}`;
    if (r.provider && r.subject) await tx`insert into user_identities (provider, subject, user_id, email, secret) values (${r.provider}, ${r.subject}, ${inv.userId}, ${r.email}, ${r.secret}) on conflict (provider, subject) do nothing`;
    const [nu] = await tx<{ name: string }[]>`select name from users where id = ${inv.userId}`;
    await ensurePersonalCalendar(inv.userId, nu.name, tx as unknown as Sql);
    const { TERMS_VERSION } = await import('./signup');
    for (const [kind, agreed] of Object.entries(r.agree ?? {})) if (kind !== 'ai') await tx`insert into consents (user_id, kind, version, agreed) values (${inv.userId}, ${kind}, ${TERMS_VERSION}, ${!!agreed})`;
    if (r.agree?.ai) await (await import('./ai/consent')).recordAiAgree(tx as unknown as Sql, inv.userId, 'invite');
    await audit(tx as unknown as Sql, u.id, 'join.approve', 'user', inv.userId, { request: r.id, via: r.via, role: i.role }, ip);
  });
  await mailUser(r.email, r.tenant, true).catch(() => {});
  return { ok: true, userId: inv.userId };
}
export const rejectInput = z.object({ reason: z.string().trim().max(200).optional() });
export async function rejectJoin(u: SessionUser, id: string, i: z.infer<typeof rejectInput>, ip: string | null) {
  requireJoinAdmin(u);
  const sql = db(); const r = await openRequest(sql, u, id);
  await sql`update join_requests set status = 'rejected', decided_by = ${u.id}, decided_at = now(), reject_reason = ${i.reason ?? null}, password_hash = null, secret = null where id = ${r.id}`;
  await audit(sql, u.id, 'join.reject', 'join_request', r.id, { via: r.via }, ip);
  if (r.email_verified_at) await mailUser(r.email, r.tenant, false, i.reason).catch(() => {});
  return { ok: true };
}
async function mailUser(email: string, tenant: string, ok: boolean, reason?: string) {
  const [t] = await db()<{ name: string }[]>`select name from tenants where id = ${tenant}`;
  const { sendFramedMail } = await import('./mail');
  const base = await appUrl();
  if (ok) await sendFramedMail(email, `${t?.name ?? '회사'} 합류가 승인되었습니다`, ['관리자가 합류 신청을 승인했습니다.', '신청할 때 쓴 방법(이메일·비밀번호 또는 소셜 계정)으로 로그인하세요.'], { label: '로그인', url: `${base}/login` });
  else await sendFramedMail(email, `${t?.name ?? '회사'} 합류 신청이 승인되지 않았습니다`, [reason ? `관리자 메모: ${reason}` : '관리자가 합류 신청을 승인하지 않았습니다.', '궁금한 점은 회사 관리자에게 문의하세요.']);
}

export const domainInput = z.object({ domain: z.string().trim().toLowerCase().max(100).nullable() });
/** 회사 메일 도메인 합류: 관리자 본인 메일 도메인만(그 도메인 메일을 실제로 쓰는 사람만 등록) · 공용 메일 도메인 막음 · 한 도메인은 한 회사만 */
export async function setJoinDomain(u: SessionUser, i: z.infer<typeof domainInput>, ip: string | null) {
  requireJoinAdmin(u);
  const sql = db(); const t = tenantOf(u);
  if (i.domain) {
    const mine = domainOf(u.email);
    if (PUBLIC_DOMAINS.has(i.domain)) throw badRequest('네이버·지메일 같은 공용 메일 도메인은 등록할 수 없습니다(누구나 쓰는 도메인이라 회사 직원을 가릴 수 없음)');
    if (i.domain !== mine) throw badRequest(`내 로그인 메일(${mine || '없음'})과 같은 도메인만 등록할 수 있습니다 — 그 도메인 메일을 실제로 쓰는지 확인하는 방법입니다`);
    const [other] = await sql<{ id: string }[]>`select id from tenants where lower(join_domain) = ${i.domain} and id <> ${t}`;
    if (other) throw conflict('이미 다른 회사가 등록한 도메인입니다 — 워크인 고객센터로 문의해 주세요');
  }
  await sql`update tenants set join_domain = ${i.domain} where id = ${t}`;
  await audit(sql, u.id, 'join.domain', 'tenant', t, { domain: i.domain }, ip);
  return { ok: true, domain: i.domain };
}

// ---------------- 공개: 링크로 가입 신청 · 메일 확인 · 도메인 합류 ----------------
async function linkByToken(sql: Sql, token: string) {
  if (!token || token.length > 100) return null;
  const [l] = await sql<{ id: string; tenant: string; expires_at: Date | null; max_uses: number | null; uses: number; disabled_at: Date | null; name: string; tstatus: string }[]>`
    select l.id, l.tenant, l.expires_at, l.max_uses, l.uses, l.disabled_at, t.name, t.status as tstatus from join_links l join tenants t on t.id = l.tenant where l.token_hash = ${sha256(token)}`;
  return l ?? null;
}
const linkProblem = (l: NonNullable<Awaited<ReturnType<typeof linkByToken>>> | null) => (!l ? '초대 링크가 올바르지 않습니다' : l.disabled_at ? '관리자가 끈 초대 링크입니다 — 새 링크를 받아 주세요'
  : l.tstatus !== 'active' ? '지금은 합류할 수 없는 회사입니다' : l.expires_at && l.expires_at < new Date() ? '기간이 지난 초대 링크입니다 — 새 링크를 받아 주세요'
  : l.max_uses != null && l.uses >= l.max_uses ? '이 초대 링크로 받을 수 있는 신청 수가 다 찼습니다 — 관리자에게 새 링크를 받아 주세요' : null);
export async function joinInfo(token: string) {
  const l = await linkByToken(db(), token);
  const problem = linkProblem(l);
  return { ok: !problem, company: !l || problem === '초대 링크가 올바르지 않습니다' ? null : l.name, problem };
}

const agreeSchema = z.object({ terms: z.literal(true, { errorMap: () => ({ message: '이용약관에 동의해 주세요' }) }), age14: z.literal(true, { errorMap: () => ({ message: '만 14세 이상만 가입할 수 있습니다' }) }),
  privacy: z.literal(true, { errorMap: () => ({ message: '개인정보 처리방침에 동의해 주세요' }) }), ai: z.literal(true, { errorMap: () => ({ message: 'AI 기능 이용에 동의해 주세요(필수 — 워크인의 핵심 기능입니다)' }) }) });
export const joinInput = z.object({
  email: z.string().trim().toLowerCase().email('이메일 형식이 아닙니다').max(200), name: z.string().trim().min(1, '이름을 입력하세요').max(50),
  password: z.string().min(8, '비밀번호는 8자 이상').max(200), agree: agreeSchema, website: z.string().max(200).optional(),
});
async function rateLimit(sql: Sql, ip: string | null, email: string) {
  const [{ h }] = await sql<{ h: number }[]>`select count(*)::int h from signup_attempts where ip is not distinct from ${ip} and reason = 'join' and created_at > now() - interval '1 hour'`;
  if (h >= Number(process.env.JOIN_IP_PER_HOUR ?? 30)) // 한 사무실에서 여럿이 신청할 수 있어 새 회사 가입(시간당)보다 넉넉히 — 회사 가입 제한과 따로 셈 throw new HttpError(429, 'too_many', '신청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
  await sql`insert into signup_attempts (ip, email, ok, reason) values (${ip}, ${email}, true, 'join')`;
}
/** 이메일 신청: 신청(승인 대기, 메일 확인 전) + 확인 메일. 이미 계정이 있거나 같은 회사에 대기 중이면 같은 안내(가입 여부를 드러내지 않음) */
async function createEmailRequest(sql: Sql, tenant: string, company: string, linkId: string | null, via: 'link' | 'domain', i: z.infer<typeof joinInput>, ip: string | null) {
  const msg = { ok: true, message: `${i.email} 로 확인 메일을 보냈습니다 — 메일의 [신청 확인]을 누르면 ${company} 관리자에게 합류 신청이 갑니다` };
  if (i.website) return msg; // 봇
  await rateLimit(sql, ip, i.email);
  if ((await sql`select 1 from users where lower(email) = ${i.email}`).length) return msg;
  const verify = newToken();
  const pw = await hashPassword(i.password);
  const made = await db().begin(async (tx: Sql) => {
    if (linkId) {
      const [l] = await tx<{ ok: boolean }[]>`update join_links set uses = uses + 1 where id = ${linkId} and disabled_at is null and (max_uses is null or uses < max_uses) and (expires_at is null or expires_at > now()) returning true as ok`;
      if (!l) throw badRequest('이 초대 링크로는 더 신청할 수 없습니다 — 관리자에게 새 링크를 받아 주세요');
    }
    const r = await tx<{ id: string }[]>`insert into join_requests (tenant, link_id, via, email, name, password_hash, verify_hash, agree, ip)
      values (${tenant}, ${linkId}, ${via}, ${i.email}, ${i.name}, ${pw}, ${sha256(verify)}, ${tx.json(i.agree as never)}, ${ip})
      on conflict (tenant, lower(email)) where status = 'pending' do update set name = excluded.name, password_hash = excluded.password_hash, verify_hash = excluded.verify_hash, agree = excluded.agree
      returning id`;
    return r[0];
  });
  const { sendFramedMail } = await import('./mail');
  const sent = await sendFramedMail(i.email, `${company} 합류 신청 — 메일 확인`, [`${i.name}님, ${company}에 워크인 합류를 신청하셨습니다.`, '아래 [신청 확인]을 누르면 회사 관리자에게 신청이 가고, 관리자가 승인하면 로그인할 수 있습니다.', '직접 신청하지 않았다면 이 메일을 무시하세요.'],
    { label: '신청 확인', url: `${await appUrl()}/api/join/verify?t=${verify}` }).catch(() => 'failed' as const);
  return { ...msg, requestId: made.id, ...(sent === 'dev' ? { devVerify: `/api/join/verify?t=${verify}` } : {}) /* 메일 발송이 없는 개발·시험 환경만(가입 확인 메일과 같은 규칙) */ };
}
export async function requestJoin(token: string, i: z.infer<typeof joinInput>, ip: string | null) {
  const sql = db(); const l = await linkByToken(sql, token);
  const problem = linkProblem(l);
  if (problem || !l) throw badRequest(problem ?? '초대 링크가 올바르지 않습니다');
  return createEmailRequest(sql, l.tenant, l.name, l.id, 'link', i, ip);
}
/** 메일 확인 → 관리자에게 알림(대표·관리자) */
export async function verifyJoin(t: string) {
  const sql = db();
  if (!t || t.length > 100) throw badRequest('확인 링크가 올바르지 않습니다');
  const [r] = await sql<{ id: string; tenant: string; name: string; status: string; email_verified_at: Date | null }[]>`select id, tenant, name, status, email_verified_at from join_requests where verify_hash = ${sha256(t)}`;
  if (!r || r.status !== 'pending') throw badRequest('이미 처리했거나 올바르지 않은 확인 링크입니다');
  if (!r.email_verified_at) { await sql`update join_requests set email_verified_at = now() where id = ${r.id}`; await tellAdmins(sql, r.tenant, r.name, r.id); }
  const [t0] = await sql<{ name: string }[]>`select name from tenants where id = ${r.tenant}`;
  return { company: t0?.name ?? '' };
}
async function tellAdmins(sql: Sql, tenant: string, name: string, requestId: string) {
  const admins = (await sql<{ id: string }[]>`select id from users where tenant = ${tenant} and status = 'active' and role in ('owner', 'admin') and not coalesce(is_demo, false)`).map((x) => x.id);
  if (!admins.length) return;
  const { notify } = await import('./notifications');
  await notify(sql, { userIds: admins, type: 'join_request', title: `합류 신청: ${name}`, body: '초대 링크·회사 메일로 들어온 신청입니다 — 승인하면 계정이 만들어집니다', link: '/admin/users#join', dedupeKey: `join:${requestId}` }).catch(() => {});
}
/** 소셜로 신청(제공자가 확인한 메일) — oauth 콜백에서 */
export async function socialJoinRequest(token: string, s: { provider: string; subject: string; email: string; name: string | null; secret: string | null }, ip: string | null) {
  const sql = db(); const l = await linkByToken(sql, token);
  const problem = linkProblem(l);
  if (problem || !l) throw badRequest(problem ?? '초대 링크가 올바르지 않습니다');
  if ((await sql`select 1 from users where lower(email) = ${s.email}`).length) throw badRequest(`이미 ${s.email} 로 가입된 워크인 계정이 있습니다 — 그 계정으로 로그인해 주세요`);
  await rateLimit(sql, ip, s.email);
  const id = await sql.begin(async (tx) => {
    const [u0] = await tx<{ ok: boolean }[]>`update join_links set uses = uses + 1 where id = ${l.id} and disabled_at is null and (max_uses is null or uses < max_uses) and (expires_at is null or expires_at > now()) returning true as ok`;
    if (!u0) throw badRequest('이 초대 링크로는 더 신청할 수 없습니다 — 관리자에게 새 링크를 받아 주세요');
    const [r] = await tx<{ id: string }[]>`insert into join_requests (tenant, link_id, via, email, name, provider, subject, secret, email_verified_at, agree, ip)
      values (${l.tenant}, ${l.id}, ${s.provider}, ${s.email}, ${(s.name ?? s.email.split('@')[0]).slice(0, 50)}, ${s.provider}, ${s.subject}, ${s.secret}, now(), ${tx.json({ terms: true, age14: true, privacy: true, ai: true } as never)}, ${ip})
      on conflict (tenant, lower(email)) where status = 'pending' do update set provider = excluded.provider, subject = excluded.subject, secret = excluded.secret, email_verified_at = now()
      returning id`;
    return r.id;
  });
  await tellAdmins(sql, l.tenant, s.name ?? s.email, id);
  return { company: l.name };
}

/** 가입 화면: 이 메일 도메인을 합류 도메인으로 등록한 회사(있으면 새 회사 대신 합류 신청을 권함) */
export async function domainCompany(email: string) {
  const d = domainOf(email);
  if (!d || PUBLIC_DOMAINS.has(d)) return null;
  const [t] = await db()<{ id: string; name: string }[]>`select id, name from tenants where lower(join_domain) = ${d} and status = 'active'`;
  return t ?? null;
}
export async function requestDomainJoin(i: z.infer<typeof joinInput>, ip: string | null) {
  const t = await domainCompany(i.email);
  if (!t) throw badRequest('이 메일 도메인으로 합류할 수 있는 회사가 없습니다');
  return createEmailRequest(db(), t.id, t.name, null, 'domain', i, ip);
}
