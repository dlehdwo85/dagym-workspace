import { handler, body } from '@/lib/api';
import { finishInput, finishRound } from '@/lib/check/rounds';

/** 점검 끝내기: 보완 필요 건마다 보완 요청(업무 1건) · 외부 연락 기록 · 같은 항목 3회 연속이면 개선 과제 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => finishRound(user, params.id, await body(req, finishInput)), { idempotent: true });
