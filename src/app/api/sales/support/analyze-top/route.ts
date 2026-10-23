import { handler } from '@/lib/api';
import { analyzeTop } from '@/lib/sales/support';

/** #450 맞춤 순 위에서 아직 판단 안 한 공고 최대 5건 AI 판단(관리자) */
export const POST = handler(async ({ user }) => analyzeTop(user));
