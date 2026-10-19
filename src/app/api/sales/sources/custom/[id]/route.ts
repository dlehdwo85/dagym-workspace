import { handler } from '@/lib/api';
import { removeCustomSource } from '@/lib/sales/sources';

export const DELETE = handler<{ id: string }>(async ({ user, params }) => removeCustomSource(user, params.id));
