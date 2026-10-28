import { handler, body } from '@/lib/api';
import { addManual, listView, manualInput } from '@/lib/sales/support';

/** #450 영업실 '지원사업' — 탭(fit 맞춤·closing 마감 임박·mine 관심·준비·results 신청·결과·all 전체)·찾기 · #781 정렬(sort)·D-day(dd)·종류(kind) · #788 대상(aud) — 안 주면 그 사람이 마지막에 고른 것 */
export const GET = handler(async ({ req, user }) => {
  const p = req.nextUrl.searchParams;
  return listView(user, { tab: p.get('tab') ?? undefined, q: p.get('q') ?? undefined, showNo: p.get('showNo') === '1', limit: Number(p.get('limit')) || undefined,
    sort: p.get('sort') ?? undefined, dd: p.get('dd') ?? undefined, kind: p.get('kind') ?? undefined, aud: p.get('aud') ?? undefined });
});
/** 직접 입력 — 목록에 없는 공고·지난 신청 이력(예: 9/12 신청 → 결과 대기) */
export const POST = handler(async ({ req, user }) => addManual(user, await body(req, manualInput)));
