import { handler, body } from '@/lib/api';
import { adRefPatch, patchAdRef } from '@/lib/mktAdRefs';

export const maxDuration = 60;
/** #499-6 고치기 · ★ 참고 표시 · [AI 분석](한 편 뼈대·제안·각도) · 빼기 */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => patchAdRef(user, params.id, await body(req, adRefPatch)));
