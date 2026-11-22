'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/components/session';
import { cx } from '@/components/ui';

/** #1119(대표 11/22) 사이드바 '보고' 하나 → 화면 위 탭. 권한 없는 탭은 숨김, 주소는 그대로(/reports/mine · /branch-reports · /reports) */
export function reportTabs(s: { features?: { branchReport?: boolean; branchCompany?: boolean }; menus?: Record<string, string> }) {
  const tabs = [{ href: '/reports/mine', label: s.features?.branchCompany ? '사내 업무 보고' : '내 주간 보고' }];
  if (s.features?.branchReport) tabs.push({ href: '/branch-reports', label: '고객사 보고(지점)' });
  if ((s.menus?.team_reports ?? 'none') !== 'none') tabs.push({ href: '/reports', label: '회사 주간 요약' });
  return tabs;
}
export function ReportTabs() {
  const s = useSession(); const path = usePathname();
  const tabs = reportTabs(s);
  if (tabs.length < 2) return null;
  return (
    <nav className="-mt-1 mb-3 flex gap-1 overflow-x-auto border-b border-line text-sm" aria-label="보고 종류" data-testid="report-tabs">
      {tabs.map((t) => { const on = t.href === '/reports' ? path === '/reports' : path === t.href || path.startsWith(t.href + '/');
        return <Link key={t.href} href={t.href} aria-current={on ? 'page' : undefined} className={cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2', on ? 'border-brand-700 font-semibold text-ink' : 'border-transparent text-ink-2 hover:text-ink')}>{t.label}</Link>; })}
    </nav>
  );
}
