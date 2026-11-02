import { handler } from '@/lib/api';
import { closeBidCanceledTask } from '@/lib/sales/bidTasks';

/** 344차(대표 11/02 #925): 발주처가 취소한 공고의 입찰 업무 [공고 취소로 완료] — 담당자·공동 담당·요청자·넘긴 사람·관리자 */
export const POST = handler<{ id: string }>(async ({ user, params }) => closeBidCanceledTask(user, params.id));
