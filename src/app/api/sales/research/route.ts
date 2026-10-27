import { handler } from '@/lib/api';
import { researchForTask, researchOverview, runResearchManual } from '@/lib/sales/research';

/** 212차 #612 후속조사: ?task= 업무에 묶인 시설(업무 [완료] 창) · 없으면 허브 '준공·입주 시설' 머리 줄(이번 주 묶음) */
export const GET = handler(async ({ req, user }) => { const task = req.nextUrl.searchParams.get('task'); return task ? researchForTask(user, task) : researchOverview(user); });
/** [이번 주 후속조사 지금 만들기] — 관리자, 이번 주 묶음이 없을 때만 */
export const POST = handler(async ({ user }) => runResearchManual(user));
