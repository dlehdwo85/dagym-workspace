import { handler, body } from '@/lib/api';
import { createGoalNow, goalCreate, listGoals } from '@/lib/mktGoals';

export const maxDuration = 120; // 대표 10/24 ①: 월 목표 초안도 글 모델(최상 모델 30~60초)

/** 대표 10/20 18:00 ② 월 운영 목표: 목록(?month=) · [초안 만들기] */
export const GET = handler(async ({ req, user }) => listGoals(user, req.nextUrl.searchParams.get('month') ?? undefined));
export const POST = handler(async ({ req, user }) => createGoalNow(user, await body(req, goalCreate)));
