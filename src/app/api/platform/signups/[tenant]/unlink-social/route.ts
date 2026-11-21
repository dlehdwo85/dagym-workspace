import { handler } from '@/lib/api';
import { unlinkRejectedSocial } from '@/lib/signupApproval';

/** 로컬 11/21 #1095: 거절된 가입 회사의 소셜 로그인 연결 풀기(플랫폼 운영자만, 다른 사람 404) — 애플은 토큰 해지까지 */
export const POST = handler<{ tenant: string }>(async ({ user, params }) => unlinkRejectedSocial(user, params.tenant));
