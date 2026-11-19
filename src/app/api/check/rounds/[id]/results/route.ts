import { handler, body } from '@/lib/api';
import { resultInput, saveResult } from '@/lib/check/rounds';

/** 항목 하나의 결과(양호·보완 필요·해당 없음 + 메모) — 다시 보내면 고침 */
export const PUT = handler<{ id: string }>(async ({ req, user, params }) => saveResult(user, params.id, await body(req, resultInput)));
