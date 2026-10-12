import { handler } from '@/lib/api';
import { unlinkTask } from '@/lib/eventtasks';

export const DELETE = handler<{ id: string; taskId: string }>(async ({ user, params }) => unlinkTask(user, params.id, params.taskId));
