import { after } from 'next/server';
import { handler } from '@/lib/api';
import { widgetDone } from '@/lib/widget';
import { dispatchPending } from '@/lib/push';

/** 위젯 체크 → 완료(검토 필요면 검토 요청), 다시 누르면 진행 중 */
export const POST = handler<{ id: string }>(async ({ user, params }) => {
  const out = await widgetDone(user, params.id);
  after(() => dispatchPending().catch(() => {}));
  return out;
}, { idempotent: true });
