import { handler, body, clientIp } from '@/lib/api';
import { endAgreement, endInput } from '@/lib/agreements';

/** 종료(까닭과 함께) — 목록의 '종료'로 옮겨지고 알림이 멈춤 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => endAgreement(user, params.id, await body(req, endInput), clientIp(req)));
