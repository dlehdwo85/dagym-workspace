import { handler, body } from '@/lib/api';
import { callInput, createCall, listCalls } from '@/lib/marketing';

/** 전화 문의(수동 입력 — 전화 추적 스니펫은 회사별 비밀값과 함께 다음 단계) */
export const GET = handler(async ({ req, user }) => listCalls(user, { status: req.nextUrl.searchParams.get('status') ?? undefined }));
export const POST = handler(async ({ req, user }) => createCall(user, await body(req, callInput)));
