import { handler, body, clientIp } from '@/lib/api';
import { addWatch, watchInput, watchView } from '@/lib/sales/watch';

/** #1181 상업화 마감 3번: 내 수집 원천(게시판·RSS) — GET 원천·최근 글 · POST {label, url, words?} 추가(대표·관리자) */
export const GET = handler(async ({ user }) => watchView(user));
export const POST = handler(async ({ req, user }) => addWatch(user, await body(req, watchInput), clientIp(req)));
