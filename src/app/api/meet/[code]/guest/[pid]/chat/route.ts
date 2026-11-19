import { body, handler } from '@/lib/api';
import { chatInput, guestListChat, guestSendChat } from '@/lib/meetings';

/** 회의 중 채팅(손님, 헤더 x-guest-secret) — 자기가 참가 요청한 뒤의 글만 */
export const GET = handler<{ code: string; pid: string }>(async ({ req, params }) => guestListChat(params.code, params.pid, req.headers.get('x-guest-secret'), req.nextUrl.searchParams.get('after')), { public: true });
export const POST = handler<{ code: string; pid: string }>(async ({ req, params }) => guestSendChat(params.code, params.pid, req.headers.get('x-guest-secret'), await body(req, chatInput)), { public: true });
