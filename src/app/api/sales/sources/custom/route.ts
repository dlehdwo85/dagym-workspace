import { handler, body } from '@/lib/api';
import { addCustomSource, customSourceInput } from '@/lib/sales/sources';

/** 로컬 10/19: 목록 밖 영업 출처(사이트·키워드·엑셀) 직접 추가(관리자) — 목록은 GET /api/sales/sources 의 custom */
export const POST = handler(async ({ req, user }) => addCustomSource(user, await body(req, customSourceInput)));
