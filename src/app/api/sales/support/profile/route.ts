import { handler, body } from '@/lib/api';
import { getProfile, profileInput, saveProfile } from '@/lib/sales/support';

/** #450 회사 지원사업 프로필(본점 시·군·설립일·규모·근로자 수·업종·인증·브랜드·관심 분야) — 고치기는 관리자 */
export const GET = handler(async ({ user }) => getProfile(user));
export const PUT = handler(async ({ req, user }) => saveProfile(user, await body(req, profileInput)));
