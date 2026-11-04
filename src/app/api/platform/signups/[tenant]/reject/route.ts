import { handler, body } from '@/lib/api';
import { rejectInput, rejectSignup } from '@/lib/signupApproval';

/** 359차 승인제 가입 [거절](사유): 안내 메일 · 로그인하면 거절 안내만 (플랫폼 운영자만, 다른 사람 404) */
export const POST = handler<{ tenant: string }>(async ({ req, user, params }) => rejectSignup(user, params.tenant, await body(req, rejectInput)));
