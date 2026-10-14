import { handler, body } from '@/lib/api';
import { deleteThread, getThread, patchThread, threadPatch } from '@/lib/ai/threads';

export const GET = handler<{ id: string }>(async ({ user, params }) => getThread(user, params.id));
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => patchThread(user, params.id, await body(req, threadPatch)));
export const DELETE = handler<{ id: string }>(async ({ user, params }) => deleteThread(user, params.id));
