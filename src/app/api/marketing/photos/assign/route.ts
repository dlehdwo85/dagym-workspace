import { handler, body } from '@/lib/api';
import { assignInput, assignPhotos } from '@/lib/mktPhotos';

/** 290차 [브랜드로 지정]·[쓰지 않음]: 고른 사진에 브랜드 이름 태그(또는 '쓰지않음') — 관리자만 */
export const POST = handler(async ({ req, user }) => assignPhotos(user, await body(req, assignInput)));
