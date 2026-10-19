'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react';
import { useApi } from './client';
import { Card, cx } from './ui';
import { SPACE_META } from './spaceMeta';

const seoulDay = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(d));
const hm = (d: Date | string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
const addDays = (d: string, n: number) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dow = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();
const monthOf = (d: string) => d.slice(0, 7);
const nextMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };
const prevMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; };
function eventDays(e: any): string[] {
  const s = seoulDay(e.start); const end = seoulDay(new Date(new Date(e.end).getTime() - 1));
  const out: string[] = []; for (let d = s; d <= end && out.length < 62; d = addDays(d, 1)) out.push(d);
  return out.length ? out : [s];
}
type Item = { key: string; time: string | null; title: string; href: string; color: string; kind: 'event' | 'task' | 'overdue' | 'space'; sub?: string };
const C = { event: '#0F766E', task: '#64748B', overdue: '#DC2626' };

/**
 * 로컬 10/19(대표 확정) 홈 개편: '최근 활동' 자리에 월 미니 캘린더. 날짜마다 점(일정 청록·업무 회색·영업/마케팅 공간 색·지난 업무 빨강),
 * 날짜를 누르면 그날 목록이 아래 펼쳐지고, 두 번 누르면 캘린더 화면. 대표 검수 10/20: 휴대폰도 접지 않고 월 전체 격자(접으면 이번 주와 같아 의미 없음). 데이터는 캘린더와 같은 API.
 */
export function HomeMonth({ today, className }: { today: string; className?: string }) {
  const router = useRouter();
  const [month, setMonth] = useState(monthOf(today));
  const [sel, setSel] = useState<string | null>(null);
  const from = `${month}-01`, to = `${nextMonth(month)}-01`;
  const ev = useApi<{ events: any[] }>(`/api/events?from=${encodeURIComponent(`${from}T00:00:00+09:00`)}&to=${encodeURIComponent(`${to}T00:00:00+09:00`)}`, [month]);
  const tk = useApi<{ tasks: any[] }>(`/api/tasks?view=all&includeDone=1&from=${from}&to=${addDays(to, -1)}&limit=500`, [month]);
  const ag = useApi<{ items: { date: string; time: string | null; title: string; space: 'sales' | 'marketing'; href: string }[] }>(`/api/spaces/agenda?from=${from}&to=${addDays(to, -1)}`, [month]);
  useEffect(() => { const h = () => { ev.reload(); tk.reload(); }; window.addEventListener('wos-refresh', h); return () => window.removeEventListener('wos-refresh', h); });
  const byDay = useMemo(() => {
    const m = new Map<string, Item[]>();
    const push = (d: string, it: Item) => m.set(d, [...(m.get(d) ?? []), it]);
    for (const e of ev.data?.events ?? []) { if (e.kind === 'task_block') continue; for (const d of eventDays(e)) push(d, { key: `e${e.id}:${d}`, time: e.allDay ? null : hm(e.start), title: e.title, href: `/calendar?date=${d}&event=${e.id}`, color: e.color || C.event, kind: 'event' }); }
    const tasks = Array.isArray(tk.data) ? tk.data : tk.data?.tasks ?? [];
    for (const t of tasks) { if (!t.due_date) continue; const late = t.status !== 'done' && t.due_date < today;
      push(t.due_date, { key: `t${t.id}`, time: t.due_time ? String(t.due_time).slice(0, 5) : null, title: t.title, href: `/tasks/${t.id}`, color: late ? C.overdue : C.task, kind: late ? 'overdue' : 'task', sub: t.assignee_name ?? undefined }); }
    for (const a of ag.data?.items ?? []) push(a.date, { key: `s${a.href}:${a.title}`, time: a.time, title: a.title, href: a.href, color: SPACE_META[a.space].color, kind: 'space', sub: SPACE_META[a.space].short });
    for (const [d, list] of m) m.set(d, list.sort((x, y) => (x.time ?? '').localeCompare(y.time ?? '')));
    return m;
  }, [ev.data, tk.data, ag.data, today]);
  const days: string[] = []; for (let d = from; d < to; d = addDays(d, 1)) days.push(d);
  const dots = (d: string) => { const list = byDay.get(d) ?? []; const cs: string[] = []; for (const it of list) if (!cs.includes(it.color)) cs.push(it.color); return cs.slice(0, 4); };
  const pick = (d: string) => { if (sel === d) { router.push(`/calendar?view=dayGridMonth&date=${d}`); return; } setSel(d); };
  const Cell = ({ d }: { d: string }) => (
    <button type="button" onClick={() => pick(d)} onDoubleClick={() => router.push(`/calendar?view=dayGridMonth&date=${d}`)} aria-label={`${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일`} aria-pressed={sel === d} data-day={d} data-testid="home-month-day"
      className={cx('relative mx-auto my-0.5 flex h-10 w-10 flex-col items-center rounded-lg tabular-nums',
        sel === d ? 'bg-brand-600 text-white' : d === today ? 'font-bold text-brand-700 ring-1 ring-brand-500' : dow(d) === 0 ? 'text-red-600 hover:bg-slate-100' : 'hover:bg-slate-100')}>
      <span className="mt-1.5 text-sm">{Number(d.slice(8))}</span>
      <span className="mt-0.5 flex h-1.5 gap-0.5">{dots(d).map((c) => <span key={c} className="size-1.5 rounded-full" style={{ background: sel === d ? '#fff' : c }} data-dot={c} />)}</span>
    </button>
  );
  const list = sel ? byDay.get(sel) ?? [] : [];
  return (
    <Card className={cx('flex flex-col', className)} data-testid="home-month">
      <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-3.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><CalendarRange className="size-4 text-ink-3" />{Number(month.slice(0, 4))}년 {Number(month.slice(5))}월</h2>
        <span className="flex items-center">
          <button type="button" onClick={() => setMonth(prevMonth(month))} className="rounded p-1 text-ink-2 hover:bg-slate-100" aria-label="이전 달"><ChevronLeft className="size-4" /></button>
          <button type="button" onClick={() => { setMonth(monthOf(today)); setSel(today); }} className="rounded px-1.5 text-xs text-ink-2 hover:bg-slate-100">오늘</button>
          <button type="button" onClick={() => setMonth(nextMonth(month))} className="rounded p-1 text-ink-2 hover:bg-slate-100" aria-label="다음 달"><ChevronRight className="size-4" /></button>
        </span>
      </div>
      <div className="px-2" data-testid="home-month-grid">
        <div className="grid grid-cols-7 text-center text-[11px] text-ink-3">{['일', '월', '화', '수', '목', '금', '토'].map((d, i) => <span key={d} className={cx('py-1', i === 0 && 'text-red-400')}>{d}</span>)}</div>
        <div className="grid grid-cols-7 text-center">
          {Array.from({ length: dow(from) }, (_, i) => <span key={'p' + i} />)}
          {days.map((d) => <Cell key={d} d={d} />)}
        </div>
      </div>
      <p className="px-4 pb-1 text-[11px] text-ink-3"><span className="mr-2 inline-block size-1.5 rounded-full" style={{ background: C.event }} />일정<span className="mx-1.5 inline-block size-1.5 rounded-full" style={{ background: C.task }} />업무<span className="mx-1.5 inline-block size-1.5 rounded-full" style={{ background: C.overdue }} />지난 업무<span className="mx-1.5 inline-block size-1.5 rounded-full" style={{ background: SPACE_META.sales.color }} />영업<span className="mx-1.5 inline-block size-1.5 rounded-full" style={{ background: SPACE_META.marketing.color }} />마케팅 · 한 번 더 누르면 캘린더</p>
      {sel && (
        <div className="border-t border-line px-2 pb-2 pt-1" data-testid="home-month-list">
          <p className="px-2 py-1 text-xs font-semibold text-ink-2">{Number(sel.slice(5, 7))}/{Number(sel.slice(8))}({'일월화수목금토'[dow(sel)]}) · {list.length}건 <Link href={`/calendar?view=dayGridMonth&date=${sel}`} className="ml-1 font-medium text-brand-600 hover:underline">캘린더에서 보기</Link></p>
          {list.length ? <ul className="divide-y divide-line">{list.map((it) => (
            <li key={it.key}><Link href={it.href} className="flex min-w-0 items-center gap-2 rounded-input px-2 py-1.5 text-sm hover:bg-slate-50">
              <span className="size-2 shrink-0 rounded-full" style={{ background: it.color }} /><span className="w-11 shrink-0 text-xs tabular-nums text-ink-2">{it.time ?? '종일'}</span>
              <span className={cx('min-w-0 flex-1 truncate', it.kind === 'overdue' && 'text-red-700')}>{it.title}</span>{it.sub && <span className="shrink-0 text-[11px] text-ink-3">{it.sub}</span>}</Link></li>))}</ul>
            : <p className="px-2 py-2 text-xs text-ink-3">이날은 비어 있습니다 — <Link href={`/calendar?quick=1&date=${sel}`} className="underline">일정 추가</Link></p>}
        </div>)}
    </Card>
  );
}
