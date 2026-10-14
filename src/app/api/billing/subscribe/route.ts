import { body, clientIp, handler } from '@/lib/api';
import { subscribeInput, subscribeMonthly } from '@/lib/billing';

/** 월 구독 시작·변경(등록 카드로 첫 달 결제) */
export const POST = handler(async ({ req, user }) => subscribeMonthly(user, await body(req, subscribeInput), clientIp(req)), { idempotent: true });
