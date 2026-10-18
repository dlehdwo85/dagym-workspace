import { handler, body } from '@/lib/api';
import { opsImportStatus, runInput, runOpsImport } from '@/lib/opsImport';

export const maxDuration = 300;
/** V41 4-2 운영실 데이터 이관(플랫폼 운영자): 상태 · 미리보기/적용 */
export const GET = handler(async ({ user }) => opsImportStatus(user));
export const POST = handler(async ({ req, user }) => runOpsImport(user, await body(req, runInput)));
