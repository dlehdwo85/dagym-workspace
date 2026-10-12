import { handler } from '@/lib/api';
import { listHolidays } from '@/lib/insights';

export const GET = handler(async ({ req }) => {
  const sp = req.nextUrl.searchParams;
  const ok = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const from = ok(sp.get('from')) ?? `${new Date().getFullYear()}-01-01`;
  const to = ok(sp.get('to')) ?? `${new Date().getFullYear() + 1}-12-31`;
  return { holidays: await listHolidays(from, to) };
});
