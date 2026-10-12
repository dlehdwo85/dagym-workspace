import { handler } from '@/lib/api';
import { workload } from '@/lib/insights';

export const GET = handler(async ({ user, req }) => workload(user, req.nextUrl.searchParams.get('week') ?? undefined));
