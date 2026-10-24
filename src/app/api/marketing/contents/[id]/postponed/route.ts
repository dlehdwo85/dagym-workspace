import { handler } from '@/lib/api';
import { postponedAction, postponedInput } from '@/lib/mktAuto';

/** 로컬 10/24 09:00 '미뤄진 글': [날짜 골라 다시 올리기] { action: 'reschedule', date, time } · [버리기] { action: 'discard' } */
export const POST = handler<{ id: string }>(async ({ user, params, req }) => postponedAction(user, params.id, postponedInput.parse(await req.json().catch(() => ({})))));
