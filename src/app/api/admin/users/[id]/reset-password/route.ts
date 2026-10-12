import { handler, clientIp } from '@/lib/api';
import { createPasswordReset } from '@/lib/admin';

export const POST = handler<{ id: string }>(async ({ req, user, params }) => createPasswordReset(user, params.id, clientIp(req)));
