import { handler, body } from '@/lib/api';
import { handoffInput, requestHandoff } from '@/lib/tasks';

/** V14 1번 담당자 본인의 "다른 사람에게 넘기기" 요청 (요청자 승인) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => requestHandoff(user, params.id, await body(req, handoffInput)));
