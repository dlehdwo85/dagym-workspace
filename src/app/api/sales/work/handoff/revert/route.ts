import { body, handler } from '@/lib/api';
import { revertHandoff, revertInput } from '@/lib/sales/handoff';

/** 대표 10/21 12:00 영업 재편 2): [배정 이전으로 되돌리기] — 업무·일정 취소(이력), 원 행 '영업 중' 해제, 리드 '되돌림' */
export const POST = handler(async ({ req, user }) => revertHandoff(user, await body(req, revertInput)));
