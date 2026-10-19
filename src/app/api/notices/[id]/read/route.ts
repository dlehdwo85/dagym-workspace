import { handler } from '@/lib/api';
import { markRead } from '@/lib/announcements';

export const POST = handler<{ id: string }>(async ({ user, params }) => markRead(user, params.id));
