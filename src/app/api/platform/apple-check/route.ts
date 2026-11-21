import { handler } from '@/lib/api';
import { appleSelfCheckFor } from '@/lib/oauth';

/** 로컬 11/21 #1094: 애플 로그인 설정 자가 점검(플랫폼 운영자만 — 그 밖은 404). 가짜 코드로 토큰 주소를 불러 invalid_grant(정상)·invalid_client(설정 문제)를 가린다. 실제 로그인·계정은 건드리지 않음 */
export const GET = handler(async ({ user }) => appleSelfCheckFor(user));
