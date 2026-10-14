import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { setTenantStatus } from '@/lib/plans';

export const PUT = handler<{ tenant: string }>(async ({ req, user, params }) => setTenantStatus(user, params.tenant, (await body(req, z.object({ status: z.enum(['active', 'blocked']) }))).status));
