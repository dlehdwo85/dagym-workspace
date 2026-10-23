import { handler, body } from '@/lib/api';
import { conceptSuggestInput, suggestConceptInput } from '@/lib/mktConcepts';

export const maxDuration = 60;
/** #499-4 [AI로 채우기]: 회사·브랜드 소개로 제품·구매자 역할·상황(고통·제안) 초안 */
export const POST = handler(async ({ req, user }) => suggestConceptInput(user, await body(req, conceptSuggestInput)));
