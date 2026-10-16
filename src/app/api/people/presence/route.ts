import { handler } from '@/lib/api';
import { presenceMap } from '@/lib/presence';

/** V35 2·V36 1: 같은 회사 사람의 지금 근무 상태(휴가·출장·외근·미팅만, 근무 중은 생략) — 아바타 점 */
export const GET = handler(async ({ user }) => ({ people: await presenceMap(user) }));
