import { z } from 'zod';
import { body, handler } from '@/lib/api';
import { bidRevertInput, revertBidHandoff } from '@/lib/sales/bidTasks';
import { revertHandoff, revertInput } from '@/lib/sales/handoff';

/**
 * 대표 10/21 12:00 영업 재편 2): [배정 이전으로 되돌리기] — 업무·일정 취소(이력), 원 행 '영업 중' 해제, 리드 '되돌림'
 * 결정 15-35: 입찰 업무로 넘긴 공고는 { kind: 'bid', id } — 업무·일정 취소, 진행 기록은 넘기기 전 상태로
 */
const input = z.union([bidRevertInput, revertInput]);
export const POST = handler(async ({ req, user }) => { const i = await body(req, input); return 'kind' in i ? revertBidHandoff(user, i) : revertHandoff(user, i); });
