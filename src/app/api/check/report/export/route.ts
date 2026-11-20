import { handler } from '@/lib/api';
import { exportCheckReport } from '@/lib/check/report';
import { xlsxResponse } from '@/lib/xlsx';

/** 점검 리포트 엑셀(요약 · 곳별 · 분야별 · 항목별 · 보완 요청) */
export const GET = handler(async ({ req, user }) => {
  const q = req.nextUrl.searchParams;
  const f = await exportCheckReport(user, { from: q.get('from'), to: q.get('to'), unitId: q.get('unitId') });
  return xlsxResponse(f.data, f.fileName);
});
