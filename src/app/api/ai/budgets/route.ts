import { handler } from '@/lib/api';
import { aiBudgetsOverview } from '@/lib/ai/budgets';

/** V23 4장: 사람별 AI 사용액·남은 한도·추가 요청·비싼 요청 (대표·관리자) */
export const GET = handler(async ({ user }) => aiBudgetsOverview(user));
