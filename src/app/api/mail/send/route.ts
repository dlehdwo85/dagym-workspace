import { after } from 'next/server';
import { handler, body, clientIp } from '@/lib/api';
import { processOutbox, queueMail, sendInput } from '@/lib/mailbox';

/** V21 [보내기] = 보관함에 "보내는 중"으로 저장하고 바로 응답 → 응답 뒤 발송(서울 지역). 실패하면 정기 실행이 재시도 */
export const preferredRegion = 'icn1';
export const maxDuration = 60;
export const POST = handler(async ({ req, user }) => {
  const out = await queueMail(user, await body(req, sendInput), clientIp(req));
  after(() => processOutbox(out.id).catch(() => {}));
  return out;
}, { idempotent: true });
