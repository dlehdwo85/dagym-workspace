import { handler } from '@/lib/api';
import { assertCanSeeUser, dayLoads } from '@/lib/availability';
import { badRequest } from '@/lib/errors';
import { todaySeoul, addDays } from '@/lib/time';

/** S-7 사람의 날짜별 회의·업무 블록·남은 가용 시간 (본인 또는 관리 범위) */
export const GET = handler(async ({ user, req }) => {
  const sp = req.nextUrl.searchParams;
  const userId = sp.get('userId') ?? user.id;
  const ok = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) ? s : null);
  const from = ok(sp.get('from') ?? sp.get('date')) ?? todaySeoul();
  const to = ok(sp.get('to') ?? sp.get('date')) ?? from;
  if (to < from || Date.parse(to) - Date.parse(from) > 62 * 86400000) throw badRequest('기간은 62일 이내로 지정하세요');
  if (!/^[0-9a-f-]{36}$/.test(userId)) throw badRequest('사용자 형식이 아닙니다');
  await assertCanSeeUser(user, userId);
  return { userId, days: await dayLoads(userId, from, to, { notBefore: from === todaySeoul() ? new Date() : undefined }), until: addDays(to, 0) };
});
