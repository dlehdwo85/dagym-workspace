import { handler } from '@/lib/api';
import { relayFile } from '@/lib/sales/files';
import { assertSpace } from '@/lib/spaces';

/** S1-4 공고 첨부 중계(원본 /api/bids/file?u=&n= 그대로): 로그인·영업 공간 · 허용 공공 사이트만 · 30MB · 리다이렉트 안 따라감 · 저장 안 함.
 *  #507 후속: f = 이름을 못 읽을 때 쓸 이름, o = 원문 주소(웹페이지가 오면 '원문 열기' 안내에) */
export const GET = handler(async ({ req, user }) => {
  await assertSpace(user, 'sales');
  const q = req.nextUrl.searchParams;
  return relayFile(q.get('u') ?? '', q.get('n'), { fallback: q.get('f'), origin: q.get('o'), bid: q.get('bid') });
});
