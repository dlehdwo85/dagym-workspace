import { handler } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { isKaptUrl, kaptFileUrl, relayFile } from '@/lib/sales/files';
import { assertSpace } from '@/lib/spaces';

/** S1-4 K-apt 첨부 중계(원본 /api/bids/kapt-file?bid=&seq=). #507 후속(로컬 10/23 실측): 서버가 K-apt 세션을 열어(상세 → 첨부 목록 → 받기) 그 공고의 첨부인지 확인한 뒤 전달.
 *  u = 저장된 K-apt 첨부 주소, 또는 bid·seq. n = 이름, f = 이름을 못 읽을 때 쓸 이름('<공고명 앞 30자> 첨부 n'), 웹페이지가 오면 'K-apt 원문 열기' 안내 */
export const GET = handler(async ({ req, user }) => {
  await assertSpace(user, 'sales');
  const q = req.nextUrl.searchParams;
  const u = q.get('u') ?? (q.get('bid') && q.get('seq') ? kaptFileUrl(q.get('bid')!, q.get('seq')!) : '');
  if (!u) throw badRequest('bid·seq 또는 u 가 필요합니다');
  if (!isKaptUrl(u)) throw badRequest('K-apt 첨부만 받습니다');
  return relayFile(u, q.get('n'), { fallback: q.get('f'), bid: q.get('bid'), origin: q.get('o') });
});
