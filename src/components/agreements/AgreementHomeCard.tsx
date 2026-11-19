'use client';
import Link from 'next/link';
import { FolderClock } from 'lucide-react';
import { useApi } from '../client';
import { useSession } from '../session';
import { cx } from '../ui';

type Summary = { show: false } | { show: true; attention: number; soon: number; items: { id: string; title: string; counterparty: string; state: string; left: string }[] };

/** 홈 '계약' 카드(계약 관리 2단계): 만료·연장 확인·통보 기한이 지난 계약과 30일 안에 손써야 하는 계약 — 계약 관리 권한이 있고, 그런 계약이 있을 때만 보임 */
export function AgreementHomeCard() {
  const sess = useSession();
  const on = (sess.menus?.agreements ?? 'none') !== 'none';
  const st = useApi<Summary>(on ? '/api/agreements/summary' : null);
  const d = st.data;
  if (!on || !d || !d.show) return null;
  const more = d.attention + d.soon - d.items.length;
  return (
    <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="home-agreements">
      <div className="flex flex-wrap items-center gap-2">
        <FolderClock className="size-4 text-brand-700" aria-hidden /><h2 className="text-sm font-semibold">계약</h2>
        {d.attention > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700" data-testid="home-agr-attention">챙길 것 {d.attention}</span>}
        {d.soon > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800" data-testid="home-agr-soon">30일 안 {d.soon}</span>}
        <Link prefetch={false} href="/agreements" className="ml-auto text-xs font-medium text-brand-700 underline" data-testid="home-agr-go">계약 관리</Link>
      </div>
      <ul className="mt-1.5 space-y-0.5 text-sm">
        {d.items.map((a) => (
          <li key={a.id}><Link prefetch={false} href={`/agreements?open=${a.id}`} className="flex items-center gap-2 rounded-input px-2 py-1.5 hover:bg-slate-50" data-testid="home-agr-row">
            <span className="min-w-0 flex-1 truncate"><b className="font-medium">{a.title}</b>{a.counterparty ? <span className="text-ink-3"> · {a.counterparty}</span> : null}</span>
            <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums', a.state === 'soon' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700')}>{a.left}</span></Link></li>
        ))}
        {more > 0 && <li className="px-2 py-1 text-xs text-ink-3">그 밖에 {more}건 — 계약 관리에서 봅니다</li>}
      </ul>
    </section>
  );
}
