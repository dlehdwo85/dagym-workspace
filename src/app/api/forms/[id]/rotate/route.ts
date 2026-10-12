import { handler } from '@/lib/api';
import { rotateToken } from '@/lib/forms';

export const POST = handler<{ id: string }>(async ({ user, params }) => rotateToken(user, params.id));
