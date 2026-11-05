import { handler, body } from '@/lib/api';
import { runWatchNow, setWatch, watchAction, watchInput, watchView } from '@/lib/adWatch';

/** 363차 #981 서버 광고 점검 — 기준·사업별 월 계획·지금 숫자로 본 점검·지난 매일 점검/주간 보고 */
export const GET = handler(async ({ user }) => watchView(user));
/** 기준 5개·사업별 월 계획·켜기/끄기(관리자) */
export const PUT = handler(async ({ req, user }) => setWatch(user, await body(req, watchInput)));
/** [지금 점검 보내기]·[주간 보고 지금 보내기](관리자) */
export const POST = handler(async ({ req, user }) => runWatchNow(user, await body(req, watchAction)));
