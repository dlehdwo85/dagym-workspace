import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { resendVerification } from '@/lib/signup';

export const POST = handler(async ({ req }) => {
  const i = await body(req, z.object({ email: z.string().trim().toLowerCase().email() }));
  return resendVerification(i.email, clientIp(req));
}, { public: true });
