import { handler, body } from '@/lib/api';
import { describeInput, describeNow } from '@/lib/mktPhotos';

/** #235 ⓒ [설명하기]: 설명 없는 마케팅 사진을 25초만큼(남으면 left) · { ids, redo } = 그 사진 다시 설명 — 관리자만 */
export const POST = handler(async ({ req, user }) => describeNow(user, await body(req, describeInput)));
