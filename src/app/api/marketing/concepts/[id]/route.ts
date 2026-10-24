import { handler, body } from '@/lib/api';
import { actConceptSet, conceptAction } from '@/lib/mktConcepts';

export const maxDuration = 120; // 대표 10/24 ①: 만드는 일은 글 모델(최상 모델 30~60초)
/** #499-4 채택(1~4개 → 광고형 제작 의뢰) · 반려(사유 → AI 고친 안) · 취소 */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => actConceptSet(user, params.id, await body(req, conceptAction)));
