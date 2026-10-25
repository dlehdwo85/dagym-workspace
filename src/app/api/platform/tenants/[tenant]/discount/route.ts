import { handler, body, clientIp } from '@/lib/api';
import { discountInput, setTenantDiscount } from '@/lib/platformAdmin';

/** #656 회사별 할인(%·기한·사유) — 다음 정기 결제 견적부터 적용 */
export const PUT = handler<{ tenant: string }>(async ({ req, user, params }) => setTenantDiscount(user, params.tenant, await body(req, discountInput), clientIp(req)));
