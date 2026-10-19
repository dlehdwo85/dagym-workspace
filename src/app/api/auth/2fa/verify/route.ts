import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { db } from '@/lib/db';
import { decrypt, sha256 } from '@/lib/crypto';
import { SESSION_COOKIE, sessionCookie } from '@/lib/auth';
import { HttpError, unauthorized } from '@/lib/errors';
import { audit } from '@/lib/log';
import { verifyTotp } from '@/lib/totp';

/** 로그인 2단계: 코드 대기 세션(10분) + OTP 6자리 → 정식 세션(30일). 5번 틀리면 처음부터 */
export const POST = handler(async ({ req }) => {
  const { code } = await body(req, z.object({ code: z.string().trim().min(6).max(8) }));
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) throw unauthorized('다시 로그인하세요');
  const sql = db();
  const id = sha256(token);
  const [s] = await sql<{ user_id: string; totp_secret: string | null; name: string; role: string; persistent: boolean }[]>`select s.user_id, u.totp_secret, u.name, u.role, s.persistent from sessions s join users u on u.id = s.user_id
    where s.id = ${id} and s.mfa_pending and s.revoked_at is null and s.expires_at > now() and u.status = 'active'`;
  if (!s || !s.totp_secret) throw unauthorized('시간이 지났습니다 — 다시 로그인하세요');
  const ip = clientIp(req);
  const [{ c }] = await sql<{ c: number }[]>`select count(*)::int c from audit_logs where action = 'auth.2fa_failed' and target_id = ${s.user_id} and created_at > now() - interval '10 minutes'`;
  if (c >= 5) { await sql`update sessions set revoked_at = now() where id = ${id}`; throw new HttpError(429, 'too_many', '코드를 여러 번 틀렸습니다 — 10분 뒤 다시 로그인하세요'); }
  if (!verifyTotp(decrypt(s.totp_secret), code)) {
    await audit(sql, s.user_id, 'auth.2fa_failed', 'user', s.user_id, {}, ip);
    throw new HttpError(400, 'bad_code', '코드가 맞지 않습니다 — OTP 앱의 최신 6자리를 입력하세요');
  }
  await sql`update sessions set mfa_pending = false, expires_at = now() + ${s.persistent ? sql`interval '30 days'` : sql`interval '1 day'`} where id = ${id}`; // 로그인 유지 여부는 비밀번호 단계에서 정함
  await sql`update users set last_login_at = now() where id = ${s.user_id}`;
  await audit(sql, s.user_id, 'auth.login', 'user', s.user_id, { mfa: true }, ip);
  const res = NextResponse.json({ user: { id: s.user_id, name: s.name, role: s.role } });
  res.cookies.set(sessionCookie(token, s.persistent ? 30 * 86400 : 0));
  return res;
}, { public: true });
