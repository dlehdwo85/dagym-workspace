import { handler } from '@/lib/api';
import { listProspects } from '@/lib/sales/sources';

/** V41 단계 3 영업기회(공공데이터): 회사가 켠 원천 × 지역·검색어·제외어 */
export const GET = handler(async ({ req, user }) => {
  const sp = req.nextUrl.searchParams;
  // 242차 #759: 입주 고르기(moveIn=window|YYYY|YYYY-YYYY|YYYY-MM) · 아파트만(apt=1) · 세대수 이상(minHh) · 더 보기(offset·limit)
  return listProspects(user, { status: sp.get('status') ?? undefined, source: sp.get('source') ?? undefined, q: sp.get('q') ?? undefined, moveIn: sp.get('moveIn') ?? undefined,
    apt: sp.get('apt') === '1', minHh: Number(sp.get('minHh')) || 0, offset: Number(sp.get('offset')) || 0, limit: Number(sp.get('limit')) || undefined });
});
