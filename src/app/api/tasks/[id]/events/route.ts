import { handler } from '@/lib/api';
import { linkedEvents } from '@/lib/eventtasks';

export const GET = handler<{ id: string }>(async ({ user, params }) => ({ events: await linkedEvents(user, params.id) }));
