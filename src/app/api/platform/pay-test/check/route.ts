import { handler } from '@/lib/api';
import { testCheck } from '@/lib/billing/payTest';

/** V32 1 결제 뒤 자동 확인 */
export const GET = handler(async ({ req, user }) => testCheck(user, req.nextUrl.searchParams.get('payment') ?? ''));
