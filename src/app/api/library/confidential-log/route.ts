import { handler } from '@/lib/api';
import { confidentialLog } from '@/lib/library';

/** 기밀 자료 열람·내려받기·AI 참조 기록 */
export const GET = handler(async ({ user }) => ({ logs: await confidentialLog(user) }));
