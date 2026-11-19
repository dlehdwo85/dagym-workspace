import { body, handler } from '@/lib/api';
import { chatInput, listChat, sendChat } from '@/lib/meetings';

/** 회의 중 채팅(직원) — ?after=<마지막으로 받은 글 번호> */
export const GET = handler<{ id: string }>(async ({ req, user, params }) => listChat(user, params.id, req.nextUrl.searchParams.get('after')));
export const POST = handler<{ id: string }>(async ({ req, user, params }) => sendChat(user, params.id, await body(req, chatInput)));
