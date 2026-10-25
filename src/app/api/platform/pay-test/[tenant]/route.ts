import { handler, clientIp } from '@/lib/api';
import { removeTestTenant } from '@/lib/billing/payTest';

/** #566 결제 시험 회사 [지우기](플랫폼 운영자, 시험 회사만 — 결제 기록이 있으면 숨기기) */
export const DELETE = handler<{ tenant: string }>(async ({ req, user, params }) => removeTestTenant(user, params.tenant, clientIp(req)));
