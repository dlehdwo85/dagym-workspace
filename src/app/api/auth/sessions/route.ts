import { handler } from '@/lib/api';
import { db } from '@/lib/db';

/** V12 3번: 로그인 기록(기기) · 다른 기기 모두 로그아웃 */
export const GET = handler(async ({ user }) => ({
  sessions: await db()`select left(id, 8) as id, client, user_agent, ip, created_at, last_seen_at, (id = ${user.sessionId}) as current
    from sessions where user_id = ${user.id} and revoked_at is null and expires_at > now() and not mfa_pending order by last_seen_at desc limit 20`,
}));
export const DELETE = handler(async ({ user }) => {
  const r = await db()`update sessions set revoked_at = now() where user_id = ${user.id} and id <> ${user.sessionId} and revoked_at is null returning id`;
  return { revoked: r.length };
});
