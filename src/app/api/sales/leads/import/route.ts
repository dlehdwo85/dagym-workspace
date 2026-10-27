import { handler, body } from '@/lib/api';
import { importInput, importLeads } from '@/lib/sales/cutover';

/** S2 2차: CSV 가져오기(관리자) — 화면에서 CSV(UTF-8·CP949)를 읽어 행으로 보냄, 같은 이름은 건너뜀 · 205차: 미리보기에서 고른 줄별 합치기·새로·건너뛰기 */
export const POST = handler(async ({ req, user }) => importLeads(user, await body(req, importInput)));
