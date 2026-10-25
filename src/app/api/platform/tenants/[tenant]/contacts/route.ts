import { handler, body, clientIp } from '@/lib/api';
import { addContactLog, contactLogInput, listContactLogs } from '@/lib/platformAdmin';

/** #656 고객사 연락 기록(전화·메일·미팅·카카오톡·메모 + 다음 연락 예정일) — 플랫폼 운영자만 */
export const GET = handler<{ tenant: string }>(async ({ user, params }) => listContactLogs(user, params.tenant));
export const POST = handler<{ tenant: string }>(async ({ req, user, params }) => addContactLog(user, params.tenant, await body(req, contactLogInput), clientIp(req)));
