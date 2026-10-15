import { handler, body, clientIp } from '@/lib/api';
import { setUserAiLimit, userLimitInput } from '@/lib/ai/budgets';

/** 대표: 사람별 월 AI 한도(원) */
export const PUT = handler(async ({ req, user }) => setUserAiLimit(user, await body(req, userLimitInput), clientIp(req)));
