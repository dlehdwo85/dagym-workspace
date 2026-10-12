import { handler } from '@/lib/api';
import { quickSearch } from '@/lib/search';

export const GET = handler(async ({ req, user }) => quickSearch(user, (req.nextUrl.searchParams.get('q') ?? '').slice(0, 100)));
