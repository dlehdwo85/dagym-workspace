import { handler } from '@/lib/api';
import { branchHome } from '@/lib/branchReport';

/** #1096 지점 주간보고(다짐 전용 — 꺼진 회사는 404): 볼 수 있는 보고 지점 · 고른 지점의 보고서 목록(작성 담당은 자기 지점만) */
export const GET = handler(async ({ req, user }) => branchHome(user, { siteId: req.nextUrl.searchParams.get('site') }));
