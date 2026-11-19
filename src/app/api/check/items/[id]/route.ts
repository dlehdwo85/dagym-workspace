import { handler, body } from '@/lib/api';
import { getItem, itemInput, updateItem } from '@/lib/check/guide';

/** 항목 한 건 + 개정 이력 */
export const GET = handler<{ id: string }>(async ({ user, params }) => getItem(user, params.id));
/** 내용이 바뀌면 판이 올라가고 개정 이력에 까닭(reason)과 함께 남음 */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => updateItem(user, params.id, await body(req, itemInput.partial())));
