import { handler } from '@/lib/api';
import { openAsDoc } from '@/lib/attachmentEdit';

/** [열어서 편집]: docx → 워크인 문서(공동 편집, 첫 번만 변환) */
export const POST = handler<{ id: string }>(async ({ user, params }) => openAsDoc(user, params.id));
