import { handler, body, clientIp } from '@/lib/api';
import { graceInput, platformBillingAction } from '@/lib/billing';

/** V28 B2 미납 유예 연장·잠금 해제 (플랫폼 운영자) */
export const POST = handler<{ tenant: string }>(async ({ req, user, params }) => platformBillingAction(user, params.tenant, await body(req, graceInput), clientIp(req)));
