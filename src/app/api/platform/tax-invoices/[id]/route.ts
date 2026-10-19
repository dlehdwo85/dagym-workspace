import { handler, body, clientIp } from '@/lib/api';
import { markTaxInvoice, taxMarkInput } from '@/lib/billing/settlement';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => markTaxInvoice(user, params.id, await body(req, taxMarkInput), clientIp(req)));
