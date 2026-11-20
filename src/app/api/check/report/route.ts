import { handler } from '@/lib/api';
import { checkReport } from '@/lib/check/report';

/** 점검 리포트(숫자·표): ?from=YYYY-MM-DD&to=YYYY-MM-DD&unitId= — 권한 '점검 리포트'(없으면 404) */
export const GET = handler(async ({ req, user }) => {
  const q = req.nextUrl.searchParams;
  return checkReport(user, { from: q.get('from'), to: q.get('to'), unitId: q.get('unitId') });
});
