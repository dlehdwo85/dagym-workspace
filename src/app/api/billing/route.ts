import { handler } from '@/lib/api';
import { billingOverview } from '@/lib/billing';

/** 18차: 결제 수단·다음 결제·영수증·요금 견적 (공간 대표·관리자) */
export const GET = handler(async ({ user }) => billingOverview(user));
