'use client';
import { Gauge } from 'lucide-react';
import { cx } from './ui';

const GB = 1024 ** 3;
export const fmtBytes = (n: number) => (n >= GB ? `${(n / GB).toFixed(n >= 10 * GB ? 0 : 1)}GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`);
export const won = (n: number | null) => (n === null ? '별도 협의' : n === 0 ? '0원' : `${n.toLocaleString('ko-KR')}원`);
export const lim = (v: number | null | undefined, unit: string) => (v === null || v === undefined ? '무제한' : `${v.toLocaleString('ko-KR')}${unit}`);

export function Meter({ label, icon: Icon, used, limit, usedLabel, limitLabel, testid, note }: { label: string; icon: typeof Gauge; used: number; limit: number | null; usedLabel: string; limitLabel: string; testid?: string; note?: React.ReactNode }) {
  const pct = limit === null ? null : limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="rounded-card border border-line bg-white p-4 shadow-card" data-testid={testid}>
      <div className="flex items-center gap-2 text-sm font-semibold"><Icon className="size-4 text-ink-2" />{label}
        <span className={cx('ml-auto text-xs font-medium', pct !== null && pct >= 100 ? 'text-red-600' : pct !== null && pct >= 80 ? 'text-amber-600' : 'text-ink-3')}>{pct === null ? '무제한' : `${pct}%`}</span></div>
      <div className="mt-1 text-lg font-bold">{usedLabel} <span className="text-sm font-normal text-ink-3">/ {limitLabel}</span></div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={cx('h-full rounded-full', pct === null ? 'bg-green-400' : pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-brand-600')} style={{ width: `${pct ?? 6}%` }} />
      </div>
      {note && <div className="mt-1.5 text-[11px] leading-snug text-ink-3">{note}</div>}
    </div>
  );
}

