import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/crypto';
import { createSession, sessionCookie } from '@/lib/auth';
import { forbidden, conflict } from '@/lib/errors';
import { ensurePersonalCalendar } from '@/lib/access';
import { audit } from '@/lib/log';
import { timingSafeEqual } from 'node:crypto';

const schema = z.object({
  secret: z.string().min(1),
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(50),
  password: z.string().min(10, '비밀번호는 10자 이상'),
});

export const GET = handler(async () => {
  const r = await db()`select count(*)::int c from users`;
  return { needsSetup: r[0].c === 0 && !!process.env.SETUP_SECRET };
}, { public: true });

/** 최초 1회: 사용자 0명 + SETUP_SECRET 일치 시 대표 계정 생성 */
export const POST = handler(async ({ req }) => {
  const i = await body(req, schema);
  const secret = process.env.SETUP_SECRET ?? '';
  const a = Buffer.from(i.secret), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) throw forbidden('설정 비밀값이 올바르지 않습니다');
  const sql = db();
  const id = await sql.begin(async (tx) => {
    await tx`lock table users in exclusive mode`;
    const c = await tx`select 1 from users limit 1`;
    if (c.length) throw conflict('이미 초기 설정이 완료되었습니다');
    // 첫 대표 = 플랫폼 운영자(V10 /platform)
    const [u] = await tx<{ id: string }[]>`insert into users (email, name, role, status, password_hash, platform_admin)
      values (${i.email}, ${i.name}, 'owner', 'active', ${await hashPassword(i.password)}, true) returning id`;
    await tx`insert into memberships (user_id, org_unit_id) values (${u.id}, '00000000-0000-0000-0000-000000000001')`;
    await ensurePersonalCalendar(u.id, i.name, tx);
    await audit(tx, u.id, 'setup.owner_created', 'user', u.id, { email: i.email }, clientIp(req));
    return u.id;
  });
  const { token, maxAge } = await createSession(id, 'web', req.headers.get('user-agent'));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie(token, maxAge));
  return res;
}, { public: true });
