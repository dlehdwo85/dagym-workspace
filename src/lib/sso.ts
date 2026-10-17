import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { db } from './db';
import { HttpError, notFound } from './errors';
import { userSpaces } from './spaces';
import { tenantOf, type SessionUser } from './types';

/** V41 단계 4-1(F-6): 워크인 → 마케팅 운영실 1회용 로그인 토큰. 형식 = base64url(JSON).base64url(HMAC-SHA256), 수명 60초, jti 1회 */
const TTL_S = 60;
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const secret = () => process.env.MARKETING_SSO_SECRET || '';
export const ssoConfigured = () => secret().length >= 32;
const sign = (body: string) => createHmac('sha256', secret()).update(body).digest();

export async function issueMarketingToken(u: SessionUser) {
  if (!(await userSpaces(u)).includes('marketing')) throw notFound();
  if (!ssoConfigured()) throw new HttpError(503, 'sso_not_configured', '마케팅 운영실 연결 설정(MARKETING_SSO_SECRET)이 아직 없습니다');
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: 'workin', aud: 'marketing', jti: randomUUID(), sub: u.id, email: u.email, name: u.name, role: u.role, tenant: tenantOf(u), iat: now, exp: now + TTL_S };
  await db()`insert into sso_tokens (jti, user_id, tenant, audience, expires_at) values (${claims.jti}, ${u.id}, ${claims.tenant}, 'marketing', to_timestamp(${claims.exp}))`;
  const body = b64(JSON.stringify(claims));
  return `${body}.${b64(sign(body))}`;
}

/** 운영실 서버가 부르는 확인: 서명·만료·대상·1회(jti) 검사 후 사람 정보를 돌려줌. 같은 토큰 두 번째는 거부 */
export async function verifyMarketingToken(token: string) {
  const bad = (msg: string) => new HttpError(401, 'sso_invalid', msg);
  if (!ssoConfigured()) throw new HttpError(503, 'sso_not_configured', '연결 설정이 없습니다');
  const [body, sig] = String(token ?? '').split('.');
  if (!body || !sig) throw bad('토큰 형식이 아닙니다');
  const want = sign(body), got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw bad('서명이 맞지 않습니다');
  let c: any; try { c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw bad('토큰을 읽을 수 없습니다'); }
  if (c.iss !== 'workin' || c.aud !== 'marketing') throw bad('대상이 다릅니다');
  if (!c.exp || c.exp < Math.floor(Date.now() / 1000)) throw bad('만료된 토큰입니다');
  const sql = db();
  const [t] = await sql<{ user_id: string }[]>`update sso_tokens set used_at = now() where jti = ${c.jti} and used_at is null and expires_at > now() and audience = 'marketing' returning user_id`;
  if (!t || t.user_id !== c.sub) throw bad('이미 쓴 토큰입니다');
  const [u] = await sql<any[]>`select id, email, name, role, status, timezone, tenant, is_demo as "isDemo", platform_admin as "platformAdmin" from users where id = ${c.sub}`;
  if (!u || u.status !== 'active') throw bad('사용할 수 없는 계정입니다');
  const spaces = await userSpaces({ ...u, sessionId: '' });
  if (!spaces.includes('marketing')) throw bad('마케팅 공간 권한이 없습니다');
  await sql`delete from sso_tokens where expires_at < now() - interval '1 day'`;
  return { user: { id: u.id, email: u.email, name: u.name, role: u.role }, tenant: u.tenant, spaces };
}
