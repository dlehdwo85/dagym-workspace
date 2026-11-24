import { handler, body, clientIp } from '@/lib/api';
import { lbsCheckInput, lbsCheckQuery, locationCheckView, markLocationChecked } from '@/lib/locationProtect';

/** D-18 보호조치 ⑤⑥ 위치정보 월 점검(플랫폼 운영자만) — GET ?month=YYYY-MM · POST {month, note} = [점검 완료] 기록 */
export const GET = handler(async ({ req, user }) => locationCheckView(user, lbsCheckQuery.parse(Object.fromEntries(req.nextUrl.searchParams))));
export const POST = handler(async ({ req, user }) => markLocationChecked(user, await body(req, lbsCheckInput), clientIp(req)));
