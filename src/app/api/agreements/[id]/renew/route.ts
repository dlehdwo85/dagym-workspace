import { handler, body, clientIp } from '@/lib/api';
import { renewAgreement, renewInput } from '@/lib/agreements';

/** 갱신 등록: 지난 기간은 이력으로, 새 만료일로 이어 감 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => renewAgreement(user, params.id, await body(req, renewInput), clientIp(req)));
