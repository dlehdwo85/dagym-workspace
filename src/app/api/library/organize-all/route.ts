import { handler } from '@/lib/api';
import { organizeAll } from '@/lib/library';

export const maxDuration = 300;
/** V14 3번 관리자 "전체 정리" (10개씩, 화면이 남은 수만큼 반복) */
export const POST = handler(async ({ user }) => organizeAll(user));
