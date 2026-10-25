import { handler, body, clientIp } from '@/lib/api';
import { setTenantProfile, tenantProfileInput } from '@/lib/platformAdmin';

/** #656 고객사 담당자(이름·연락처·직책)·구분(설계 파트너/일반)·소개 경로 — 플랫폼 운영자만 */
export const PUT = handler<{ tenant: string }>(async ({ req, user, params }) => setTenantProfile(user, params.tenant, await body(req, tenantProfileInput), clientIp(req)));
