import { handler } from '@/lib/api';
import { fillExpected, settlementOverview } from '@/lib/billing/settlement';

/** V32 2 정산: ?month=YYYY-MM&tenant=&test=1 — 장부·집계·전월·날짜별·미수 */
export const GET = handler(async ({ req, user }) => {
  const q = req.nextUrl.searchParams;
  if (user.platformAdmin) await fillExpected();
  return settlementOverview(user, { month: q.get('month') ?? undefined, tenant: q.get('tenant') || undefined, includeTest: q.get('test') === '1' });
});
