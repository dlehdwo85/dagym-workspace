import { handler, body, clientIp } from '@/lib/api';
import { applyImport, previewInput } from '@/lib/taskImport';

/** V30 ① 만들기: 오류 없는 줄만, 담당자마다 알림 1건 */
export const POST = handler(async ({ req, user }) => applyImport(user, await body(req, previewInput), clientIp(req)), { idempotent: true });
