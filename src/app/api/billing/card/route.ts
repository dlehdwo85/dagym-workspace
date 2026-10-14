import { body, clientIp, handler } from '@/lib/api';
import { cardInput, registerCard } from '@/lib/billing';

/** 카드 등록(빌키 발급). 카드번호는 저장하지 않는다 */
export const POST = handler(async ({ req, user }) => registerCard(user, await body(req, cardInput), clientIp(req)));
