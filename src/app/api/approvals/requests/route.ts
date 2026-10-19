import { handler, body, clientIp } from '@/lib/api';
import { createRequest, listRequests, requestInput } from '@/lib/approvalForms';

/** 결재 요청: 목록(내 것·내가 결재할 것·관리자 전체, ?kind=&status=&month=) · 만들기(= 결재 업무 + 검토 요청) */
export const GET = handler(async ({ req, user }) => { const q = req.nextUrl.searchParams; return listRequests(user, { kind: q.get('kind') ?? undefined, status: q.get('status') ?? undefined, month: q.get('month') ?? undefined, mine: q.get('mine') === '1' }); });
export const POST = handler(async ({ req, user }) => createRequest(user, await body(req, requestInput), clientIp(req)), { idempotent: true });
