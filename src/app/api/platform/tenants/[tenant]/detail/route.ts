import { handler } from '@/lib/api';
import { tenantAdminDetail } from '@/lib/platformAdmin';

export const GET = handler<{ tenant: string }>(async ({ user, params }) => tenantAdminDetail(user, params.tenant));
