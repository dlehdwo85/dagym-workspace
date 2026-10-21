import { handler, body } from '@/lib/api';
import { scheduleSms, scheduleSmsInput } from '@/lib/mailbox';

/** #177 문자 예약: 서버는 문자를 못 보내므로(유료 발송 없음) 예약 시각에 보낸 사람에게 "보낼 시간" 알림 → 휴대폰 문자앱으로 넘겨 사람이 보냄 */
export const POST = handler(async ({ req, user }) => scheduleSms(user, await body(req, scheduleSmsInput)), { idempotent: true });
