import { body, clientIp, handler, zUuid } from '@/lib/api';
import { refundInput, refundPayment } from '@/lib/billing';

/** 환불(전체·부분) — 플랫폼 운영자 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => refundPayment(user, zUuid.parse(params.id), await body(req, refundInput), clientIp(req)));
