import { handler } from '@/lib/api';
import { getReport } from '@/lib/insights';

export const GET = handler<{ id: string }>(async ({ user, params }) => ({ report: await getReport(user, params.id) }));
