import { handler, body } from '@/lib/api';
import { conceptSetInput, conceptView, createConceptSet } from '@/lib/mktConcepts';

export const maxDuration = 120; // 대표 10/24 ①: 만드는 일은 글 모델(최상 모델 30~60초)
/** #499-4 상황 매트릭스: 최근 매트릭스(승인 대기 먼저)·채택한 컨셉의 제작 의뢰 상태 */
export const GET = handler(async ({ user }) => conceptView(user));
/** [컨셉 만들기](마케팅 공간 누구나): 제품·역할 × 상황 → AI 컨셉 8~12개 → 승인 대기 + 승인자 알림 */
export const POST = handler(async ({ req, user }) => createConceptSet(user, await body(req, conceptSetInput)));
