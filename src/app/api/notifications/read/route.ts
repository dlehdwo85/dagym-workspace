import { z } from 'zod';
import { handler, body, zUuid } from '@/lib/api';
import { db } from '@/lib/db';

/** 읽음: ids · 전부 · link(V32 0: 그 화면을 열면 그 화면으로 가는 알림 자동 읽음). 읽음으로 바뀐 개수와 남은 안 읽음 수를 돌려준다 */
export const POST = handler(async ({ req, user }) => {
  const i = await body(req, z.object({ ids: z.array(zUuid).max(500).optional(), all: z.boolean().optional(), link: z.string().startsWith('/').max(300).optional() }));
  const sql = db();
  let r: { id: string }[] = [];
  if (i.all) r = await sql`update notifications set read_at = now() where user_id = ${user.id} and read_at is null returning id`;
  else if (i.ids?.length) r = await sql`update notifications set read_at = now() where user_id = ${user.id} and id = any(${i.ids}::uuid[]) and read_at is null returning id`;
  else if (i.link) {
    const l = i.link.split(/[?#]/)[0];
    if (l.length > 1) r = await sql`update notifications set read_at = now() where user_id = ${user.id} and read_at is null and type <> 'chat'
      and (link = ${l} or link like ${l + '?%'} or link like ${l + '#%'}) returning id`;
  }
  const [c] = await sql`select count(*)::int c from notifications where user_id = ${user.id} and read_at is null and type <> 'chat'`;
  return { ok: true, changed: r.length, unread: c.c };
});
