'use client';
import Link from 'next/link';
import { ClipboardCheck } from 'lucide-react';
import { useApi } from '../client';
import { useSession } from '../session';

type Summary = { show: false } | { show: true; open: { id: string; orgUnitName: string; name: string; done: number }[]; waiting: number; requested: number; last: { endedAt: string; orgUnitName: string; name: string } | null };
const md = (iso: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(iso));

/** 홈 '점검' 카드(점검 2단계): 하던 점검 이어서 · 담당자가 조치를 끝낸 보완(확인 대기) · 조치 중 — 점검하기 권한이 있고, 볼 것이 있을 때만 보임 */
export function CheckHomeCard() {
  const sess = useSession();
  const on = (sess.menus?.check_run ?? 'none') !== 'none';
  const st = useApi<Summary>(on ? '/api/check/summary' : null);
  const d = st.data;
  if (!on || !d || !d.show) return null;
  return (
    <section className="rounded-card border border-line bg-white p-3 shadow-card" data-testid="home-check">
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardCheck className="size-4 text-brand-700" aria-hidden /><h2 className="text-sm font-semibold">점검</h2>
        {d.waiting > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800" data-testid="home-check-waiting">확인 대기 {d.waiting}</span>}
        {d.requested > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-ink-2" data-testid="home-check-requested">조치 중 {d.requested}</span>}
        <Link prefetch={false} href="/check" className="ml-auto text-xs font-medium text-brand-700 underline" data-testid="home-check-go">점검하기</Link>
      </div>
      <ul className="mt-1.5 space-y-0.5 text-sm">
        {d.open.map((r) => (
          <li key={r.id}><Link prefetch={false} href={`/check/round/${r.id}`} className="flex items-center gap-2 rounded-input px-2 py-1.5 hover:bg-slate-50" data-testid="home-check-open">
            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">이어서</span><span className="min-w-0 flex-1 truncate">{r.orgUnitName} · {r.name}</span><span className="shrink-0 text-xs text-ink-3">{r.done}개 적음</span></Link></li>
        ))}
        {d.waiting > 0 && <li><Link prefetch={false} href="/check" className="block rounded-input px-2 py-1.5 hover:bg-slate-50" data-testid="home-check-confirm">담당자가 조치를 끝낸 보완 {d.waiting}건 — 확인해 주세요</Link></li>}
        {!d.open.length && !d.waiting && (
          <li className="px-2 py-1 text-ink-3" data-testid="home-check-last">{d.last ? `마지막 점검 ${md(d.last.endedAt)} · ${d.last.orgUnitName} · ${d.last.name}` : '끝낸 점검이 아직 없습니다'}</li>
        )}
      </ul>
    </section>
  );
}
