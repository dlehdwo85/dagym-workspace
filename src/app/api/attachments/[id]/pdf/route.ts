import { handler, body } from '@/lib/api';
import { editPdf, pdfEditInput } from '@/lib/attachmentEdit';

/** #533 PDF [고치기]: 가리기·글자·체크·서명을 찍어 같은 첨부의 새 버전 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => editPdf(user, params.id, await body(req, pdfEditInput)));
