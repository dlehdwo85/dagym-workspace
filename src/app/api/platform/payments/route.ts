import { handler } from '@/lib/api';
import { platformPayments } from '@/lib/billing';

export const GET = handler(async ({ user }) => platformPayments(user));
