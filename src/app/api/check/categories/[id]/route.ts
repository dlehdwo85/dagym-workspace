import { handler, body } from '@/lib/api';
import { categoryInput, removeCategory, saveCategory } from '@/lib/check/guide';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => saveCategory(user, params.id, await body(req, categoryInput)));
/** 쓰는 항목이 있으면 지우지 않고 '안 씀'으로 */
export const DELETE = handler<{ id: string }>(async ({ user, params }) => removeCategory(user, params.id));
