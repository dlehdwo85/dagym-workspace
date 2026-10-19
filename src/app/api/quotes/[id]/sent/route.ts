import { handler, body, clientIp } from '@/lib/api';
import { markQuoteSent, sentInput } from '@/lib/quotes';

/** 사람이 [보냈어요]를 누른 것만 기록(외부 발송 권한) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => markQuoteSent(user, params.id, await body(req, sentInput), clientIp(req)), { idempotent: true });
