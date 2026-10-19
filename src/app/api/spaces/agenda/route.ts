import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { userSpaces } from '@/lib/spaces';
import { tenantOf } from '@/lib/types';

/**
 * 대표 확정(10/19): 홈 '이번 주 일정'·캘린더에 영업·마케팅 '주요 일정'만 묶어서.
 * - 영업: 리드 다음 연락(다음 조치 이름)·작업 중 입찰 마감 (공고 하나하나는 안 넣음)
 * - 마케팅: 오늘 승인 필요 N건 한 줄(콘텐츠 하나하나는 안 넣음)
 * 들어갈 수 있는 공간만. 업무로 만들지 않고 보여 주기만(같은 데이터를 복사하지 않음).
 */
export const GET = handler(async ({ req, user }) => {
  const sql = db();
  const spaces = await userSpaces(user, sql);
  const p = req.nextUrl.searchParams;
  const out: { date: string; time: string | null; title: string; kind: string; space: 'sales' | 'marketing'; owner?: string | null; href: string }[] = [];
  if (spaces.includes('sales')) {
    const { salesView } = await import('@/lib/sales/srcViews');
    const r: any = await salesView(user, 'agenda', { from: p.get('from') ?? undefined, to: p.get('to') ?? undefined }).catch(() => ({ items: [] }));
    for (const x of r.items ?? []) out.push({ ...x, space: 'sales' });
  }
  if (spaces.includes('marketing')) {
    const n = await (await import('@/lib/marketing')).approvableCount(tenantOf(user));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    if (n) out.push({ date: today, time: null, title: `오늘 승인 필요 ${n}건`, kind: 'approvals', space: 'marketing', href: '/s/marketing/approvals' });
  }
  return { spaces, items: out };
});
