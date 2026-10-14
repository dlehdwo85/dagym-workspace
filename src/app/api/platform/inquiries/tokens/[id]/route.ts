import { handler, zUuid } from '@/lib/api';
import { revokeToken } from '@/lib/inquiries';

export const DELETE = handler<{ id: string }>(async ({ user, params }) => revokeToken(user, zUuid.parse(params.id)));
