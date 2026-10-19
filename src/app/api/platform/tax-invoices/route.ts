import { handler } from '@/lib/api';
import { listTaxInvoices } from '@/lib/billing/settlement';

export const GET = handler(async ({ req, user }) => listTaxInvoices(user, req.nextUrl.searchParams.get('status') || undefined));
