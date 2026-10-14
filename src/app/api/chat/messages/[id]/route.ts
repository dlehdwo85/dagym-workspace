import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { deleteMessage, editMessage } from '@/lib/chat';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => editMessage(user, params.id, (await body(req, z.object({ body: z.string().min(1).max(5000) }))).body));
export const DELETE = handler<{ id: string }>(async ({ user, params }) => deleteMessage(user, params.id));
