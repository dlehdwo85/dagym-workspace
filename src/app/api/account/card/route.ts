import { handler, body, clientIp } from '@/lib/api';
import { myCard, myCardInput, saveMyCard } from '@/lib/mailbox';

/** V32 6 내 명함(직급·휴대폰)·회신 주소(업무 이메일) */
export const GET = handler(async ({ user }) => myCard(user));
export const PUT = handler(async ({ req, user }) => saveMyCard(user, await body(req, myCardInput), clientIp(req)));
