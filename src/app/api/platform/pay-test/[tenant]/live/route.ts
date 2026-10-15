import { handler, body, clientIp } from '@/lib/api';
import { liveSmokeInput, platformLiveSmoke } from '@/lib/billing';

/** V36 8 실결제 소액 시험(100원·운영자·시험 회사·하루 3회·1시간 뒤 자동 취소) */
export const POST = handler<{ tenant: string }>(async ({ req, user, params }) => platformLiveSmoke(user, params.tenant, await body(req, liveSmokeInput), req.nextUrl.origin, clientIp(req)));
