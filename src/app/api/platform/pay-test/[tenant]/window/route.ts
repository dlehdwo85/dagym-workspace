import { handler, body } from '@/lib/api';
import { platformTestWindow, windowInput } from '@/lib/billing';

/** V32 1 이 시험 회사로 결제창(시험 상점 강제) */
export const POST = handler<{ tenant: string }>(async ({ req, user, params }) => platformTestWindow(user, params.tenant, await body(req, windowInput), req.nextUrl.origin));
