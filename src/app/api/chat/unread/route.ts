import { handler } from '@/lib/api';
import { unreadTotal } from '@/lib/chat';

export const GET = handler(async ({ user }) => ({ unread: await unreadTotal(user) }));
