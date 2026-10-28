import { body, handler } from '@/lib/api';
import { guestInput, guestRequest } from '@/lib/meetings';

/** 손님 [참가 요청] — 이름만 · 비밀값은 이때 한 번만 돌려줌(브라우저에만 보관) */
export const POST = handler<{ code: string }>(async ({ req, params }) => guestRequest(params.code, await body(req, guestInput)), { public: true });
