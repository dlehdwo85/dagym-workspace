import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/crypto';
import { createSession, sessionCookie } from '@/lib/auth';
import { HttpError } from '@/lib/errors';
import { audit } from '@/lib/log';

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
  client: z.enum(['web', 'android', 'ios']).default('web'),
  /** 로컬 10/19: 웹 '로그인 유지'(기본 켬). 앱은 늘 유지 */
  remember: z.boolean().default(true),
});

export const POST = handler(async ({ req }) => {
  const i = await body(req, schema);
  const sql = db();
  const ip = clientIp(req);
  // 간단한 무차별 대입 방지: 같은 이메일 15분 내 실패 10회 이상이면 차단
  const fails = await sql<{ c: number }[]>`select count(*)::int c from audit_logs
    where action = 'auth.login_failed' and detail->>'email' = ${i.email} and created_at > now() - interval '15 minutes'`;
  if (fails[0].c >= 10) throw new HttpError(429, 'too_many', '로그인 시도가 너무 많습니다. 15분 후 다시 시도하세요.');
  const [u] = await sql<{ id: string; status: string; password_hash: string | null; name: string; role: string; totp_enabled_at: Date | null; signup_pending: boolean; tstatus: string }[]>`
    select u.id, u.status, u.password_hash, u.name, u.role, u.totp_enabled_at, u.signup_pending, t.status as tstatus
    from users u join tenants t on t.id = u.tenant where lower(u.email) = ${i.email}`;
  const ok = u ? await verifyPassword(i.password, u.password_hash) : false;
  if (!u || !ok) {
    await audit(sql, null, 'auth.login_failed', 'user', u?.id ?? null, { email: i.email }, ip);
    throw new HttpError(401, 'invalid_credentials', '이메일 또는 비밀번호가 올바르지 않습니다');
  }
  if (u.status !== 'active') {
    await audit(sql, u.id, 'auth.login_blocked', 'user', u.id, { status: u.status }, ip);
    throw new HttpError(403, 'inactive', '사용이 중지된 계정입니다. 관리자에게 문의하세요.');
  }
  if (u.signup_pending) throw new HttpError(403, 'email_unverified', '이메일 확인이 아직 끝나지 않았습니다. 가입 때 받은 메일의 링크를 눌러 주세요.');
  if (u.tstatus !== 'active') {
    await audit(sql, u.id, 'auth.login_blocked', 'user', u.id, { tenant: u.tstatus }, ip);
    throw new HttpError(403, 'tenant_blocked', '사용이 중지된 회사(공간)입니다. 문의: 워크인 운영팀');
  }
  // V12 3번: 2단계 인증을 켠 사람은 10분짜리 "코드 대기" 세션 → /api/auth/2fa/verify 로 확인해야 로그인 완료
  if (u.totp_enabled_at) {
    const { token } = await createSession(u.id, i.client, req.headers.get('user-agent'), { ip, mfaPending: true, persistent: i.remember });
    await audit(sql, u.id, 'auth.login_mfa_pending', 'user', u.id, { client: i.client }, ip);
    const res = NextResponse.json({ mfaRequired: true });
    res.cookies.set(sessionCookie(token, 600));
    return res;
  }
  const { token, maxAge, persistent } = await createSession(u.id, i.client, req.headers.get('user-agent'), { ip, persistent: i.remember });
  await audit(sql, u.id, 'auth.login', 'user', u.id, { client: i.client, persistent }, ip);
  const res = NextResponse.json({ user: { id: u.id, name: u.name, role: u.role } });
  res.cookies.set(sessionCookie(token, maxAge));
  return res;
}, { public: true });
