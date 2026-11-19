import { handler } from '@/lib/api';
import { guestScreenTicket } from '@/lib/meetings';

/** 휴대폰 앱 화면 공유용 입장권(손님, 헤더 x-guest-secret) */
export const POST = handler<{ code: string; pid: string }>(async ({ req, params }) => guestScreenTicket(params.code, params.pid, req.headers.get('x-guest-secret')), { public: true });
