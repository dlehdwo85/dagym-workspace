import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { createToken, listTokens } from '@/lib/revenue';

/** GPT Custom Action 용 쓰기 전용 토큰 (매출 입력만). 원문은 만들 때 한 번만 돌려준다 */
export const GET = handler(async ({ user }) => ({ tokens: await listTokens(user) }));
export const POST = handler(async ({ req, user }) => {
  const i = await body(req, z.object({ name: z.string().trim().min(1).max(60) }));
  return createToken(user, i.name, clientIp(req));
});
