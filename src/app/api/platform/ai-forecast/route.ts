import { handler, body } from '@/lib/api';
import { aiForecast, financeInput, setFinance } from '@/lib/ai/forecast';

/** V23 5장: 플랫폼 운영자 AI 원가 전망 (운영자만, 그 밖엔 404) */
export const GET = handler(async ({ user }) => aiForecast(user));
export const PUT = handler(async ({ req, user }) => setFinance(user, await body(req, financeInput)));
