import { handler } from '@/lib/api';
import { aiStatus } from '@/lib/ai/assistant';

export const GET = handler(async ({ user }) => aiStatus(user));
