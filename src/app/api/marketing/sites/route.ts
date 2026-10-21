import { handler } from '@/lib/api';
import { sitesView } from '@/lib/mktSites';

/** 대표 10/20 14:10 ①: 사이트(브랜드)별 주간 집계 — 방문·CTA(비콘)·게시·광고·문의 + 이번 주 요약 */
export const GET = handler(async ({ req, user }) => sitesView(user, Number(req.nextUrl.searchParams.get('weeks')) || 4));
