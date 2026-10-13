import { handler } from '@/lib/api';
import { allTickets } from '@/lib/support';

export const GET = handler(async ({ user }) => allTickets(user));
