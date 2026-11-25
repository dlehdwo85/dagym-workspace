import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { userSpaces } from '@/lib/spaces';
import { tenantOf } from '@/lib/types';

/** V41 공간 전환 시트·드롭다운: 내가 들어갈 수 있는 공간 + 요약(업무: 내 할 일·오늘 마감). 영업·마케팅 요약은 각 공간이 생기면 채움 */
export const GET = handler(async ({ user }) => {
  const sql = db();
  const spaces = await userSpaces(user, sql);
  const [w] = await sql<{ open: number; today: number }[]>`select count(*) filter (where t.status <> 'done')::int as open,
      count(*) filter (where t.status <> 'done' and t.due_date <= (now() at time zone 'Asia/Seoul')::date)::int as today
    from tasks t where t.deleted_at is null and t.assignee_id = ${user.id}`; // 나에게 배정된 업무
  // #1171(대표 11/26): 공간 전환 숫자 = 그 공간 사이드바 숫자들의 합(navCounts — 알림 폴링과 같은 계산). label = 화면 맨 위 한 줄에 쓰는 이름
  const nav = await (await import('@/lib/navCounts')).navCounts(sql, user, { spaces });
  const summary: Record<string, { text: string; badge: number; label?: string; href?: string }> = { work: { text: `내 업무 ${w.open} · 오늘까지 ${w.today}`, badge: nav.sums.work, label: '업무 공간 메뉴 숫자 합' } };
  if (spaces.includes('sales')) { // 영업 기회 허브 숫자 = 안 본 오늘 공고(오늘 아침 공고 알림을 아직 안 열었으면 그 묶음의 공고 수)
    const [d] = await sql<{ n: number }[]>`select coalesce((counts->>'total')::int, 0) as n from sales_digests where tenant = ${tenantOf(user)} and day = (now() at time zone 'Asia/Seoul')::date`;
    const n = d?.n ?? 0;
    summary.sales = { text: nav.hubUnseen ? `안 본 오늘 공고 ${nav.hubUnseen}건` : n ? `오늘 공고 ${n}건(모두 봄)` : '오늘 공고 없음', badge: nav.sums.sales, label: '영업 메뉴 숫자 합', href: '/s/sales/hub?tab=bids&bt=today' };
  }
  if (spaces.includes('marketing')) {
    const { drafts: n, ops } = await (await import('@/lib/marketing')).approvalCounts(tenantOf(user)); // 승인함 머리와 같은 계산(시안 + 운영 요청)
    summary.marketing = { text: n + ops ? `승인할 것 ${n + ops}건(시안 ${n} · 운영 ${ops})` : '승인할 것 없음', badge: nav.sums.marketing, label: '마케팅 메뉴 숫자 합', href: '/s/marketing/approvals' };
  }
  return { spaces, summary, counts: nav.counts, dots: nav.dots, sums: nav.sums, why: nav.why };
});
