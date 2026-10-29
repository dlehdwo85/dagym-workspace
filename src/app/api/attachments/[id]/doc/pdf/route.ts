import { handler } from '@/lib/api';
import { docImagesToPdf } from '@/lib/attachmentEdit';

/** #806 사진만 든 Word → 사진을 쪽마다 PDF 로 같은 업무에 새 첨부(원본 Word 그대로) */
export const POST = handler<{ id: string }>(async ({ user, params }) => docImagesToPdf(user, params.id));
