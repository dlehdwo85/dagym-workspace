import { after } from 'next/server';
import { handler, body } from '@/lib/api';
import { phoneInquiryInput, registerPhoneInquiry, summarizeInquiry } from '@/lib/inquiries';
import { dispatchPending } from '@/lib/push';

/** V21 대표번호 전화 문의 등록 → 업무(문의 단계·담당·알림 웹사이트 문의와 같게) */
export const POST = handler(async ({ req, user }) => {
  const out = await registerPhoneInquiry(user, await body(req, phoneInquiryInput));
  after(() => summarizeInquiry(out.taskIds, user.id).catch(() => {}));
  after(() => dispatchPending().catch(() => {}));
  return out;
}, { idempotent: true });
