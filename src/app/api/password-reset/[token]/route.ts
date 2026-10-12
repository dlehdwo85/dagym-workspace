import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { usePasswordReset } from '@/lib/admin';

export const POST = handler<{ token: string }>(async ({ req, params }) => {
  const { password } = await body(req, z.object({ password: z.string().min(8).max(200) }));
  return usePasswordReset(params.token, password);
}, { public: true });
