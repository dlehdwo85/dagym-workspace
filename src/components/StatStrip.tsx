'use client';
// D-03(대표 11/23 '추천대로'): 같은 모양 카드 여러 개를 줄지어 놓던 숫자 요약을 한 상자 안의 숫자 줄로 — 칸 사이는 얇은 선만(카드 테두리·그림자 반복 없음).
// 휴대폰은 2칸씩, 넓은 화면은 cols 칸씩 줄바꿈. 칸마다 눌러서 그 목록으로 가는 링크는 그대로.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cx } from './ui';

export type Stat = { label: string; value: ReactNode; href?: string; sub?: ReactNode; alert?: boolean; color?: string; testid?: string };
const COLS: Record<number, string> = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6' };

export function StatStrip({ items, cols = 4, testid, className, big }: { items: Stat[]; cols?: 2 | 3 | 4 | 5 | 6; testid?: string; className?: string; big?: boolean }) {
  const padDesk = (cols - (items.length % cols)) % cols; // 마지막 줄 빈칸(선 색이 비치지 않게)
  const padMob = items.length % 2;
  return (
    <div className={cx('grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line', COLS[cols], className)} data-testid={testid}>
      {items.map((s) => {
        const body = <>
          <div className="truncate text-xs text-ink-2">{s.label}</div>
          <div className={cx('mt-0.5 font-semibold tabular-nums', big ? 'text-xl' : 'text-lg', s.alert ? 'text-red-600' : 'text-ink')} style={!s.alert && s.color ? { color: s.color } : undefined}>{s.value}</div>
          {s.sub ? <div className="truncate text-[11px] text-ink-3">{s.sub}</div> : null}
        </>;
        return s.href
          ? <Link key={s.label} href={s.href} className="min-w-0 bg-white px-3 py-2.5 hover:bg-slate-50 focus-visible:relative focus-visible:z-10" data-testid={s.testid}>{body}</Link>
          : <div key={s.label} className="min-w-0 bg-white px-3 py-2.5" data-testid={s.testid}>{body}</div>;
      })}
      {Array.from({ length: padDesk }, (_, i) => <div key={`d${i}`} aria-hidden className={cx('hidden bg-white', 'lg:block')} />)}
      {padMob ? <div aria-hidden className="bg-white lg:hidden" /> : null}
    </div>
  );
}
