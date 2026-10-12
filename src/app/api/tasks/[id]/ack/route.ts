import { handler } from '@/lib/api';
import { ackTask } from '@/lib/tasks';

export const POST = handler<{ id: string }>(async ({ user, params }) => ackTask(user, params.id));
