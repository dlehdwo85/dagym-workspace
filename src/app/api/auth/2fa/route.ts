import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { db } from '@/lib/db';
import { decrypt, encrypt } from '@/lib/crypto';
import { badRequest } from '@/lib/errors';
import { audit } from '@/lib/log';
import { newSecret, otpauthUrl, verifyTotp } from '@/lib/totp';
import { denyDemo } from '@/lib/access';

/** V12 3번 2단계 인증(OTP 앱) 켜기·끄기 */
export const GET = handler(async ({ user }) => {
  const [r] = await db()<{ totp_enabled_at: Date | null }[]>`select totp_enabled_at from users where id = ${user.id}`;
  return { enabled: !!r?.totp_enabled_at, enabledAt: r?.totp_enabled_at ?? null };
});
/** 1단계: 비밀값 만들기(아직 꺼짐) → OTP 앱에 등록 */
export const POST = handler(async ({ user }) => {
  denyDemo(user);
  const secret = newSecret();
  await db()`update users set totp_secret = ${encrypt(secret)} where id = ${user.id} and totp_enabled_at is null`;
  return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
});
const code = z.object({ code: z.string().trim().min(6).max(8) });
/** 2단계: 앱에 보이는 6자리로 켜기 */
export const PUT = handler(async ({ req, user }) => {
  const { code: c } = await body(req, code);
  const sql = db();
  const [r] = await sql<{ totp_secret: string | null; totp_enabled_at: Date | null }[]>`select totp_secret, totp_enabled_at from users where id = ${user.id}`;
  if (!r?.totp_secret) throw badRequest('먼저 "2단계 인증 설정"을 눌러 OTP 앱에 등록하세요');
  if (!verifyTotp(decrypt(r.totp_secret), c)) throw badRequest('코드가 맞지 않습니다 — 앱에 보이는 최신 6자리를 입력하세요');
  await sql`update users set totp_enabled_at = now() where id = ${user.id}`;
  await audit(sql, user.id, 'auth.2fa_enabled', 'user', user.id, {}, clientIp(req));
  return { ok: true };
});
/** 끄기: 지금 코드로 확인 */
export const DELETE = handler(async ({ req, user }) => {
  const { code: c } = await body(req, code);
  const sql = db();
  const [r] = await sql<{ totp_secret: string | null }[]>`select totp_secret from users where id = ${user.id}`;
  if (!r?.totp_secret || !verifyTotp(decrypt(r.totp_secret), c)) throw badRequest('코드가 맞지 않습니다');
  await sql`update users set totp_enabled_at = null, totp_secret = null where id = ${user.id}`;
  await audit(sql, user.id, 'auth.2fa_disabled', 'user', user.id, {}, clientIp(req));
  return { ok: true };
});
