import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { assertSpace } from '@/lib/spaces';
import { tenantOf } from '@/lib/types';
import { badRequest } from '@/lib/errors';

/**
 * #1124(대표 11/22 '영업·마케팅에서 업무로 넘길 때 담당자 지정 — 입찰처럼'): 담당 후보 = 회사 사람 전체, 그 공간 권한(inSpace)을 함께.
 * 화면은 권한 있는 사람만 고르게 하고, 없는 사람은 회색 + '관리 › 사용자 › 공간에서 권한 주기' 안내. 기본 선택 = 원천 담당 규칙(영업 kind) 또는 나.
 */
export const GET = handler(async ({ req, user }) => {
  const space = req.nextUrl.searchParams.get('space');
  if (space !== 'sales' && space !== 'marketing') throw badRequest('공간을 골라 주세요');
  await assertSpace(user, space);
  const sql = db(); const t = tenantOf(user);
  // #1150: 이름 옆에 그 사람이 쓰는 공간(영업·마케팅)도 — 관리자는 회사가 켠 공간 전부
  const on = (await (await import('@/lib/spaces')).tenantSpaces(t, sql)).filter((x) => x !== 'work');
  const people = await sql<{ id: string; name: string; title: string | null; inSpace: boolean; spaces: string[] }[]>`select u.id, u.name, u.title,
      (u.role in ('owner', 'admin') or ${space} = any(coalesce(m.spaces, '{}'))) as "inSpace",
      case when u.role in ('owner', 'admin') then ${on}::text[] else array(select x from unnest(coalesce(m.spaces, '{}')) x where x = any(${on}::text[])) end as spaces
    from users u left join space_members m on m.user_id = u.id and m.tenant = u.tenant
    where u.tenant = ${t} and u.status = 'active' and not u.is_demo order by (u.id = ${user.id}) desc, "inSpace" desc, u.name`;
  const kind = req.nextUrl.searchParams.get('kind');
  const rule = space === 'sales' && kind ? await (await import('@/lib/assignees')).resolveAssignee(sql, t, 'sales_source', kind).catch(() => null) : null;
  const suggested = rule && people.some((p) => p.id === rule.userId && p.inSpace) ? rule.userId : null;
  return { people, me: user.id, suggested };
});
