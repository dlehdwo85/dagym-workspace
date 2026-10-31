import { z } from 'zod';
import { db } from './db';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { hmac, newToken, sha256 } from './crypto';
import { audit } from './log';
import { appUrl } from './mail';
import { createOwnerSpace, signupEnabled, signupInput, TERMS_VERSION } from './signup';
import { ensurePersonalCalendar } from './access';
import type { SessionUser } from './types';
import { appleEnv } from './oauthApple';

/**
 * V29 1장 소셜 가입·로그인 — Google·카카오·네이버(OAuth 2.0 인가 코드) · 299차 Apple(form_post·id_token, src/lib/oauthApple.ts).
 * - 키가 있는 제공자만 버튼이 보인다(GOOGLE_LOGIN_CLIENT_ID/SECRET, KAKAO_REST_KEY(+KAKAO_CLIENT_SECRET), NAVER_CLIENT_ID/SECRET).
 * - 콜백: {APP_URL}/api/auth/oauth/{provider}/callback — 각 제공자 콘솔에 이 주소를 등록한다.
 * - 이미 연결된 소셜 계정 → 바로 로그인. 초대 링크로 들어오면 그 초대 계정에 연결하고 합류.
 *   같은 이메일의 기존 계정이 있으면 자동으로 묶지 않는다(비밀번호로 로그인 후 설정에서 연결).
 * - 처음이면 회사 만들기 화면(/signup/social)으로 — 확인된 이메일이라 확인 메일 없이 바로 시작, 그 이메일이 업무 이메일·회신 주소 기본값.
 * - OAUTH_TEST_BASE 가 있으면 모든 주소를 그 서버로(가짜 제공자 시험용).
 */
export const PROVIDERS = ['google', 'kakao', 'naver', 'apple'] as const; // 299차 #858 Apple(src/lib/oauthApple.ts)
export type Provider = (typeof PROVIDERS)[number];
export const PROVIDER_LABEL: Record<Provider, string> = { google: 'Google', kakao: '카카오', naver: '네이버', apple: 'Apple' };

type Conf = { id: string; secret?: string; auth: string; token: string; me: string; scope: string };
function conf(p: Provider): Conf | null {
  const t = process.env.OAUTH_TEST_BASE?.replace(/\/$/, '');
  const ep = (real: [string, string, string]) => (t ? [`${t}/oauth/${p}/authorize`, `${t}/oauth/${p}/token`, `${t}/oauth/${p}/me`] : real);
  if (p === 'google') {
    const id = process.env.GOOGLE_LOGIN_CLIENT_ID ?? '', secret = process.env.GOOGLE_LOGIN_CLIENT_SECRET ?? '';
    if (!id || !secret) return null;
    const [auth, token, me] = ep(['https://accounts.google.com/o/oauth2/v2/auth', 'https://oauth2.googleapis.com/token', 'https://openidconnect.googleapis.com/v1/userinfo']);
    return { id, secret, auth, token, me, scope: 'openid email profile' };
  }
  if (p === 'apple') { // 299차: 넷(팀·Services ID·키 ID·키)이 다 있어야 켜짐 — 토큰 교환·확인은 oauthApple
    const a = appleEnv();
    return a ? { id: a.servicesId, auth: a.auth, token: a.token, me: a.keys, scope: 'name email' } : null;
  }
  if (p === 'kakao') {
    const id = process.env.KAKAO_REST_KEY ?? '';
    if (!id) return null;
    const [auth, token, me] = ep(['https://kauth.kakao.com/oauth/authorize', 'https://kauth.kakao.com/oauth/token', 'https://kapi.kakao.com/v2/user/me']);
    return { id, secret: process.env.KAKAO_CLIENT_SECRET || undefined, auth, token, me, scope: 'account_email profile_nickname' };
  }
  const id = process.env.NAVER_CLIENT_ID ?? '', secret = process.env.NAVER_CLIENT_SECRET ?? '';
  if (!id || !secret) return null;
  const [auth, token, me] = ep(['https://nid.naver.com/oauth2.0/authorize', 'https://nid.naver.com/oauth2.0/token', 'https://openapi.naver.com/v1/nid/me']);
  return { id, secret, auth, token, me, scope: '' };
}
export const enabledProviders = () => PROVIDERS.filter((p) => conf(p));
export const isProvider = (p: string): p is Provider => (PROVIDERS as readonly string[]).includes(p);
const redirectUri = (p: Provider) => `${appUrl()}/api/auth/oauth/${p}/callback`;

// ---------------- 시작: 상태 쿠키(서명) + 제공자 화면으로 ----------------
export const STATE_COOKIE = 'wos_oauth';
type State = { n: string; p: Provider; mode: 'login' | 'link'; invite?: string; client: string; utm?: Record<string, string>; at: number; ac?: string };
const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
export const startInput = z.object({
  mode: z.enum(['login', 'link']).default('login'), invite: z.string().max(200).optional(), client: z.enum(['web', 'android', 'ios']).default('web'),
  utm_source: z.string().max(80).optional(), utm_medium: z.string().max(80).optional(), utm_campaign: z.string().max(120).optional(),
  /** 앱: 시스템 브라우저에서 로그인 → 앱으로 복귀. 앱이 만든 검증값의 sha256(hex) */
  ac: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});
export function startOAuth(p: Provider, i: z.infer<typeof startInput>) {
  const c = conf(p);
  if (!c) throw notFound('이 로그인 방법은 아직 준비 중입니다');
  const utm = Object.fromEntries(Object.entries({ source: i.utm_source, medium: i.utm_medium, campaign: i.utm_campaign }).filter(([, v]) => v)) as Record<string, string>;
  const st: State = { n: newToken(16), p, mode: i.mode, invite: i.invite, client: i.client, utm: Object.keys(utm).length ? utm : undefined, at: Date.now(), ac: i.ac };
  const body = enc(st);
  const cookie = `${body}.${hmac('oauth:' + body)}`;
  const q = new URLSearchParams({ response_type: 'code', client_id: c.id, redirect_uri: redirectUri(p), state: st.n });
  if (c.scope) q.set('scope', c.scope);
  if (p === 'google') q.set('prompt', 'select_account');
  if (p === 'apple') q.set('response_mode', 'form_post'); // 이름·이메일을 받으려면 form_post(콜백 POST → 같은 주소 GET 으로 넘김)
  return { url: `${c.auth}?${q}`, cookie };
}
function readState(cookie: string | undefined, state: string | null, p: Provider): State {
  const [body, sig] = (cookie ?? '').split('.');
  if (!body || !sig || hmac('oauth:' + body) !== sig) throw badRequest('로그인 요청이 만료되었습니다. 다시 시도해 주세요.');
  const st = JSON.parse(Buffer.from(body, 'base64url').toString()) as State;
  if (st.p !== p || !state || st.n !== state || Date.now() - st.at > 10 * 60_000) throw badRequest('로그인 요청이 만료되었습니다. 다시 시도해 주세요.');
  return st;
}

/** 콜백 라우트용: 앱(시스템 브라우저)에서 시작한 로그인인지 — 서명만 확인(나머지 검사는 oauthCallback) */
export function stateAppChallenge(cookie: string | undefined): string | null {
  const [body, sig] = (cookie ?? '').split('.');
  if (!body || !sig || hmac('oauth:' + body) !== sig) return null;
  try { return (JSON.parse(Buffer.from(body, 'base64url').toString()) as State).ac ?? null; } catch { return null; }
}
/** 앱 복귀 1회용 표(2분) */
export async function createHandoff(userId: string, mfa: boolean, client: string, challenge: string) {
  const token = newToken(); const sql = db();
  await sql`delete from oauth_handoff where expires_at < now()`;
  await sql`insert into oauth_handoff (token_hash, user_id, mfa, client, challenge, expires_at) values (${sha256(token)}, ${userId}, ${mfa}, ${client}, ${challenge}, now() + interval '2 minutes')`;
  return token;
}
export const exchangeInput = z.object({ t: z.string().min(10).max(200), v: z.string().min(32).max(200) });
/** 앱 WebView 에서: 표 + 앱이 보관한 검증값 → 세션(한 번만) */
export async function exchangeHandoff(i: z.infer<typeof exchangeInput>) {
  const [r] = await db()<{ user_id: string; mfa: boolean; client: string; challenge: string }[]>`delete from oauth_handoff where token_hash = ${sha256(i.t)} and expires_at > now() returning user_id, mfa, client, challenge`;
  if (!r || r.challenge !== sha256(i.v)) throw badRequest('로그인 시간이 지났습니다. 다시 시도해 주세요.');
  return { userId: r.user_id, mfa: r.mfa, client: r.client };
}

// ---------------- 콜백: 코드 → 토큰 → 프로필 ----------------
type Profile = { subject: string; email: string | null; emailVerified: boolean; name: string | null; secret?: string | null };
async function fetchProfile(p: Provider, code: string, state: string): Promise<Profile> {
  if (p === 'apple') {
    const a = await (await import('./oauthApple')).appleProfile(code, redirectUri(p)).catch(() => null);
    if (!a) throw badRequest('Apple 로그인에 실패했습니다. 다시 시도해 주세요.');
    return a;
  }
  const c = conf(p)!;
  const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: c.id, redirect_uri: redirectUri(p), code });
  if (c.secret) form.set('client_secret', c.secret);
  if (p === 'naver') form.set('state', state);
  const tr = await fetch(c.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' }, body: form, signal: AbortSignal.timeout(10_000) });
  const tj = await tr.json().catch(() => ({})) as { access_token?: string };
  if (!tr.ok || !tj.access_token) throw badRequest(`${PROVIDER_LABEL[p]} 로그인에 실패했습니다. 다시 시도해 주세요.`);
  const mr = await fetch(c.me, { headers: { authorization: `Bearer ${tj.access_token}` }, signal: AbortSignal.timeout(10_000) });
  const m = await mr.json().catch(() => ({})) as any;
  if (!mr.ok) throw badRequest(`${PROVIDER_LABEL[p]} 계정 정보를 받지 못했습니다`);
  if (p === 'google') return { subject: String(m.sub ?? ''), email: m.email ?? null, emailVerified: m.email_verified === true || m.email_verified === 'true', name: m.name ?? null };
  if (p === 'kakao') {
    const a = m.kakao_account ?? {};
    return { subject: String(m.id ?? ''), email: a.email ?? null, emailVerified: !!(a.is_email_valid && a.is_email_verified), name: a.profile?.nickname ?? m.properties?.nickname ?? null };
  }
  const r = m.response ?? {};
  return { subject: String(r.id ?? ''), email: r.email ?? null, emailVerified: !!r.email, name: r.name ?? r.nickname ?? null }; // 네이버 이메일 = 본인 확인된 연락처 이메일
}

export type CallbackResult =
  | { kind: 'login'; userId: string; mfa: boolean; client: string }
  | { kind: 'linked' }
  | { kind: 'pending'; token: string }
  | { kind: 'error'; message: string; code?: string };

/** 콜백 처리 — 결과에 따라 라우트가 로그인 세션을 만들거나 화면으로 보낸다 */
export async function oauthCallback(p: Provider, q: { code: string | null; state: string | null; error: string | null; name?: string | null }, cookie: string | undefined, me: SessionUser | null, ip: string | null): Promise<CallbackResult> {
  if (q.error) return { kind: 'error', message: '로그인을 취소했습니다' };
  const st = readState(cookie, q.state, p);
  if (!q.code) throw badRequest('로그인 코드가 없습니다');
  const prof = await fetchProfile(p, q.code, q.state!);
  if (!prof.subject) throw badRequest('계정 정보를 받지 못했습니다');
  if (!prof.name && q.name) prof.name = q.name; // Apple: 이름은 처음 한 번 form 으로만 옴
  const secret = prof.secret ?? null; // Apple 해지용 토큰(암호화)
  const email = prof.email?.trim().toLowerCase() || null;
  const sql = db();
  const [idn] = await sql<{ user_id: string }[]>`select user_id from user_identities where provider = ${p} and subject = ${prof.subject}`;

  // 설정 > 계정에서 연결
  if (st.mode === 'link') {
    if (!me || me.support) throw forbidden('로그인한 뒤 연결해 주세요');
    if (idn && idn.user_id !== me.id) return { kind: 'error', code: 'taken', message: `이 ${PROVIDER_LABEL[p]} 계정은 이미 다른 워크인 계정에 연결되어 있습니다` };
    await sql`insert into user_identities (provider, subject, user_id, email, secret) values (${p}, ${prof.subject}, ${me.id}, ${email}, ${secret}) on conflict (provider, subject) do update set secret = coalesce(excluded.secret, user_identities.secret)`;
    await audit(sql, me.id, 'auth.identity_linked', 'user', me.id, { provider: p }, ip);
    return { kind: 'linked' };
  }

  // 이미 연결된 계정 → 로그인
  if (idn) {
    const [u] = await sql<{ id: string; status: string; tstatus: string; totp: boolean; pending: boolean }[]>`select u.id, u.status, t.status tstatus, u.totp_enabled_at is not null totp, u.signup_pending pending
      from users u join tenants t on t.id = u.tenant where u.id = ${idn.user_id}`;
    if (!u || u.status !== 'active') return { kind: 'error', message: '사용이 중지된 계정입니다. 관리자에게 문의하세요.' };
    if (u.tstatus !== 'active') return { kind: 'error', message: '사용이 중지된 회사(공간)입니다. 문의: 워크인 운영팀' };
    if (u.pending) await sql`update users set signup_pending = false, email_verified_at = coalesce(email_verified_at, now()) where id = ${u.id}`;
    await sql`update user_identities set last_login_at = now(), secret = coalesce(${secret}, secret) where provider = ${p} and subject = ${prof.subject}`;
    await audit(sql, u.id, 'auth.login', 'user', u.id, { client: st.client, provider: p }, ip);
    return { kind: 'login', userId: u.id, mfa: u.totp, client: st.client };
  }

  // 초대 링크 → 그 초대 계정에 연결하고 합류(소셜 한 번으로)
  if (st.invite) {
    const userId = await sql.begin(async (tx) => {
      const [inv] = await tx`select * from invitations where token_hash = ${sha256(st.invite!)} for update`;
      if (!inv || inv.revoked_at || inv.accepted_at || new Date(inv.expires_at) < new Date()) throw badRequest('사용할 수 없는 초대 링크입니다. 관리자에게 다시 요청하세요.');
      const [u] = await tx<{ id: string; status: string; name: string }[]>`select id, status, name from users where id = ${inv.user_id}`;
      if (!u || (u.status !== 'invited' && u.status !== 'active')) throw forbidden('비활성화된 계정입니다. 관리자에게 문의하세요.');
      await tx`update users set status = 'active', email_verified_at = coalesce(email_verified_at, now()), work_email = coalesce(work_email, ${email}), updated_at = now() where id = ${u.id}`;
      await tx`update invitations set accepted_at = now() where id = ${inv.id}`;
      await tx`insert into user_identities (provider, subject, user_id, email, last_login_at, secret) values (${p}, ${prof.subject}, ${u.id}, ${email}, now(), ${secret})`;
      await ensurePersonalCalendar(u.id, u.name, tx);
      await audit(tx, u.id, 'user.accept_invite', 'user', u.id, { provider: p }, ip);
      return u.id;
    });
    return { kind: 'login', userId, mfa: false, client: st.client };
  }

  // 299차 #858·#839: 아이폰 앱은 가입이 없음(회사 관리자 초대로만) — 처음 보는 소셜 계정이면 회사 만들기 대신 안내
  if (st.client === 'ios') return { kind: 'error', code: 'no_account', message: `이 ${PROVIDER_LABEL[p]} 계정과 연결된 워크인 계정이 없습니다. 계정은 회사 관리자의 초대로 만들어집니다 — 초대 메일의 링크로 들어오거나, 이메일로 로그인한 뒤 설정 › 계정에서 ${PROVIDER_LABEL[p]}를 연결해 주세요.` };
  // 처음 — 이메일이 꼭 필요(확인된 이메일)
  if (!email) return { kind: 'error', code: 'no_email', message: `${PROVIDER_LABEL[p]}에서 이메일 제공에 동의해야 가입할 수 있습니다. 다시 시도할 때 이메일 항목을 체크해 주세요.` };
  if (!prof.emailVerified) return { kind: 'error', code: 'unverified', message: `${PROVIDER_LABEL[p]} 계정의 이메일이 인증되지 않았습니다. 이메일로 가입해 주세요.` };
  const [ex] = await sql<{ id: string }[]>`select id from users where lower(email) = ${email}`;
  if (ex) return { kind: 'error', code: 'exists', message: `이미 ${email} 로 가입된 계정이 있습니다. 그 계정으로 로그인한 뒤 설정 > 계정에서 ${PROVIDER_LABEL[p]}를 연결해 주세요.` };
  if (!signupEnabled()) return { kind: 'error', message: '아직 가입을 받지 않습니다. 초대 링크로 들어와 주세요.' };
  const token = newToken();
  await sql`delete from oauth_pending where expires_at < now()`;
  await sql`insert into oauth_pending (token_hash, provider, subject, email, name, utm, expires_at, secret)
    values (${sha256(token)}, ${p}, ${prof.subject}, ${email}, ${prof.name?.slice(0, 50) ?? null}, ${st.utm ? sql.json(st.utm as never) : null}, now() + interval '30 minutes', ${secret})`;
  return { kind: 'pending', token };
}

// ---------------- 처음 가입: 회사 만들기 ----------------
type Pending = { provider: Provider; subject: string; email: string; name: string | null; utm: Record<string, string> | null; secret: string | null };
async function loadPending(token: string): Promise<Pending> {
  const [r] = await db()<Pending[]>`select provider, subject, email, name, utm, secret from oauth_pending where token_hash = ${sha256(token)} and expires_at > now()`;
  if (!r) throw badRequest('가입 시간이 지났습니다. 처음부터 다시 시도해 주세요.');
  return r;
}
export async function pendingInfo(token: string) {
  const r = await loadPending(token);
  return { provider: r.provider, providerLabel: PROVIDER_LABEL[r.provider], email: r.email, name: r.name };
}
export const completeInput = signupInput.pick({ name: true, mode: true, company: true, agree: true, size: true, industry: true, industries: true, utm: true }).extend({ token: z.string().min(10).max(200) });
export async function completeSocialSignup(i: z.infer<typeof completeInput>, ip: string | null) {
  if (!signupEnabled()) throw notFound();
  if (i.mode === 'team' && !i.company) throw badRequest('회사(팀) 이름을 입력하세요');
  const sql = db();
  const [{ d }] = await sql<{ d: number }[]>`select count(*)::int d from signup_attempts where ip is not distinct from ${ip} and ok and created_at > now() - interval '1 day'`;
  if (d >= Number(process.env.SIGNUP_IP_PER_DAY ?? 3)) throw new HttpError(429, 'too_many', '가입 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.');
  const pend = await loadPending(i.token);
  const userId = await sql.begin(async (tx) => {
    const del = await tx`delete from oauth_pending where token_hash = ${sha256(i.token)} returning 1`;
    if (!del.length) throw badRequest('이미 처리된 가입입니다. 로그인해 주세요.');
    if ((await tx`select 1 from users where lower(email) = ${pend.email}`).length) throw badRequest('이미 가입된 이메일입니다. 로그인해 주세요.');
    const id = await createOwnerSpace(tx, { email: pend.email, name: i.name, mode: i.mode, company: i.company, size: i.size, industry: i.industry, industries: i.industries,
      utm: i.utm ?? pend.utm ?? undefined, agree: i.agree, passwordHash: null, pending: false, ip, workEmail: pend.email });
    await tx`insert into user_identities (provider, subject, user_id, email, last_login_at, secret) values (${pend.provider}, ${pend.subject}, ${id}, ${pend.email}, now(), ${pend.secret})`;
    return id;
  });
  await sql`insert into signup_attempts (ip, email, ok, reason) values (${ip}, ${pend.email}, true, ${'social:' + pend.provider})`;
  const [{ tenant }] = await sql<{ tenant: string }[]>`select tenant from users where id = ${userId}`;
  const { recordStep } = await import('./funnel');
  await recordStep('submitted', { tenant }, sql); await recordStep('verified', { tenant }, sql); // 소셜은 확인 메일 없이 바로 회사 생성
  return { userId };
}

// ---------------- 설정 > 계정: 연결된 소셜 계정 ----------------
export async function myIdentities(u: SessionUser) {
  const sql = db();
  const rows = await sql<{ provider: Provider; email: string | null; created_at: Date; last_login_at: Date | null }[]>`select provider, email, created_at, last_login_at from user_identities where user_id = ${u.id} order by created_at`;
  const [me] = await sql<{ has_pw: boolean }[]>`select password_hash is not null has_pw from users where id = ${u.id}`;
  return { identities: rows, enabled: enabledProviders(), hasPassword: !!me?.has_pw, termsVersion: TERMS_VERSION };
}
export async function unlinkIdentity(u: SessionUser, p: Provider, ip: string | null) {
  const sql = db();
  const left = await myIdentities(u);
  if (!left.hasPassword && left.identities.filter((x) => x.provider !== p).length === 0) throw badRequest('로그인 방법이 하나도 남지 않습니다 — 먼저 비밀번호를 만들거나 다른 계정을 연결하세요');
  const r = await sql<{ secret: string | null }[]>`delete from user_identities where user_id = ${u.id} and provider = ${p} returning secret`;
  if (p === 'apple') for (const x of r) await (await import('./oauthApple')).revokeApple(x.secret).catch(() => false); // 299차: Apple 연결 끊기 = 토큰 해지
  if (!r.length) throw notFound('연결되어 있지 않습니다');
  await audit(sql, u.id, 'auth.identity_unlinked', 'user', u.id, { provider: p }, ip);
  return { ok: true };
}
