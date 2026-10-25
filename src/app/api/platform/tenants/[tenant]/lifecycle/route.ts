import { handler, body, clientIp } from '@/lib/api';
import { lifecycleInput, setTenantLifecycle } from '@/lib/platformAdmin';

/** #656 고객사 단계(체험/유료/보류/해지) 직접 정하기 — stage null 이면 구독 상태에서 자동 */
export const PUT = handler<{ tenant: string }>(async ({ req, user, params }) => setTenantLifecycle(user, params.tenant, await body(req, lifecycleInput), clientIp(req)));
