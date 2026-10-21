import { handler } from '@/lib/api';
import { previewLine } from '@/lib/approvalForms';

/** #114 ② 작성 화면 결재선 미리 보기: ?kind=&formId=&lineId= → 기안(나) → 단계별 결재자 이름 + 고를 수 있는 결재선 */
export const GET = handler(async ({ req, user }) => { const q = req.nextUrl.searchParams; return previewLine(user, { kind: q.get('kind') ?? undefined, formId: q.get('formId') || undefined, lineId: q.get('lineId') || undefined }); });
