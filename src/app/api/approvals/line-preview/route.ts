import { handler } from '@/lib/api';
import { previewLine } from '@/lib/approvalForms';

/** #114 ② · #429 작성 화면 결재선 미리 보기: ?kind=&formId=&lineId=&d=(작성 중인 값 JSON — 조건 단계 판단) → 기안(나) → 1차·2차·3차 결재자 이름 + 정해진 곳 */
export const GET = handler(async ({ req, user }) => { const q = req.nextUrl.searchParams; return previewLine(user, { kind: q.get('kind') ?? undefined, formId: q.get('formId') || undefined, lineId: q.get('lineId') || undefined, data: q.get('d') || undefined }); });
