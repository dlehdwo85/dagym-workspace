import { handler, body } from '@/lib/api';
import { chat, chatInput } from '@/lib/ai/assistant';

export const maxDuration = 300;
export const POST = handler(async ({ req, user }) => chat(user, await body(req, chatInput)));
