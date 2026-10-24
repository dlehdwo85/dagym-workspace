import { handler, body, clientIp } from '@/lib/api';
import { setTenantWriteTier, tenantWriteInput } from '@/lib/mktPlans';

/** 대표 10/24 추가 ①: 회사별 마케팅 자동 제작 글 모델 — PUT {tier: fast|default|deep|null(요금제 값)} */
export const PUT = handler<{ tenant: string }>(async ({ req, user, params }) => setTenantWriteTier(user, params.tenant, await body(req, tenantWriteInput), clientIp(req)));
