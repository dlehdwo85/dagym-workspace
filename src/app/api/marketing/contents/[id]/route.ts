import { handler } from '@/lib/api';
import { getContent } from '@/lib/marketing';

export const GET = handler<{ id: string }>(async ({ user, params }) => getContent(user, params.id));
