import { handler } from '@/lib/api';
import { approveSignup } from '@/lib/signupApproval';

/** 359차 승인제 가입 [승인]: 14일 체험 시작 = 지금 · 환영 메일 (플랫폼 운영자만, 다른 사람 404) */
export const POST = handler<{ tenant: string }>(async ({ user, params }) => approveSignup(user, params.tenant));
