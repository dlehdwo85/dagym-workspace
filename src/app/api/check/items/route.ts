import { handler, body } from '@/lib/api';
import { createItem, itemInput, listItems } from '@/lib/check/guide';

/** 점검 항목 — ?category= &placeType= &unit= &q= &all=1(안 쓰는 항목 포함) */
export const GET = handler(async ({ req, user }) => {
  const q = req.nextUrl.searchParams;
  return listItems(user, { categoryId: q.get('category'), placeTypeId: q.get('placeType'), unitId: q.get('unit'), q: q.get('q'), all: q.get('all') === '1' });
});
export const POST = handler(async ({ req, user }) => createItem(user, await body(req, itemInput)));
