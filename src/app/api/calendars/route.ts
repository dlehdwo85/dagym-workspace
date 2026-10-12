import { handler } from '@/lib/api';
import { visibleCalendars, ensurePersonalCalendar } from '@/lib/access';

export const GET = handler(async ({ user }) => {
  await ensurePersonalCalendar(user.id, user.name);
  return { calendars: await visibleCalendars(user) };
});
