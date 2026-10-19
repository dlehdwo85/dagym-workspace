import { handler, clientIp } from '@/lib/api';
import { remindUnread } from '@/lib/announcements';

/** 안 읽은 사람에게 다시 알림(하루 1번) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => remindUnread(user, params.id, clientIp(req)), { idempotent: true });
