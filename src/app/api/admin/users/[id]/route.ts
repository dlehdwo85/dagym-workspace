import { handler, body, clientIp } from '@/lib/api';
import { updateUser, userPatch } from '@/lib/admin';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => {
  return updateUser(user, params.id, await body(req, userPatch), clientIp(req));
});
