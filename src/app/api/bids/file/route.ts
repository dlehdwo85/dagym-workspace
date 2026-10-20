import { handler } from '@/lib/api';
import { relayFile } from '@/lib/sales/files';
import { assertSpace } from '@/lib/spaces';

/** S1-4 공고 첨부 중계(원본 /api/bids/file?u=&n= 그대로): 로그인·영업 공간 · 허용 공공 사이트만 · 30MB · 리다이렉트 안 따라감 · 저장 안 함 */
export const GET = handler(async ({ req, user }) => {
  await assertSpace(user, 'sales');
  return relayFile(req.nextUrl.searchParams.get('u') ?? '', req.nextUrl.searchParams.get('n'));
});
