import { handler } from '@/lib/api';
import { getQuote } from '@/lib/quotes';

export const GET = handler<{ id: string }>(async ({ user, params }) => getQuote(user, params.id));
