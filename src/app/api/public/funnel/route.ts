import { handler } from '@/lib/api';
import { HttpError } from '@/lib/errors';
import { funnelStats, funnelTokenOk } from '@/lib/funnel';

/** 마케팅 운영실용 읽기 전용 주간 퍼널(숫자만). Authorization: Bearer <FUNNEL_STATS_TOKEN>. 토큰 설정이 없으면 404 */
export const GET = handler(async ({ req }) => {
  const ok = funnelTokenOk(req.headers.get('authorization'));
  if (ok === null) throw new HttpError(404, 'not_found', '찾을 수 없습니다');
  if (!ok) throw new HttpError(401, 'unauthorized', '유효한 통계 토큰이 필요합니다');
  return funnelStats(Number(req.nextUrl.searchParams.get('weeks') ?? 8));
}, { public: true });
