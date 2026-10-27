import { handler } from '@/lib/api';
import { endMeeting } from '@/lib/meetings';

/** 회의 끝내기(주최자·공동 주최자) — 엔진 방을 닫아 모두 나감 · 회의 기록 */
export const POST = handler<{ id: string }>(async ({ user, params }) => endMeeting(user, params.id));
