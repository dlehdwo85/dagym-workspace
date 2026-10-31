import { handler } from '@/lib/api';
import { runCollectorManual } from '@/lib/sales/collectors';

export const maxDuration = 60;
/** [지금 수집](관리자) — 40초 예산 안에서 한 번 · 278차 #816: { full: true } = 최근 14일 다시 받기(놓친 공고 채우기) */
export const POST = handler<{ slug: string }>(async ({ req, user, params }) => {
  const b = await req.json().catch(() => null) as { full?: unknown } | null;
  return runCollectorManual(user, params.slug, { full: b?.full === true });
});
