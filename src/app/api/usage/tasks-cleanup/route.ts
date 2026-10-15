import { NextResponse } from 'next/server';
import { handler, body } from '@/lib/api';
import { cleanupApply, cleanupCsv, cleanupInput, cleanupPreview } from '@/lib/plans';

/** V29 3장 오래된 완료 업무: GET ?before=YYYY-MM-DD → 개수(format=csv 면 보관 파일), POST {before} → 정리 */
export const GET = handler(async ({ req, user }) => {
  const { before } = cleanupInput.parse({ before: req.nextUrl.searchParams.get('before') ?? '' });
  if (req.nextUrl.searchParams.get('format') !== 'csv') return cleanupPreview(user, before);
  return new NextResponse(await cleanupCsv(user, before), { headers: { 'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`완료업무_${before}_이전.csv`)}` } });
});
export const POST = handler(async ({ req, user }) => cleanupApply(user, (await body(req, cleanupInput)).before));
