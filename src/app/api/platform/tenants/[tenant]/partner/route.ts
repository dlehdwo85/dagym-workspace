import { handler, body, clientIp } from '@/lib/api';
import { partnerSetInput, setTenantPartner } from '@/lib/platformAdmin';

/** #1139 2부: 회사 상세 [설계 파트너로 지정] — PUT {days}(플랫폼 운영자만, 감사 기록) */
export const PUT = handler<{ tenant: string }>(async ({ req, user, params }) => setTenantPartner(user, params.tenant, await body(req, partnerSetInput), clientIp(req)));
