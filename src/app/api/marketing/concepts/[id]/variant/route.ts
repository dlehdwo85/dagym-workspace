import { handler, body } from '@/lib/api';
import { conceptVariantInput, variantConceptSet } from '@/lib/mktConcepts';

export const maxDuration = 60;
/** #499-4 [새 각도]: 채택한 컨셉의 대상·상황은 그대로, 형식·각도만 바꾼 컨셉 4~6개 → 승인 대기 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => variantConceptSet(user, params.id, await body(req, conceptVariantInput)));
