import { handler } from '@/lib/api';
import { searchMessages } from '@/lib/chat';

export const GET = handler(async ({ req, user }) => searchMessages(user, (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 100) || '\u0000'));
