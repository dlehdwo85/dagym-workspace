import { handler, body } from '@/lib/api';
import { actIdea, ideaAction } from '@/lib/mktTeam';

export const maxDuration = 60;
/** #499-7 기획 담당 주제 [채택](→ 디자인 담당이 바로 만듦)·[반려](사유 = 기억)·[디자인 담당에게 맡기기] — 대표·관리자 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => actIdea(user, params.id, await body(req, ideaAction)));
