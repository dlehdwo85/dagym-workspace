import { db } from './db';
import { accessibleUnitIds, atLeast, isAdmin, taskVisibleSql } from './access';
import { assignedSql } from './taskAssignees';
import { addDays, todaySeoul, weekRangeSeoul } from './time';
import { tenantOf, type SessionUser } from './types';

/**
 * #1110(대표 11/22 시안 승인) 홈 한 번에 — '오늘 처리할 것' 숫자 칸 · '회사 현황'(대표·관리자만) · 공지 2개.
 * 칸마다 따로 막히면(권한 없음·기능 꺼짐) null — 홈 전체가 실패하지 않게 한 칸씩 감쌈.
 */
const safe = async <T>(f: () => Promise<T>): Promise<T | null> => { try { return await f(); } catch { return null; } };
const daysTo = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5);

export async function homeSummary(u: SessionUser) {
  const sql = db(); const t = tenantOf(u); const today = todaySeoul(); const admin = isAdmin(u);
  const week = weekRangeSeoul(); const weekEnd = addDays(week.start, 6);
  const units = await accessibleUnitIds(u, sql);
  const { userSpaces } = await import('./spaces');
  const spaces = await userSpaces(u, sql).catch(() => [] as string[]);

  const [mine, approvals, marketing, bids, unread, notices, review] = await Promise.all([
    // 내 업무: 기한 지남(가장 오래된 날) · 오늘 마감
    safe(async () => {
      const [r] = await sql<{ overdue: number; oldest: string | null; due_today: number }[]>`select
          count(*) filter (where t.due_date < ${today})::int as overdue, min(t.due_date) filter (where t.due_date < ${today})::text as oldest,
          count(*) filter (where t.due_date = ${today})::int as due_today
        from tasks t where t.deleted_at is null and t.parent_id is null and t.status <> 'done' and ${assignedSql(sql, u.id)} and ${taskVisibleSql(sql, u, units)}`;
      return { overdue: r.overdue, oldestDays: r.oldest ? daysTo(r.oldest, today) : null, dueToday: r.due_today };
    }),
    // 결재 대기(내 차례)
    safe(async () => (await import('./approvalForms')).todoCount(sql, u)),
    // 마케팅 승인(마케팅 공간에 들어갈 수 있을 때만)
    spaces.includes('marketing') ? safe(async () => (await import('./marketing')).approvalCounts(t)) : Promise.resolve(null), // 공간 탭 '승인할 것'과 같은 수(시안 + 운영)
    // 새 입찰 공고(오늘 아침 메일 = 어제 이후) — 영업 공간 + 입찰 수집을 켠 회사만
    spaces.includes('sales') ? safe(async () => {
      if (!(await (await import('./sales/options')).salesBidsOn(t))) return null;
      const [d] = await sql<{ n: number }[]>`select coalesce((counts->>'total')::int, 0) as n from sales_digests where tenant = ${t} and day = ${today}`;
      return d?.n ?? 0;
    }) : Promise.resolve(null),
    safe(async () => (await import('./chat')).unreadTotal(u)),
    // 공지 최근 2개
    safe(async () => (await (await import('./announcements')).listNotices(u, { limit: 2 })).notices.map((n: any) => ({ id: n.id, title: n.title, important: n.important, read: n.read, at: n.publish_at ?? n.created_at }))),
    // 검토 대기(현장 관리자 이상) — #1110 개편 때 빠진 [완료 확인]·[보완 요청] 바로 처리(예전 홈과 같은 범위: 볼 수 있는 업무 중 검토 요청된 것, 내가 요청자인 것 먼저)
    atLeast(u, 'site_manager') ? safe(async () => {
      const rows = await sql<{ id: string; title: string; requested_by: string | null; requested_by_name: string | null; n: number }[]>`select t.id, t.title, t.requested_by,
          (select name from users ru where ru.id = t.requested_by) as requested_by_name, count(*) over ()::int as n
        from tasks t where t.deleted_at is null and t.parent_id is null and t.status = 'review' and ${taskVisibleSql(sql, u, units)}
        order by (t.requested_by = ${u.id}) desc, t.review_requested_at nulls last limit 3`;
      return { count: rows[0]?.n ?? 0, items: rows.map(({ n: _n, ...x }) => x) };
    }) : Promise.resolve(null),
  ]);

  // 회사 현황(대표·관리자만): 영업 · 지점 보고 · 점검·계약 · 이번 달 광고비
  const company = admin ? await (async () => {
    const [sales, branch, check, agreement, ads] = await Promise.all([
      spaces.includes('sales') ? safe(async () => {
        const [d] = await sql<{ items: any[] }[]>`select items from sales_digests where tenant = ${t} and day >= ${addDays(today, -7)} order by day desc limit 1`;
        const seen = new Set<string>(); const ds: string[] = [];
        for (const it of d?.items ?? []) {
          const dl = String(it?.deadline ?? '').slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dl) || dl < today || dl > weekEnd || seen.has(String(it.id ?? it.title))) continue;
          seen.add(String(it.id ?? it.title)); ds.push(dl);
        }
        ds.sort();
        return { dueThisWeek: ds.length, earliestDays: ds.length ? daysTo(today, ds[0]) : null };
      }) : Promise.resolve(null),
      safe(async () => {
        const b = await import('./branchReport');
        if (!b.branchReportOn(t)) return null;
        const friday = addDays(week.start, 4); // 이번 주(월~일) 보고일 금요일
        const [r] = await sql<{ total: number; submitted: number }[]>`select count(*)::int as total,
            count(*) filter (where exists (select 1 from branch_reports x where x.site_id = s.id and x.kind = 'weekly' and x.report_day = ${friday} and x.status = 'submitted'))::int as submitted
          from branch_sites s where s.tenant = ${t} and not s.hidden`;
        if (!r.total) return null;
        return { submitted: r.submitted, total: r.total, day: friday };
      }),
      safe(async () => {
        const s = await (await import('./check/rounds')).checkSummary(u);
        return s.show ? { acting: s.requested, waiting: s.waiting } : null;
      }),
      safe(async () => {
        const [r] = await sql<{ end_date: string | null; soon: number }[]>`select min(end_date)::text as end_date, count(*) filter (where end_date <= ${addDays(today, 60)})::int as soon
          from agreements where tenant = ${t} and deleted_at is null and status = 'active' and end_date >= ${today}`;
        return r?.end_date ? { earliestDays: daysTo(today, r.end_date), soon: r.soon } : null;
      }),
      spaces.includes('marketing') ? safe(async () => {
        // 광고 운영 화면과 같은 값(adOps.monthSpend — 모든 매체 합계, 월 상한도 이 합계로 지킴) — #1110 로컬 대조 11/22
        const [a] = await sql<{ n: number }[]>`select count(*)::int as n from mkt_ad_accounts where tenant = ${t}`;
        if (!a?.n) return null;
        const ad = await import('./adOps');
        const [spend, cap] = await Promise.all([ad.monthSpend(t), ad.capOf(t)]);
        return { spend: Math.round(spend), cap: cap?.monthlyCap ?? null };
      }) : Promise.resolve(null),
    ]);
    return { sales, branch, check, agreement, ads };
  })() : null;

  return {
    today, admin,
    todo: {
      overdue: mine?.overdue ?? 0, overdueOldestDays: mine?.oldestDays ?? null, dueToday: mine?.dueToday ?? 0,
      approvals: approvals ?? 0, marketing: marketing ? marketing.drafts + marketing.ops : null, marketingSplit: marketing, bids, unread: unread ?? 0,
    },
    review, me: u.id,
    company, notices: notices ?? [],
  };
}
