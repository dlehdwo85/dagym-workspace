import { handler, body, clientIp } from '@/lib/api';
import { marketingInput, marketingState, setMarketing } from '@/lib/marketingConsent';

/** 360차(대표 #976 정보통신망법 제50조): 내 광고성 정보 수신 동의 — 보기·켜기/끄기(바꾸면 처리 결과 메일) */
export const GET = handler(async ({ user }) => marketingState(user.id));
export const PUT = handler(async ({ req, user }) => setMarketing(user, await body(req, marketingInput), clientIp(req)));
