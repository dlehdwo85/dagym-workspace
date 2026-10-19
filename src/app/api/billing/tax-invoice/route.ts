import { handler, body, clientIp } from '@/lib/api';
import { myTaxInvoices, requestTaxInvoice, taxRequestInput } from '@/lib/billing/settlement';

/** 고객: 세금계산서 요청 목록·기본값(회사 정보) · 결제 건에 요청 */
export const GET = handler(async ({ user }) => myTaxInvoices(user));
export const POST = handler(async ({ req, user }) => requestTaxInvoice(user, await body(req, taxRequestInput), clientIp(req)), { idempotent: true });
