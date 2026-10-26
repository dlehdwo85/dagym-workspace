import { handler, body } from '@/lib/api';
import { restoreContents, trashInput } from '@/lib/mktTrash';

/** 183차 #177 휴지통 [되살리기](관리자): ids[] → 원래 상태(보류·승인 대기·초안…)로 */
export const POST = handler(async ({ req, user }) => restoreContents(user, await body(req, trashInput)));
