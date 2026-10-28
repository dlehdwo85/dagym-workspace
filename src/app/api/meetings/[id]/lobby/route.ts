import { body, handler } from '@/lib/api';
import { lobby, lobbyAction, lobbyInput } from '@/lib/meetings';

/** 대기실(주최자·공동 주최자): 목록 · 허락·거절·모두 허락 */
export const GET = handler<{ id: string }>(async ({ user, params }) => lobby(user, params.id));
export const POST = handler<{ id: string }>(async ({ req, user, params }) => lobbyAction(user, params.id, await body(req, lobbyInput)));
