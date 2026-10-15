import { handler, body, clientIp } from '@/lib/api';
import { logSms, smsLogInput } from '@/lib/mailbox';

/** V21 문자(휴대폰 문자앱으로 넘김) — [보냈어요]를 누른 것만 기록 */
export const POST = handler(async ({ req, user }) => logSms(user, await body(req, smsLogInput), clientIp(req)), { idempotent: true });
