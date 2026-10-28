import { handler, body } from '@/lib/api';
import { brandMergeInput, mergeBrand } from '@/lib/mktBrandMerge';

/** #754 브랜드 합치기 — 이 브랜드(id)를 into 브랜드로 합치고 지움(관리자) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => mergeBrand(user, params.id, await body(req, brandMergeInput)));
