import { handler } from '@/lib/api';
import { restoreTask } from '@/lib/tasks';

export const POST = handler<{ id: string }>(async ({ user, params }) => restoreTask(user, params.id));
