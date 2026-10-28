import { body, handler } from '@/lib/api';
import { participantAction, participantInput } from '@/lib/meetings';

/** 참가자(주최자·공동 주최자): 내보내기(다시 못 들어옴) · 공동 주최자 지정/해제 */
export const POST = handler<{ id: string; pid: string }>(async ({ req, user, params }) => participantAction(user, params.id, params.pid, await body(req, participantInput)));
