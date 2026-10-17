import { handler } from '@/lib/api';
import { syncNow } from '@/lib/marketingAds';

export const POST = handler(async ({ user }) => syncNow(user));
