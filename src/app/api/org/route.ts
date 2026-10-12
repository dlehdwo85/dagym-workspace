import { handler } from '@/lib/api';
import { directory } from '@/lib/admin';

export const GET = handler(async ({ user }) => directory(user));
