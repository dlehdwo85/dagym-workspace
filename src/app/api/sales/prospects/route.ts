import { handler } from '@/lib/api';
import { listProspects } from '@/lib/sales/sources';

/** V41 단계 3 영업기회(공공데이터): 회사가 켠 원천 × 지역·검색어·제외어 */
export const GET = handler(async ({ req, user }) => {
  const sp = req.nextUrl.searchParams;
  return listProspects(user, { status: sp.get('status') ?? undefined, source: sp.get('source') ?? undefined, q: sp.get('q') ?? undefined, moveIn: sp.get('moveIn') ?? undefined });
});
