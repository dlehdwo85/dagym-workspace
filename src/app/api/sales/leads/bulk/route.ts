import { body, handler } from '@/lib/api';
import { bulkLeads, bulkLeadsInput } from '@/lib/sales/cutover';

/** 204차(#461 ⑦): 거래처 여러 건 한 번에 — 담당·단계(사유)·다음 연락일. 한 건씩 같은 규칙으로, 못 바꾼 건은 이유와 함께 */
export const POST = handler(async ({ req, user }) => bulkLeads(user, await body(req, bulkLeadsInput)));
