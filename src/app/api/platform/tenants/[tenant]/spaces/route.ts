import { handler, body, clientIp } from '@/lib/api';
import { setTenantSpacesByPlatform, tenantSpacesInput } from '@/lib/platformAdmin';

/** 플랫폼 운영: 고객사 공간(영업·마케팅) */
export const PUT = handler<{ tenant: string }>(async ({ req, user, params }) => setTenantSpacesByPlatform(user, params.tenant, await body(req, tenantSpacesInput), clientIp(req)));
