import { handler } from '@/lib/api';
import { mergeBatchByUser } from '@/lib/taskMerge';

/** 280차 #821 [공동 업무로 합치기] — '각자 1건씩' 묶음을 함께 담당 1건으로(요청자·만든 사람·관리자) */
export const POST = handler<{ batchId: string }>(async ({ user, params }) => mergeBatchByUser(user, params.batchId));
