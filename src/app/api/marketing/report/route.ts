import { handler } from '@/lib/api';
import { reportQuery, reportView } from '@/lib/mktReport';

/** 상용화 ⑧ 월간 마케팅 보고(관리자) */
export const GET = handler(async ({ req, user }) => reportView(user, reportQuery.parse(Object.fromEntries(new URL(req.url).searchParams))));
