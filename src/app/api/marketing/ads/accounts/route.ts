import { handler, body } from '@/lib/api';
import { connectNaver, naverInput } from '@/lib/marketingAds';

/** 네이버 검색광고 API 라이선스 연결(관리자) — 비밀값은 암호화 보관, 다시 보여 주지 않음 */
export const POST = handler(async ({ req, user }) => connectNaver(user, await body(req, naverInput)));
