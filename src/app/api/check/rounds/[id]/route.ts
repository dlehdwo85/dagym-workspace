import { handler, clientIp } from '@/lib/api';
import { deleteRound, getRound } from '@/lib/check/rounds';

/** 점검 화면: 코스 순서대로 항목(확인 방법·양호 기준·기준 사진·놓치기 쉬운 곳) + 지금까지 적은 결과 */
export const GET = handler<{ id: string }>(async ({ user, params }) => getRound(user, params.id));
/** D-01(대표 11/23): 점검 회차 지우기 — 대표·관리자만, 휴지통 기록 30일 */
export const DELETE = handler<{ id: string }>(async ({ req, user, params }) => deleteRound(user, params.id, clientIp(req)));
