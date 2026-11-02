import { z } from 'zod';
import { handler, body, zUuid } from '@/lib/api';
import { duplicateSets, mergeSetsByUser } from '@/lib/taskMerge';

/** 327차(로컬 11/02 9): 사람마다 따로 만든 같은 업무('각자 1건씩' 묶음 · 같은 제목·요청자·만든 시각 10분 안) 찾기 → 고른 묶음을 공동 업무 1건으로(요청자·관리자) */
export const GET = handler(async ({ user }) => ({ sets: await duplicateSets(user) }));
export const POST = handler(async ({ req, user }) => {
  const i = await body(req, z.object({ sets: z.array(z.array(zUuid).min(2).max(30)).min(1).max(50) }));
  return mergeSetsByUser(user, i.sets);
});
