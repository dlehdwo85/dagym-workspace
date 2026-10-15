import { handler, body, clientIp } from '@/lib/api';
import { overrideInput, setLimitOverrides } from '@/lib/platformAdmin';

/** V28-3 인원·저장·AI 한도 개별 조정(크레딧 지급 = AI 한도 올림) */
export const PUT = handler<{ tenant: string }>(async ({ req, user, params }) => setLimitOverrides(user, params.tenant, await body(req, overrideInput), clientIp(req)));
