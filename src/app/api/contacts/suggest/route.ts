import { handler } from '@/lib/api';
import { suggestRecipients } from '@/lib/contacts';

/** V31 ② 받는 사람 자동 완성: ?q=&taskId=&kind=phone|email|any */
export const GET = handler(async ({ req, user }) => {
  const q = req.nextUrl.searchParams; const kind = q.get('kind');
  return suggestRecipients(user, { q: q.get('q') ?? '', taskId: q.get('taskId') || null, kind: kind === 'phone' || kind === 'email' ? kind : 'any' });
});
