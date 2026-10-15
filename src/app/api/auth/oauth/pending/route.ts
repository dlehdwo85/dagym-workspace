import { handler } from '@/lib/api';
import { pendingInfo } from '@/lib/oauth';

/** 소셜 확인 후 회사 만들기 화면: 이메일·이름·제공자 */
export const GET = handler(async ({ req }) => pendingInfo(req.nextUrl.searchParams.get('t') ?? ''), { public: true });
