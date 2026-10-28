'use client';
import { dtf } from '@/lib/dtf';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { cx, todayStr } from './ui';

const addDays = (d: string, n: number) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const dow = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();
export const fmtDateLabel = (d: string) => { const t = new Date(d + 'T00:00:00Z'); return `${t.getUTCMonth() + 1}월 ${t.getUTCDate()}일 (${'일월화수목금토'[t.getUTCDay()]})`; };

/** Google Calendar 처럼: 날짜 버튼 → 작은 달력 팝업 */
export function DateField({ value, onChange, label, min }: { value: string; onChange: (v: string) => void; label: string; min?: string }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(value.slice(0, 7));
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    setMonth(value.slice(0, 7));
    const r = ref.current?.getBoundingClientRect();
    // V14 45번: 아래 공간이 모자라면 칸 위로(칸을 가리지 않게), 화면 안쪽 8px
    if (r) setPos({ left: Math.max(8, Math.min(window.innerWidth - 268, r.left)), top: window.innerHeight - r.bottom >= 312 || r.top < 312 ? Math.min(window.innerHeight - 308, r.bottom + 4) : r.top - 304 });
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const first = month + '-01';
  const pad = dow(first); // 일요일 시작(캘린더와 같게)
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const days: string[] = [];
  for (let d = first; d < next + '-01'; d = addDays(d, 1)) days.push(d);
  const today = todayStr();
  return (
    <>
      <button ref={ref} type="button" onClick={() => setOpen(!open)} aria-label={`${label}: ${value}`} aria-haspopup="dialog" aria-expanded={open} data-testid="date-field"
        className="inline-flex h-10 items-center gap-1.5 rounded-input border border-line bg-white px-2.5 text-sm hover:border-slate-300">
        <CalendarDays className="size-4 text-ink-3" />{fmtDateLabel(value)}
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
          <div role="dialog" aria-label={`${label} 달력`} className="fixed z-[71] w-64 animate-fade-up rounded-card border border-line bg-white p-2 shadow-pop" style={pos}>
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="text-sm font-semibold tabular-nums">{y}년 {m}월</span>
              <span className="flex">
                <button type="button" onClick={() => setMonth(prev)} className="rounded p-1 hover:bg-slate-100" aria-label="이전 달"><ChevronLeft className="size-4" /></button>
                <button type="button" onClick={() => setMonth(next)} className="rounded p-1 hover:bg-slate-100" aria-label="다음 달"><ChevronRight className="size-4" /></button>
              </span>
            </div>
            <div className="grid grid-cols-7 text-center text-[11px] text-ink-3">{['일', '월', '화', '수', '목', '금', '토'].map((d, i) => <span key={d} className={cx('py-0.5', i === 0 && 'text-red-400')}>{d}</span>)}</div>
            <div className="grid grid-cols-7 text-center text-sm">
              {Array.from({ length: pad }, (_, i) => <span key={'p' + i} />)}
              {days.map((d) => (
                <button key={d} type="button" disabled={!!min && d < min} onClick={() => { onChange(d); setOpen(false); }} aria-label={fmtDateLabel(d)} aria-pressed={d === value}
                  className={cx('mx-auto my-0.5 flex size-8 items-center justify-center rounded-full tabular-nums disabled:opacity-30',
                    d === value ? 'bg-brand-600 font-semibold text-white' : d === today ? 'font-bold text-accent-600 ring-1 ring-accent-500' : dow(d) === 0 ? 'text-red-600 hover:bg-slate-100' : 'hover:bg-slate-100')}>
                  {Number(d.slice(8))}
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** 15분 단위 시각 목록 (00:00 ~ 23:45) */
export const TIMES = Array.from({ length: 96 }, (_, i) => `${pad2(Math.floor(i / 4))}:${pad2((i % 4) * 15)}`);
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const timeLabel = (t: string) => { const h = Number(t.slice(0, 2)), m = t.slice(3, 5); return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${m}`; };
const durLabel = (min: number) => (min <= 0 ? '' : min < 60 ? `${min}분` : min % 60 ? `${Math.floor(min / 60)}시간 ${min % 60}분` : `${min / 60}시간`);

/** V36 5: 기본은 07:00~22:00, [그 외 시간 보기…]로 하루 전체. 고른 값이 목록 밖이면 그 값도 넣는다 · #756(대표 10/28 '15분 단위도 설정 가능하도록'): 기본 목록도 15분(:15·:45) */
export const DAY_TIMES = TIMES.filter((t) => t >= '07:00' && t <= '22:00');
const MORE = '__more';
function useTimes(value: string | null | undefined) {
  const [all, setAll] = useState(false);
  const base = all ? TIMES : DAY_TIMES;
  const opts = !value || base.includes(value) ? base : [...base, value].sort();
  return { opts, all, more: () => setAll(true) };
}
/** 시각 고르기(빈 값 허용) — 업무 마감 시각·빠른 등록 등 */
export function TimePick({ value, onChange, ariaLabel, className, emptyLabel = '시간 없음', testid }: { value: string | null | undefined; onChange: (v: string | null) => void; ariaLabel: string; className?: string; emptyLabel?: string; testid?: string }) {
  const t = useTimes(value);
  return (
    <select className={className} value={value ?? ''} aria-label={ariaLabel} data-testid={testid}
      onChange={(e) => { if (e.target.value === MORE) { t.more(); return; } onChange(e.target.value || null); }}>
      <option value="">{emptyLabel}</option>
      {t.opts.map((x) => <option key={x} value={x}>{timeLabel(x)}</option>)}
      {!t.all && <option value={MORE}>그 외 시간 보기…</option>}
    </select>
  );
}

/** 시간 = 목록(기본 07~22시). 종료 시각은 시작 기준 길이를 함께 보여 줌 ("오후 3:00 (1시간)") */
export function TimeSelect({ value, onChange, label, from }: { value: string; onChange: (v: string) => void; label: string; from?: string }) {
  const t = useTimes(value);
  const list = from ? t.opts.filter((x) => toMin(x) > toMin(from)) : t.opts;
  return (
    <select value={value} onChange={(e) => { if (e.target.value === MORE) { t.more(); return; } onChange(e.target.value); }} aria-label={label} data-testid="time-select"
      className="h-10 rounded-input border border-line bg-white px-2 text-sm hover:border-slate-300">
      {(list.length ? list : t.opts).map((x) => <option key={x} value={x}>{timeLabel(x)}{from ? ` (${durLabel(toMin(x) - toMin(from))})` : ''}</option>)}
      {!t.all && <option value={MORE}>그 외 시간 보기…</option>}
    </select>
  );
}
/** 시작 시각을 바꾸면 길이를 유지한 채 종료도 이동 */
export function shiftEnd(oldStart: string, oldEnd: string, newStart: string) {
  const len = Math.max(15, toMin(oldEnd) - toMin(oldStart));
  const e = Math.min(23 * 60 + 45, toMin(newStart) + len);
  return `${pad2(Math.floor(e / 60))}:${pad2(e % 60)}`;
}
/** 지금 기준 다음 정각 */
export function nextHour() {
  const h = Number(dtf('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date()));
  const s = Math.min(22, (h + 1) % 24);
  return { start: `${pad2(s)}:00`, end: `${pad2(s + 1)}:00` };
}
