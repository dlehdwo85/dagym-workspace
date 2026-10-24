import { handler, body } from '@/lib/api';
import { conceptSuggestInput, suggestConceptInput } from '@/lib/mktConcepts';

export const maxDuration = 120; // 대표 10/24 ①: 만드는 일은 글 모델(최상 모델 30~60초)
/** #499-4 [AI로 채우기]: 회사·브랜드 소개로 제품·구매자 역할·상황(고통·제안) 초안 */
export const POST = handler(async ({ req, user }) => suggestConceptInput(user, await body(req, conceptSuggestInput)));
