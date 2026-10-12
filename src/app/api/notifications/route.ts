import { handler } from '@/lib/api';
import { db } from '@/lib/db';

export const GET = handler(async ({ req, user }) => {
  const unreadOnly = req.nextUrl.searchParams.get('unread') === '1';
  const sql = db();
  const items = await sql`select n.id, n.type, n.title, n.body, n.link, n.read_at, n.created_at, u.name as actor_name
    from notifications n left join users u on u.id = n.actor_id
    where n.user_id = ${user.id} ${unreadOnly ? sql`and n.read_at is null` : sql``}
    order by n.created_at desc limit 100`;
  const [c] = await sql`select count(*)::int c from notifications where user_id = ${user.id} and read_at is null`;
  return { items, unread: c.c };
});
