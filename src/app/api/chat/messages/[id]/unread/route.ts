import { handler } from '@/lib/api';
import { unreadNames } from '@/lib/chat';

/** 메신저 1차 B7: 안 읽은 사람 이름 */
export const GET = handler<{ id: string }>(async ({ user, params }) => unreadNames(user, params.id));
