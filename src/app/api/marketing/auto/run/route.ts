import { handler } from '@/lib/api';
import { runNow } from '@/lib/mktAuto';

export const maxDuration = 300;
/** 관리자: 지금 바로 규칙 → 칸 만들기·제작·알림 한 번(정기 실행과 같은 것) */
export const POST = handler(async ({ user }) => runNow(user));
