import { handler } from '@/lib/api';
import { listUploads } from '@/lib/billing/settlement';

export const GET = handler(async ({ user }) => listUploads(user));
