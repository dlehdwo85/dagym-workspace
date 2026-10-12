import { handler } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { findConflicts } from '@/lib/events';

export const GET = handler(async ({ req, user }) => {
  const p = req.nextUrl.searchParams;
  const s = new Date(p.get('start') ?? ''), e = new Date(p.get('end') ?? '');
  if (isNaN(+s) || isNaN(+e)) throw badRequest('start/end 가 필요합니다');
  const users = p.get('userIds')?.split(',').filter(Boolean) ?? [];
  const exclude = p.get('exclude')?.split(',').filter(Boolean) ?? [];
  return { conflicts: await findConflicts(user, users, s, e, exclude) };
});
