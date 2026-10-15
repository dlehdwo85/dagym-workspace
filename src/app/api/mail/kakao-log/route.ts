import { handler, body, clientIp } from '@/lib/api';
import { kakaoLogInput, logKakao } from '@/lib/mailbox';

/** V28-2A 카카오톡 공유 — [보냈어요]를 누른 것만 기록 */
export const POST = handler(async ({ req, user }) => logKakao(user, await body(req, kakaoLogInput), clientIp(req)), { idempotent: true });
