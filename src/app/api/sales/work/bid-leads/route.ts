import { body, handler } from '@/lib/api';
import { bidLeadsPreview, moveBidLeads, moveBidLeadsInput } from '@/lib/sales/bidTasks';

/** 결정 15-35 예전 자료 정리(관리자): GET = 입찰 공고에서 넘어온 리드 미리 보기 · POST = 고른 리드를 입찰 업무로 옮김 */
export const GET = handler(async ({ user }) => bidLeadsPreview(user));
export const POST = handler(async ({ req, user }) => moveBidLeads(user, await body(req, moveBidLeadsInput)));
