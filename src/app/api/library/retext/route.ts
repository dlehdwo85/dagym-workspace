import { handler } from '@/lib/api';
import { resetTextRetry } from '@/lib/library';

/** 관리자: 본문 없는 HWP·HWPX·PDF 전부 다시 시도 대기열로(정기 실행 15개씩) */
export const POST = handler(async ({ user }) => resetTextRetry(user));
