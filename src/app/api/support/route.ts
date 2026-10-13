import { handler, body } from '@/lib/api';
import { createTicket, myTickets, ticketInput } from '@/lib/support';

export const GET = handler(async ({ user }) => myTickets(user));
export const POST = handler(async ({ req, user }) => createTicket(user, await body(req, ticketInput)), { idempotent: true });
