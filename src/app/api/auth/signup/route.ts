import { handler, body, clientIp } from '@/lib/api';
import { signup, signupEnabled, signupInput } from '@/lib/signup';
import { conversionTags } from '@/lib/conversionTags';

/** 가입 화면이 열려 있는지 (PUBLIC_SIGNUP=1) + #449 가입 전환 태그 ID(공개 측정 ID — 플랫폼 운영에서 넣은 값 > 빌드 환경변수) */
export const GET = handler(async () => ({ enabled: signupEnabled(), tags: await conversionTags() }), { public: true });
export const POST = handler(async ({ req }) => signup(await body(req, signupInput), clientIp(req)), { public: true });
