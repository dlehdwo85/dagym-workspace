import { body, handler } from '@/lib/api';
import { startWindow, windowInput } from '@/lib/billing';

/** 연간·팩 결제창 파라미터 */
export const POST = handler(async ({ req, user }) => startWindow(user, await body(req, windowInput), req.nextUrl.origin));
