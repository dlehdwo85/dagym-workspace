import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { pinMessage } from '@/lib/chat';

export const POST = handler<{ id: string }>(async ({ req, user, params }) => pinMessage(user, params.id, (await body(req, z.object({ pin: z.boolean() }))).pin));
