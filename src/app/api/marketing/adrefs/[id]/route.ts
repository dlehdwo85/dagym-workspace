import { handler, body } from '@/lib/api';
import { adRefPatch, patchAdRef } from '@/lib/mktAdRefs';

export const maxDuration = 120; // 대표 10/24 ①: 만드는 일은 글 모델(최상 모델 30~60초)
/** #499-6 고치기 · ★ 참고 표시 · [AI 분석](한 편 뼈대·제안·각도) · 빼기 */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => patchAdRef(user, params.id, await body(req, adRefPatch)));
