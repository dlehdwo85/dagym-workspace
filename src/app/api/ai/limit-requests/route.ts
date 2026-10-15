import { handler, body } from '@/lib/api';
import { limitRequestInput, myAiRequests, requestMoreAi } from '@/lib/ai/budgets';

/** V23 4장: 내 AI 한도 추가 요청 */
export const GET = handler(async ({ user }) => myAiRequests(user));
export const POST = handler(async ({ req, user }) => requestMoreAi(user, await body(req, limitRequestInput)));
