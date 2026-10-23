import { handler, body } from '@/lib/api';
import { carouselRenderInput, renderCarousel } from '@/lib/mktCarousel';

export const maxDuration = 60;
/** #499-5 [이미지로 만들어 승인 요청]: 장마다 JPEG → 자료실 '마케팅/카드뉴스' → 인스타 콘텐츠 승인 대기(이미 보냈으면 새 버전) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => renderCarousel(user, params.id, await body(req, carouselRenderInput)));
