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
  // 246차 #774: label = 배지가 센 것(공간 첫 화면 맨 위 줄과 같은 이름) · href = 그 목록
  const summary: Record<string, { text: string; badge: number; label?: string; href?: string }> = { work: { text: `내 업무 ${w.open} · 오늘까지 ${w.today}`, badge: 0 } };
  if (spaces.includes('sales')) { // #537 앱 하단 '영업기회' 배지 = 오늘 새 공고(당일 공고 메일·알림과 같은 다이제스트 수 — 무거운 원천 계산 없이)
    const [d] = await sql<{ n: number }[]>`select coalesce((counts->>'total')::int, 0) as n from sales_digests where tenant = ${tenantOf(user)} and day = (now() at time zone 'Asia/Seoul')::date`;
    const n = d?.n ?? 0;
    summary.sales = { text: n ? `오늘 새 공고 ${n}건` : '오늘 새 공고 없음', badge: n, label: '오늘 새 공고', href: '/s/sales/hub?tab=bids&bt=today' };
  }
  if (spaces.includes('marketing')) { // 앱 하단 탭 '승인 대기' 배지
    const t = tenantOf(user);
    const n = await (await import('@/lib/marketing')).approvableCount(t); // 승인함·현황과 같은 계산(마감 지남 제외)
    // 대표 02:30 ①: 승인함에 운영실 승인 요청(제안·예산·월 목표·제작 의뢰·#494 메타 광고 초안·#499-4 광고 컨셉)도 합쳐 배지
    const [o] = await sql<{ n: number }[]>`select (select count(*) from mkt_proposals where tenant = ${t} and status = 'pending') + (select count(*) from mkt_ad_budgets where tenant = ${t} and status = 'pending')
      + (select count(*) from mkt_goals where tenant = ${t} and status = 'pending') + (select count(*) from mkt_briefs where tenant = ${t} and status in ('ready', 'failed'))
      + (select count(*) from mkt_ad_plans where tenant = ${t} and provider = 'meta' and status = 'created') + (select count(*) from mkt_concept_sets where tenant = ${t} and status = 'pending') as n`.then((r) => r.map((x) => ({ n: Number(x.n) })));
    // 246차 #774: 승인함 머리 '승인할 것 n건'(시안 + 운영 요청)과 같은 이름·같은 수
    summary.marketing = { text: n + o.n ? `승인할 것 ${n + o.n}건(시안 ${n} · 운영 ${o.n})` : '승인할 것 없음', badge: n + o.n, label: '승인할 것', href: '/s/marketing/approvals' };
  }
  return { spaces, summary };
});
