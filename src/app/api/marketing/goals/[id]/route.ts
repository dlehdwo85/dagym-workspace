import { handler, body, clientIp } from '@/lib/api';
import { actGoal, goalAction } from '@/lib/mktGoals';

/** update(목표·주간 달력 편집) · approve · redraft · review(주간 리뷰 지금) · close(월말 결산) */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => actGoal(user, params.id, await body(req, goalAction), clientIp(req)));
