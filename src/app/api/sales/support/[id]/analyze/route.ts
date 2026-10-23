import { handler } from '@/lib/api';
import { analyzeProgram } from '@/lib/sales/support';

/** #450 AI 세일즈 판단 — 해당 여부(✅/⚠/❌)·이유·맞는 브랜드·준비 서류·요약(회사 AI 한도에서) */
export const POST = handler<{ id: string }>(async ({ user, params }) => analyzeProgram(user, params.id));
