import { handler } from '@/lib/api';
import { setTyping } from '@/lib/chat';

export const POST = handler<{ id: string }>(async ({ user, params }) => setTyping(user, params.id));
