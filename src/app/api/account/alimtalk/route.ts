import { handler, body, clientIp } from '@/lib/api';
import { myAlimtalk, myAlimtalkInput, saveMyAlimtalk } from '@/lib/alimtalk';

/** 304차 #871 결제·약관 안내 카카오 알림톡 — 관리자 본인 휴대폰·동의 */
export const GET = handler(async ({ user }) => myAlimtalk(user));
export const PUT = handler(async ({ req, user }) => saveMyAlimtalk(user, await body(req, myAlimtalkInput), clientIp(req)));
