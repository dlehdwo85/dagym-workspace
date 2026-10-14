import { handler, body } from '@/lib/api';
import { chat, chatInput } from '@/lib/ai/assistant';

export const maxDuration = 300;
export const POST = handler(async ({ req, user }) => chat(user, await body(req, chatInput), undefined, req.signal)); // 부록 A2: 화면이 요청을 끊으면 함께 멈춤
