import { handler } from '@/lib/api';
import { inquiryAdmin } from '@/lib/inquiries';

export const GET = handler(async ({ user }) => inquiryAdmin(user));
