import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { listCsv } from '@/lib/sales/support';

/** #784 신청 목록 [엑셀로] — CSV(엑셀에서 바로 열림) */
export const GET = handler(async ({ user }) => {
  const f = await listCsv(user);
  return new NextResponse(f.body, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}` } });
});
