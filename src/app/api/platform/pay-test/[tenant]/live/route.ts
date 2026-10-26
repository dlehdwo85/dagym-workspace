import { handler, body, clientIp } from '@/lib/api';
import { liveSmokeInput, platformLiveSmoke } from '@/lib/billing';
import { ensureTester, settleTester } from '@/lib/billing/payTest';

/** V36 8 실결제 소액 시험(100원·운영자·시험 회사·하루 3회·1시간 뒤 자동 취소) · 192차 tenant = 'tester' 면 고정 시험 회사 */
export const POST = handler<{ tenant: string }>(async ({ req, user, params }) => {
  const i = await body(req, liveSmokeInput);
  let tenant = params.tenant;
  if (tenant === 'tester') { tenant = await ensureTester(user, clientIp(req)); await settleTester(user, tenant, clientIp(req)); }
  return platformLiveSmoke(user, tenant, i, req.nextUrl.origin, clientIp(req));
});
