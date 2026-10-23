import { handler, body } from '@/lib/api';
import { rejectInput, rejectMetaDraft } from '@/lib/metaAuto';

/** 반려(사유): 세팅안 보관, Meta 에는 꺼진 채로 남음 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => rejectMetaDraft(user, params.id, await body(req, rejectInput)));
