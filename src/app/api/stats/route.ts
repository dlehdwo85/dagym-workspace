import { handler } from '@/lib/api';
import { achievement } from '@/lib/stats';

export const GET = handler(async ({ req, user }) => achievement(user, req.nextUrl.searchParams.get('period') === 'month' ? 'month' : 'week'));
