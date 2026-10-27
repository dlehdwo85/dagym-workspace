import { handler, body } from '@/lib/api';
import { importInput, previewImport } from '@/lib/sales/cutover';

/** 205차(#461 ⑦): CSV 가져오기 미리보기(관리자) — 줄마다 같은 이름·같은 연락처·비슷한 이름·파일 안 겹침과 합치면 채울 칸. 쓰기 없음 */
export const POST = handler(async ({ req, user }) => previewImport(user, await body(req, importInput)));
