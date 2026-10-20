import { handler, body } from '@/lib/api';
import { completeVersion, completeVersionInput } from '@/lib/attachmentEdit';

/** [새 버전 올리기] 2/2: 올라간 파일을 현재 버전으로, 이전은 보관 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => completeVersion(user, params.id, await body(req, completeVersionInput)));
