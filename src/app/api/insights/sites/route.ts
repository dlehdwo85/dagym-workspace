import { handler } from '@/lib/api';
import { siteComparison } from '@/lib/insights';

export const GET = handler(async ({ user, req }) => {
  const w = Number(req.nextUrl.searchParams.get('weeks'));
  return siteComparison(user, [4, 8, 12].includes(w) ? w : 4, req.nextUrl.searchParams.get('brand'));
});
