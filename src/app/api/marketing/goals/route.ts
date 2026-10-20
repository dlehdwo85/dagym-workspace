import { handler, body } from '@/lib/api';
import { createGoalNow, goalCreate, listGoals } from '@/lib/mktGoals';

/** 대표 10/20 18:00 ② 월 운영 목표: 목록(?month=) · [초안 만들기] */
export const GET = handler(async ({ req, user }) => listGoals(user, req.nextUrl.searchParams.get('month') ?? undefined));
export const POST = handler(async ({ req, user }) => createGoalNow(user, await body(req, goalCreate)));
