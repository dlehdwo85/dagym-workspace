import { handler, body, clientIp } from '@/lib/api';
import { mktBillInput, setMarketingBilling } from '@/lib/spaceConsult';

/** 상용화 A4: 회사 상세 '마케팅 요금제(결제에 합침)' — PUT {planCode | null}(플랫폼 운영자만, 감사 기록) */
export const PUT = handler<{ tenant: string }>(async ({ req, user, params }) => setMarketingBilling(user, params.tenant, await body(req, mktBillInput), clientIp(req)));
