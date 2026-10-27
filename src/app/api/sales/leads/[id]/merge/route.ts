import { handler, body } from '@/lib/api';
import { mergeCandidates, mergeInput, mergeLead, mergePreview } from '@/lib/sales/cutover';

/** 206차(#461 ⑦): 기존 거래처끼리 합치기(관리자) — GET ?with=다른거래처 미리보기 · GET(?q=이름) 합칠 후보 · POST { into } 이 거래처를 into 로 합침 */
export const GET = handler<{ id: string }>(async ({ req, user, params }) => {
  const sp = req.nextUrl.searchParams; const w = sp.get('with');
  return w ? mergePreview(user, params.id, w) : mergeCandidates(user, params.id, sp.get('q') ?? '');
});
export const POST = handler<{ id: string }>(async ({ req, user, params }) => mergeLead(user, params.id, (await body(req, mergeInput)).into));
