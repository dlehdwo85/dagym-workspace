import { after } from 'next/server';
import { handler, body, clientIp } from '@/lib/api';
import { actionInput, performAction } from '@/lib/notifActions';
import { dispatchPending } from '@/lib/push';

/** 로컬 10/20 알림에서 바로 처리: {action, text?} — 승인/수정 요청·연장 승인/거절·답글/확인·배정 확인/오늘 할 일·일정 10분 뒤 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const out = await performAction(user, params.id, await body(req, actionInput), clientIp(req));
  after(() => dispatchPending().catch(() => {}));
  return out;
}, { idempotent: true });
