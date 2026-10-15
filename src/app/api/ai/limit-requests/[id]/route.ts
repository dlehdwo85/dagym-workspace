import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { decideAiRequest } from '@/lib/ai/budgets';

/** 대표: AI 한도 추가 요청 승인·거절 */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => decideAiRequest(user, params.id, (await body(req, z.object({ approve: z.boolean() }))).approve, clientIp(req)));
