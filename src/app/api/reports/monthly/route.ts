import { handler } from '@/lib/api';
import { monthCloses } from '@/lib/monthClose';

/** V20 리포트 "월별 기록" */
export const GET = handler(async ({ user }) => monthCloses(user));
