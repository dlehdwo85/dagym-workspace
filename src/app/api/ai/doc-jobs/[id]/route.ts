import { handler } from '@/lib/api';
import { getDocJob } from '@/lib/ai/docJobs';

export const GET = handler<{ id: string }>(async ({ user, params }) => getDocJob(user, params.id));
