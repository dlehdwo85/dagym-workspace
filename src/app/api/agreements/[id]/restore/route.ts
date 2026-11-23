import { handler, clientIp } from '@/lib/api';
import { restoreAgreement } from '@/lib/agreements';

/** D-05(대표 11/23): 보관함의 계약 되살리기 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => restoreAgreement(user, params.id, clientIp(req)));
