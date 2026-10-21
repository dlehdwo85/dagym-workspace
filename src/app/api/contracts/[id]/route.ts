import { handler, clientIp } from '@/lib/api';
import { cancelContract, getContract } from '@/lib/contracts';

/** #116 계약서 상세(서명자·감사 추적) · 취소 */
export const GET = handler<{ id: string }>(async ({ user, params }) => getContract(user, params.id));
export const DELETE = handler<{ id: string }>(async ({ req, user, params }) => cancelContract(user, params.id, clientIp(req)));
