import { handler, body, clientIp } from '@/lib/api';
import { deletionRequestInput, requestDeletion } from '@/lib/account';

/** V28-5 계정 삭제 요청(웹, 로그인 없이) — 스토어 "계정 삭제 URL" */
export const POST = handler(async ({ req, user }) => requestDeletion(user ?? null, await body(req, deletionRequestInput), clientIp(req)), { public: true });
