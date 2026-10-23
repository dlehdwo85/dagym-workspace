import { handler } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { carouselSlidePng } from '@/lib/mktCarousel';

export const maxDuration = 30;
/** #499-5 미리보기: 한 장(1부터)을 서버가 그린 그림 그대로 PNG — 주소에 ?v=수정 시각을 붙여 고칠 때마다 새로 받음 */
export const GET = handler<{ id: string; n: string }>(async ({ user, params }) => {
  const n = Number(params.n); if (!Number.isInteger(n) || n < 1 || n > 10) throw notFound('그 장이 없습니다');
  const png = await carouselSlidePng(user, params.id, n);
  return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=600' } });
});
