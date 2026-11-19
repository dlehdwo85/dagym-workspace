import { handler, body } from '@/lib/api';
import { roundInput, startRound } from '@/lib/check/rounds';

/** 점검 시작 — 코스를 고르면 정기(또는 표본), 코스 없이 시작하면 수시 점검 */
export const POST = handler(async ({ req, user }) => startRound(user, await body(req, roundInput)));
