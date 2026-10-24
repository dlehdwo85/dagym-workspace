import { handler, body } from '@/lib/api';
import { carouselInput, carouselView, createCarousel } from '@/lib/mktCarousel';

export const maxDuration = 120; // 대표 10/24 ①: 만드는 일은 글 모델(최상 모델 30~60초)
/** #499-5 카드뉴스: 최근 카드뉴스(초안 먼저)·브랜드·틀 */
export const GET = handler(async ({ user }) => carouselView(user));
/** [장별 문구 만들기](마케팅 공간 누구나): 주제 → AI 장별 문구·표·이미지 계획·본문 → 초안 */
export const POST = handler(async ({ req, user }) => createCarousel(user, await body(req, carouselInput)));
