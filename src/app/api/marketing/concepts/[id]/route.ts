import { handler, body } from '@/lib/api';
import { actConceptSet, conceptAction } from '@/lib/mktConcepts';

export const maxDuration = 60;
/** #499-4 채택(1~4개 → 광고형 제작 의뢰) · 반려(사유 → AI 고친 안) · 취소 */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => actConceptSet(user, params.id, await body(req, conceptAction)));
