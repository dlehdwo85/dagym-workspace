import { handler, body, clientIp } from '@/lib/api';
import { markInput, markSettlement } from '@/lib/billing/settlement';

export const PATCH = handler<{ paymentId: string }>(async ({ req, user, params }) => markSettlement(user, params.paymentId, await body(req, markInput), clientIp(req)));
