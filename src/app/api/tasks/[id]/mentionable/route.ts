import { handler } from '@/lib/api';
import { mentionableUsers } from '@/lib/tasks';

export const GET = handler<{ id: string }>(async ({ user, params }) => ({ users: await mentionableUsers(user, params.id) }));
