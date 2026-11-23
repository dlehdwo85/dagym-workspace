import { handler, body, clientIp } from '@/lib/api';
import { setTenantTestMark, testMarkInput } from '@/lib/platformAdmin';

/** D-08 플랫폼 운영 › 회사 상세 [검수용 시험 회사로 표시] — PUT {on}(플랫폼 운영자만, 감사 기록) */
export const PUT = handler<{ tenant: string }>(async ({ req, user, params }) => setTenantTestMark(user, params.tenant, await body(req, testMarkInput), clientIp(req)));
