import { handler, body } from '@/lib/api';
import { extendInput, requestExtension } from '@/lib/tasks';

/** V32 4 마감 연장: 요청자 = 바로 연장, 담당자 = 요청자에게 요청(사유 필수) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => requestExtension(user, params.id, await body(req, extendInput)));
