import { handler, body } from '@/lib/api';
import { previewImport, previewInput } from '@/lib/taskImport';

/** V30 ① 미리보기: 담당자 맞추기·날짜·오류 줄 */
export const POST = handler(async ({ req, user }) => previewImport(user, await body(req, previewInput)));
