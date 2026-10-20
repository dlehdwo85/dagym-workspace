import { handler } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { relayFile } from '@/lib/sales/files';
import { assertSpace } from '@/lib/spaces';

/** S1-4 K-apt 첨부 중계(원본 /api/bids/kapt-file?bid=&seq=): 원본은 K-apt 세션을 열어 그 공고의 첨부인지 확인한 뒤 전달 — 세션 열기는 수집기 이식(S1-1)과 함께.
 *  지금은 k-apt.go.kr 첨부 주소(u) 또는 bid·seq 로 만든 내려받기 주소를 같은 규칙(30MB·리다이렉트 금지)으로 중계한다 */
export const GET = handler(async ({ req, user }) => {
  await assertSpace(user, 'sales');
  const q = req.nextUrl.searchParams;
  const u = q.get('u') ?? (q.get('bid') && q.get('seq') ? `https://www.k-apt.go.kr/bid/bidFileDown.do?bidNum=${encodeURIComponent(q.get('bid')!)}&fileSeq=${encodeURIComponent(q.get('seq')!)}` : '');
  if (!u) throw badRequest('bid·seq 또는 u 가 필요합니다');
  if (!/(^|\.)k-apt\.go\.kr$/.test(new URL(u).hostname)) throw badRequest('K-apt 첨부만 받습니다');
  return relayFile(u, q.get('n'));
});
