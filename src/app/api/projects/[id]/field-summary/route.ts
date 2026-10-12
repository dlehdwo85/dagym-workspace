import { handler } from '@/lib/api';
import { fieldSummary } from '@/lib/fields';

export const GET = handler<{ id: string }>(async ({ user, params }) => ({ summary: await fieldSummary(user, params.id) }));
