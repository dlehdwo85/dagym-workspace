import { handler, body } from '@/lib/api';
import { pullInput, pullNow } from '@/lib/metaLeads';

/** 광고 2차 ① [지금 불러오기](관리자) — 리드 양식마다 최근 리드를 읽어 놓친 것만 영업 리드로 */
export const POST = handler(async ({ req, user }) => pullNow(user, await body(req, pullInput)));
