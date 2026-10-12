import { handler } from '@/lib/api';
import { gapi } from '@/lib/google/client';

export const GET = handler(async ({ user }) => {
  const r = await gapi(user.id, 'GET', '/users/me/calendarList', { query: { maxResults: '250' } });
  return { calendars: (r.items ?? []).map((c: any) => ({ id: c.id, name: c.summaryOverride ?? c.summary, primary: !!c.primary, accessRole: c.accessRole, timeZone: c.timeZone })) };
});
