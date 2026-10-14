import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { addMembers } from '@/lib/chat';

export const POST = handler<{ id: string }>(async ({ req, user, params }) => addMembers(user, params.id, (await body(req, z.object({ userIds: z.array(z.string().uuid()).min(1).max(100) }))).userIds));
