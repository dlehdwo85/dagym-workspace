import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { tenantOf } from '@/lib/types';

/** V14 24번: 아바타 옆 직책 표시용 — 같은 회사 사람의 이름·직책 약칭(없으면 직책)만 */
export const GET = handler(async ({ user }) => {
  const rows = await db()<{ id: string; name: string; label: string | null }[]>`select id, name, coalesce(nullif(title_short, ''), nullif(title, '')) as label
    from users where tenant = ${tenantOf(user)} and status in ('active', 'invited')`;
  return { people: Object.fromEntries(rows.filter((r) => r.label).map((r) => [r.id, r.label])) };
});
