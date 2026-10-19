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
  const summary: Record<string, { text: string; badge: number }> = { work: { text: `내 업무 ${w.open} · 오늘까지 ${w.today}`, badge: 0 } };
  if (spaces.includes('sales')) summary.sales = { text: '영업관리 이전 준비 중', badge: 0 };
  if (spaces.includes('marketing')) { // 앱 하단 탭 '승인 대기' 배지
    const n = await (await import('@/lib/marketing')).approvableCount(tenantOf(user)); // 승인함·현황과 같은 계산(마감 지남 제외)
    summary.marketing = { text: n ? `승인할 시안 ${n}` : '마케팅 운영실', badge: n };
  }
  return { spaces, summary };
});
