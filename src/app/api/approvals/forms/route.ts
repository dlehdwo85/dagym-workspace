import { handler, body, clientIp } from '@/lib/api';
import { formInput, listForms, saveForm } from '@/lib/approvalForms';

/** V30 ④ 결재 양식: 종류별 양식(없으면 기본) · 저장(운영 편집 권한) */
export const GET = handler(async ({ user }) => listForms(user));
export const POST = handler(async ({ req, user }) => saveForm(user, null, await body(req, formInput), clientIp(req)));
