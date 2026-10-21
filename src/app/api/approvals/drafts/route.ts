import { handler, body } from '@/lib/api';
import { draftInput, saveDraft } from '@/lib/approvalForms';

/** #114 ④ 결재 임시 저장 만들기(값만 보관, 필수 검사 없음) */
export const POST = handler(async ({ req, user }) => saveDraft(user, null, await body(req, draftInput)));
