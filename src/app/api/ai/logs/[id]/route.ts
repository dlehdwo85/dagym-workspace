import { handler, clientIp } from '@/lib/api';
import { logDelete, logThread } from '@/lib/ai/threads';

/** 열람도 감사 기록에 남는다 */
export const GET = handler<{ id: string }>(async ({ req, user, params }) => logThread(user, params.id, clientIp(req)));
export const DELETE = handler<{ id: string }>(async ({ req, user, params }) => logDelete(user, params.id, clientIp(req)));
