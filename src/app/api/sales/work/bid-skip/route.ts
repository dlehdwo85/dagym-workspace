import { z } from 'zod';
import { body, handler } from '@/lib/api';
import { skipBid, undoSkipBid } from '@/lib/sales/bidSkip';

const input = z.object({ id: z.string().min(1).max(100), reason: z.string().trim().max(300).nullable().optional(), undo: z.boolean().optional() });
/** #1142(대표 11/24 위임): 영업 › 입찰관리 [미참여](사유) — 이 공고로 만든 열린 업무는 휴지통, 연결된 자동 일정은 삭제, 공고는 '미참여' 탭에 사유와 함께 */
export const POST = handler(async ({ req, user }) => { const i = await body(req, input); return i.undo ? undoSkipBid(user, i.id) : skipBid(user, i); });
