import { handler, body } from '@/lib/api';
import { carouselTopicInput, carouselTopics } from '@/lib/mktCarousel';

export const maxDuration = 120; // 대표 10/24 ①: 만드는 일은 글 모델(최상 모델 30~60초)
/** #499-5 [주제 후보 받기]: 제품·서비스 → A vs B · N가지 방법 · 유형별 추천 · 체크리스트 4개(콘텐츠형 훅 점수) */
export const POST = handler(async ({ req, user }) => carouselTopics(user, await body(req, carouselTopicInput)));
