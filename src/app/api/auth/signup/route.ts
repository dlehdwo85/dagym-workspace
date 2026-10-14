import { handler, body, clientIp } from '@/lib/api';
import { signup, signupEnabled, signupInput } from '@/lib/signup';

/** 가입 화면이 열려 있는지 (PUBLIC_SIGNUP=1) */
export const GET = handler(async () => ({ enabled: signupEnabled() }), { public: true });
export const POST = handler(async ({ req }) => signup(await body(req, signupInput), clientIp(req)), { public: true });
