import { handler, body } from '@/lib/api';
import { confirmFollowup, confirmInput } from '@/lib/check/rounds';

/** 보완 확인: { ok: true } = 양호 확인(닫힘) · { ok: false, note } = 다시 보완(같은 업무를 다시 엶) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => confirmFollowup(user, params.id, await body(req, confirmInput)));
