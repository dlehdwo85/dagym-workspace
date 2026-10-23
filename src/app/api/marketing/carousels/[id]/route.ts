import { handler, body } from '@/lib/api';
import { carouselPatch, patchCarousel } from '@/lib/mktCarousel';

export const maxDuration = 60;
/** #499-5 고치기(장·본문·키워드·틀) · AI 로 고치기(수정 요청 반영) · 취소 */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => patchCarousel(user, params.id, await body(req, carouselPatch)));
