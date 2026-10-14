import { z } from 'zod';
import { body, clientIp, handler } from '@/lib/api';
import { setAutoRenew } from '@/lib/billing';

/** 해지(다음 결제일에 종료) / 해지 취소 */
export const POST = handler(async ({ req, user }) => setAutoRenew(user, (await body(req, z.object({ renew: z.boolean() }))).renew, clientIp(req)));
