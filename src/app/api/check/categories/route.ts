import { handler, body } from '@/lib/api';
import { categoryInput, listCategories, saveCategory } from '@/lib/check/guide';

/** 점검 분야(2단계) — 보기: check_guide 보기 · 만들기: 편집 */
export const GET = handler(async ({ user }) => listCategories(user));
export const POST = handler(async ({ req, user }) => saveCategory(user, null, await body(req, categoryInput)));
