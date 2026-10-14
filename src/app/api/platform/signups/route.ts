import { handler } from '@/lib/api';
import { platformSignups } from '@/lib/plans';

export const GET = handler(async ({ user }) => platformSignups(user));
