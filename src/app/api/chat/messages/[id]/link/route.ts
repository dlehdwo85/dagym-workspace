import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { linkTask } from '@/lib/chat';

export const POST = handler<{ id: string }>(async ({ req, user, params }) => linkTask(user, params.id, (await body(req, z.object({ taskId: z.string().uuid() }))).taskId));
