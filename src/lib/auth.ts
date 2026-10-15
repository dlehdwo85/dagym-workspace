import { cookies, headers } from 'next/headers';
import { db } from './db';
import { newToken, sha256 } from './crypto';
import type { Role, SessionUser } from './types';

export const SESSION_COOKIE = 'wos_session';
const SESSION_DAYS = 30;

export async function createSession(userId: string, client: string, userAgent: string | null, opts: { ip?: string | null; mfaPending?: boolean } = {}) {
  const token = newToken();
  const sql = db();
  await sql`
    insert into sessions (id, user_id, client, user_agent, expires_at, ip, mfa_pending)
    values (${sha256(token)}, ${userId}, ${client}, ${userAgent?.slice(0, 300) ?? null}, ${opts.mfaPending ? sql`now() + interval '10 minutes'` : sql`now() + ${SESSION_DAYS + ' days'}::interval`}, ${opts.ip ?? null}, ${!!opts.mfaPending})`;
  if (!opts.mfaPending) await sql`update users set last_login_at = now() where id = ${userId}`;
  return { token, maxAge: SESSION_DAYS * 86400 };
}

export function sessionCookie(token: string, maxAge: number) {
  const secure = (process.env.APP_URL ?? '').startsWith('https://');
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge,
  };
}

/** 토큰으로 활성 사용자를 찾는다. 비활성·퇴사자는 null (접근 차단) */
export async function userFromToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const sql = db();
  const id = sha256(token);
  const rows = await sql<
    { id: string; email: string; name: string; role: Role; status: string; timezone: string; last_seen_at: Date; is_demo: boolean; platform_admin: boolean; tenant: string; kind: string; tstatus: string }[]
  >`
    select u.id, u.email, u.name, u.role, u.status, u.timezone, s.last_seen_at, u.is_demo, u.platform_admin, u.tenant, t.kind, t.status as tstatus
    from sessions s join users u on u.id = s.user_id join tenants t on t.id = u.tenant
    where s.id = ${id} and s.revoked_at is null and s.expires_at > now() and u.status = 'active' and not s.mfa_pending and t.status = 'active'`;
  const r = rows[0];
  if (!r) return null;
  // 슬라이딩 만료: 하루 한 번만 갱신
  if (Date.now() - new Date(r.last_seen_at).getTime() > 86400_000) {
    await sql`update sessions set last_seen_at = now(), expires_at = now() + ${SESSION_DAYS + ' days'}::interval where id = ${id}`;
  }
  markActiveDay(sql, r.id, r.tenant);
  return { id: r.id, email: r.email, name: r.name, role: r.role, status: r.status, timezone: r.timezone, sessionId: id, isDemo: r.is_demo, platformAdmin: r.platform_admin, tenant: r.tenant, personal: r.kind === 'personal' };
}

/** 마케팅 퍼널 "실사용"(7일 안 3일 이상 접속)용 접속한 날 — 인스턴스마다 사람·날짜당 한 번만 기록, 실패해도 요청은 그대로 */
const activeSeen = new Map<string, string>();
function markActiveDay(sql: ReturnType<typeof db>, userId: string, tenant: string) {
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  if (activeSeen.get(userId) === day) return;
  activeSeen.set(userId, day);
  if (activeSeen.size > 5000) activeSeen.clear();
  sql`insert into user_active_days (user_id, tenant, day) values (${userId}, ${tenant}, ${day}::date) on conflict do nothing`.catch(() => activeSeen.delete(userId));
}

/** 서버 컴포넌트·라우트 핸들러에서 현재 사용자 */
export async function currentUser(): Promise<SessionUser | null> {
  const h = await headers();
  const auth = h.get('authorization');
  if (auth?.startsWith('Bearer ')) return userFromToken(auth.slice(7));
  const c = await cookies();
  const me = await userFromToken(c.get(SESSION_COOKIE)?.value);
  // V28-3 지원 모드: 플랫폼 운영자 + 지원 쿠키 → 고객사 대표 화면(읽기 전용, api.ts 가 쓰기를 막고 모든 요청을 감사 기록)
  const sup = c.get('wos_support')?.value;
  if (me?.platformAdmin && sup) {
    const { supportFromToken } = await import('./platformAdmin');
    const s = await supportFromToken(sup, me);
    if (s) {
      const [t] = await db()<{ id: string; email: string; name: string; role: Role; status: string; timezone: string; tenant: string; kind: string }[]>`
        select u.id, u.email, u.name, u.role, u.status, u.timezone, u.tenant, t.kind from users u join tenants t on t.id = u.tenant where u.id = ${s.target_user_id} and u.status = 'active'`;
      if (t) return { id: t.id, email: t.email, name: t.name, role: t.role, status: t.status, timezone: t.timezone, sessionId: me.sessionId, tenant: t.tenant, personal: t.kind === 'personal',
        support: { adminId: me.id, adminName: me.name, until: s.expires_at.toISOString(), tenantName: s.name } };
    }
  }
  return me;
}

export async function revokeSession(sessionId: string) {
  await db()`update sessions set revoked_at = now() where id = ${sessionId}`;
}

export async function revokeAllSessions(userId: string) {
  await db()`update sessions set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
}
