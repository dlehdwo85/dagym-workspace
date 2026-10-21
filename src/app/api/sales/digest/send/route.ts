import { handler } from '@/lib/api';
import { sendDigestManual } from '@/lib/sales/digest';

export const maxDuration = 60;
/** [지금 보내기](관리자) — 오늘 다이제스트를 다시 만들어 메일·알림 */
export const POST = handler(async ({ user }) => sendDigestManual(user));
