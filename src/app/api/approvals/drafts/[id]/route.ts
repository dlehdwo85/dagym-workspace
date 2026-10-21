import { handler, body } from '@/lib/api';
import { deleteDraft, draftInput, saveDraft } from '@/lib/approvalForms';

/** #114 ④ 결재 임시 저장 고치기·지우기(요청자 본인만, 다른 회사 404) */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => saveDraft(user, params.id, await body(req, draftInput)));
export const DELETE = handler<{ id: string }>(async ({ user, params }) => deleteDraft(user, params.id));
