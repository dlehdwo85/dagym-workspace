import { handler, clientIp } from '@/lib/api';
import { deleteContactLog } from '@/lib/platformAdmin';

/** #656 연락 기록 한 건 지우기 */
export const DELETE = handler<{ tenant: string; id: string }>(async ({ req, user, params }) => deleteContactLog(user, params.tenant, params.id, clientIp(req)));
