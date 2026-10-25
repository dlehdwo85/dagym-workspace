import { handler, body } from '@/lib/api';
import { unarchiveAll, unarchiveInput } from '@/lib/mktAuto';

/** 전면 정리 [되돌리기]: 같은 묶음(archived_at, 없으면 가장 최근)으로 보관한 글을 원래 상태로. 관리자 */
export const POST = handler(async ({ req, user }) => unarchiveAll(user, await body(req, unarchiveInput)));
