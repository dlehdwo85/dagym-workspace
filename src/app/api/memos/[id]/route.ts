import { handler, body, clientIp } from '@/lib/api';
import { deleteMemo, getMemo, memoUpdateInput, updateMemo } from '@/lib/memos';

/** #1135 메모 한 건(볼 사람 포함, 아이디·비밀번호 없음) · 고치기 · 지우기(휴지통 30일) */
export const GET = handler<{ id: string }>(async ({ user, params }) => getMemo(user, params.id));
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => updateMemo(user, params.id, await body(req, memoUpdateInput), clientIp(req)));
export const DELETE = handler<{ id: string }>(async ({ req, user, params }) => deleteMemo(user, params.id, clientIp(req)));
