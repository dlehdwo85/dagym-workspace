import { handler, body, clientIp } from '@/lib/api';
import { platformTestWindow, windowInput } from '@/lib/billing';
import { ensureTester, settleTester } from '@/lib/billing/payTest';

/** V32 1 이 시험 회사로 결제창(시험 상점 강제) · 192차 tenant = 'tester' 면 고정 시험 회사(처음이면 만듦) — 남은 승인 결제를 먼저 취소 */
export const POST = handler<{ tenant: string }>(async ({ req, user, params }) => {
  const i = await body(req, windowInput);
  let tenant = params.tenant;
  if (tenant === 'tester') { tenant = await ensureTester(user, clientIp(req)); await settleTester(user, tenant, clientIp(req)); }
  return platformTestWindow(user, tenant, i, req.nextUrl.origin);
});
