import { handler, body, clientIp } from '@/lib/api';
import { bidAlertOptions, subscribe, subscribeInput } from '@/lib/bidAlerts';

/** #949 입찰 공고 아침 메일 무료 구독 — 로그인 없이 이메일·관심 지역·관심 분야만(GET = 선택지, POST = 신청) */
export const GET = handler(async () => bidAlertOptions(), { public: true });
export const POST = handler(async ({ req }) => subscribe(await body(req, subscribeInput), clientIp(req)), { public: true });
