import { handler, body } from '@/lib/api';
import { createTaskShare, shareInput } from '@/lib/mailbox';

/** V21 기간 다운로드 링크(14일) — 문자에 넣거나 직접 보낼 때 */
export const POST = handler(async ({ req, user }) => createTaskShare(user, await body(req, shareInput)));
