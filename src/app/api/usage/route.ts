import { handler } from '@/lib/api';
import { usageOverview } from '@/lib/plans';

export const GET = handler(async ({ user }) => usageOverview(user));
