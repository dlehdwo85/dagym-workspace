import { handler, body, clientIp } from '@/lib/api';
import { actGoal, goalAction } from '@/lib/mktGoals';

export const maxDuration = 120; // 대표 10/24 ①: 다시 쓰기도 글 모델(최상 모델 30~60초)

/** update(목표·주간 달력 편집) · approve · redraft · review(주간 리뷰 지금) · close(월말 결산) */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => actGoal(user, params.id, await body(req, goalAction), clientIp(req)));
