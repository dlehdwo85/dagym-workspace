import { handler } from '@/lib/api';
import { saveDocToAttachment } from '@/lib/attachmentEdit';

/** [업무로 저장]: 워크인 문서 → Word 로 첨부 새 버전 */
export const POST = handler<{ id: string }>(async ({ user, params }) => saveDocToAttachment(user, params.id));
