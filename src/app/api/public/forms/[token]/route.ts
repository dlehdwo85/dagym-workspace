import { after } from 'next/server';
import { handler, body, clientIp } from '@/lib/api';
import { publicForm, submitForm, submitInput } from '@/lib/forms';
import { dispatchPending } from '@/lib/push';

/** 로그인 없이 쓰는 현장 신고 양식. 로그인한 직원이면 신고자 정보를 계정으로 채운다 */
export const GET = handler<{ token: string }>(async ({ params }) => publicForm(params.token), { public: true });
export const POST = handler<{ token: string }>(async ({ req, user, params }) => {
  const out = await submitForm(params.token, await body(req, submitInput), clientIp(req), user);
  after(() => dispatchPending().catch(() => {}));
  return out;
}, { public: true });
