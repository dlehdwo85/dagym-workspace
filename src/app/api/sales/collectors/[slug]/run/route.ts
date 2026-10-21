import { handler } from '@/lib/api';
import { runCollectorManual } from '@/lib/sales/collectors';

export const maxDuration = 60;
/** [지금 수집](관리자) — 40초 예산 안에서 한 번 */
export const POST = handler<{ slug: string }>(async ({ user, params }) => runCollectorManual(user, params.slug));
