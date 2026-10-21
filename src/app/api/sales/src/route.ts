import { handler } from '@/lib/api';
import { salesView } from '@/lib/sales/srcViews';

/** V41 단계 2 영업 공간 화면 데이터(옮긴 영업관리 원본, 전환일까지 읽기 전용) */
export const GET = handler(async ({ req, user }) => {
  const p = req.nextUrl.searchParams;
  return salesView(user, p.get('view') ?? 'summary', { q: p.get('q') ?? undefined, id: p.get('id') ?? undefined, status: p.get('status') ?? undefined, tab: p.get('tab') ?? undefined, day: p.get('day') ?? undefined, from: p.get('from') ?? undefined, to: p.get('to') ?? undefined, biz: p.get('biz') ?? undefined });
});
