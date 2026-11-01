import { handler, body } from '@/lib/api';
import { alimtalkPlatform, alimtalkTest, alimtalkTestInput } from '@/lib/alimtalk';

/** 304차 #871 알림톡 운영 상태(비밀값 없음) · 운영자 본인 휴대폰으로 시험 발송 — 플랫폼 운영자만(그 밖에는 404) */
export const GET = handler(async ({ user }) => alimtalkPlatform(user));
export const POST = handler(async ({ req, user }) => alimtalkTest(user, await body(req, alimtalkTestInput)));
