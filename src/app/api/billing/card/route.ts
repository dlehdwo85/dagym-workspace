import { body, clientIp, handler } from '@/lib/api';
import { cardInput, registerCard, removeCard } from '@/lib/billing';

/** 카드 등록(빌키 발급). 카드번호는 저장하지 않는다 */
export const POST = handler(async ({ req, user }) => registerCard(user, await body(req, cardInput), clientIp(req)));
/** #1158 등록 카드 삭제 — 자동 결제 중이면 409(해지 예약 먼저) */
export const DELETE = handler(async ({ req, user }) => removeCard(user, clientIp(req)));
