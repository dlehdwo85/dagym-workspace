import { handler } from '@/lib/api';
import { joinMeeting } from '@/lib/meetings';

/** 직원 [참가] — 대기실 정책에 따라 입장권 또는 대기 */
export const POST = handler<{ id: string }>(async ({ user, params }) => joinMeeting(user, params.id));
