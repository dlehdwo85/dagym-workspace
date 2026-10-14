import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { markRead } from '@/lib/chat';

export const POST = handler<{ id: string }>(async ({ req, user, params }) => markRead(user, params.id, (await body(req, z.object({ upTo: z.string().regex(/^\d+$/).optional() }))).upTo));
