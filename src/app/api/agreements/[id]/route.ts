import { handler, body, clientIp } from '@/lib/api';
import { agreementInput, getAgreement, updateAgreement } from '@/lib/agreements';

/** 계약 한 건(기간 이력·계약서 파일·알림 받는 사람) · 고치기 */
export const GET = handler<{ id: string }>(async ({ user, params }) => getAgreement(user, params.id));
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => updateAgreement(user, params.id, await body(req, agreementInput.partial()), clientIp(req)));
