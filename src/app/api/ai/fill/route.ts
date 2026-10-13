import { handler, body } from '@/lib/api';
import { fillFromFiles, fillInput } from '@/lib/ai/assistant';

export const maxDuration = 120;
export const POST = handler(async ({ req, user }) => fillFromFiles(user, await body(req, fillInput)));
