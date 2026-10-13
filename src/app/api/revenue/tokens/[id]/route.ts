import { handler, clientIp } from '@/lib/api';
import { revokeToken } from '@/lib/revenue';

export const DELETE = handler<{ id: string }>(async ({ req, user, params }) => {
  await revokeToken(user, params.id, clientIp(req));
  return { ok: true };
});
