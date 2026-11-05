import { handler } from '@/lib/api';
import { notFound } from '@/lib/errors';

/** 374차(로컬 11/06 02:40): 운영 기본 지역(싱가포르)에서 KG2B 첫 장이 'fetch failed' → 메일처럼 서울 지역(icn1)에서 KG2B 를 불러 비교·미리 보기.
 *  ?do=probe(이름 찾기·연결·첫 화면·목록) · ?do=listpreview&pages=&days=(373차 미리 보기, 저장 안 함). 플랫폼 운영자만 */
export const preferredRegion = 'icn1';
export const maxDuration = 60;
export const GET = handler(async ({ req, user }) => {
  if (!user.platformAdmin) throw notFound();
  const u = new URL(req.url); const k = await import('@/lib/sales/collectors/kg2b');
  if (u.searchParams.get('do') === 'listpreview') return { kg2bList: await k.previewKg2bList({ pages: Number(u.searchParams.get('pages')) || 8, days: Number(u.searchParams.get('days')) || 14 }) };
  return { kg2bProbe: await k.kg2bProbe() };
});
