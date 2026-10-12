import { handler, body, clientIp } from '@/lib/api';
import { orgUnitInput, updateOrgUnit } from '@/lib/admin';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) =>
  updateOrgUnit(user, params.id, await body(req, orgUnitInput.partial()), clientIp(req)));
