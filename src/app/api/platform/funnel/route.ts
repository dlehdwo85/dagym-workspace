import { handler } from '@/lib/api';
import { platformFunnel } from '@/lib/funnel';

export const GET = handler(async ({ user, req }) => platformFunnel(user, Number(req.nextUrl.searchParams.get('weeks') ?? 8)));
