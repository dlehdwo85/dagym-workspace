import { handler } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { listSent, sentQuery } from '@/lib/sentMail';

/** 375차 #997 보낸 메일 모아 보기 — ?q=&from=&to=&status=&kind=&scope=mine|all&system=1&offset= (직원은 내가 보낸 것만, 대표·관리자는 회사 전체·자동 메일도) */
export const GET = handler(async ({ req, user }) => {
  const p = sentQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!p.success) throw badRequest(p.error.issues[0]?.message ?? '조건을 확인해 주세요');
  return listSent(user, p.data);
});
