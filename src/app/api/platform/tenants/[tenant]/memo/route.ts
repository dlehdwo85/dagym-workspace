import { handler, body, clientIp } from '@/lib/api';
import { setTenantMemo, tenantMemoInput } from '@/lib/platformAdmin';

/** 플랫폼 운영: 고객사 메모(운영자만 봄) */
export const PUT = handler<{ tenant: string }>(async ({ req, user, params }) => setTenantMemo(user, params.tenant, await body(req, tenantMemoInput), clientIp(req)));
