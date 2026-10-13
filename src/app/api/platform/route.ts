import { handler } from '@/lib/api';
import { platformOverview } from '@/lib/plans';

export const GET = handler(async ({ user }) => platformOverview(user));
