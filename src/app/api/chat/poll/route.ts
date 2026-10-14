import { handler } from '@/lib/api';
import { changesSince, latestId } from '@/lib/chat';

/** 실시간이 끊겼을 때 5초 폴링 */
export const GET = handler(async ({ req, user }) => {
  const p = req.nextUrl.searchParams;
  const since = /^\d+$/.test(p.get('since') ?? '') ? p.get('since')! : await latestId();
  const t = new Date(Number(p.get('t')) || Date.now() - 10_000);
  return { ...(await changesSince(user, since, t)), now: Date.now(), latest: await latestId() };
});
