import { handler, body } from '@/lib/api';
import { messageInput, sendMessage } from '@/lib/chat';

export const POST = handler<{ id: string }>(async ({ req, user, params }) => sendMessage(user, params.id, await body(req, messageInput)), { idempotent: true });
