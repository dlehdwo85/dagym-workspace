'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ArrowUpDown, Bell, CalendarDays, Check, Mic, Plus, Repeat, Sparkles, UserRound, X } from 'lucide-react';
import { recurPresets } from './pickers';
import { parseTaskText } from '@/lib/nlparse';
import { correctVoice, learnVoice, listen, voiceAvailable, voiceErrorToast } from './voice';
import { TimePick, timeLabel } from './DateTimePickers';
import { api, broadcastRefresh, useApi } from './client';
import { useSession } from './session';
import { Avatar, DueChip, cx, toast, todayStr } from './ui';

const addDays = (d: string, n: number) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
/** 마감 빠른 선택: 오늘 · 내일 · 이번 주 금요일 · 다음 주 월요일 */
export function quickDues() {
  const t = todayStr();
  const dow = new Date(t + 'T00:00:00Z').getUTCDay(); // 0=일
  const fri = addDays(t, (5 - dow + 7) % 7);
  const nextMon = addDays(t, ((1 - dow + 7) % 7) || 7);
  return [['오늘', t], ['내일', addDays(t, 1)], ['이번 주 금요일', fri], ['다음 주 월요일', nextMon]] as [string, string][];
}

/**
 * 작은 떠 있는 창: 문서 맨 위(포털)에 고정 위치로 띄워 목록 행의 overflow 에 잘리지 않게. 바깥 클릭·Esc 로 닫힘.
 * V11 3번: 휴대폰(<640px)에서는 아래에서 올라오는 시트 — 키보드를 내리고, 상태바·하단 탭·키보드에 가리지 않게(안전 영역), 맨 아래 "완료".
 */
export function Popover({ open, onClose, anchor, children, width = 224, title }: { open: boolean; onClose: () => void; anchor: React.RefObject<HTMLElement | null>; children: React.ReactNode; width?: number; title?: string }) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxHeight: number } | 'sheet' | null>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose; // 부모가 매번 새 함수를 넘겨도 위치 계산을 다시 돌리지 않게
  useEffect(() => {
    if (!open) { setPos(null); return; }
    // V14 45번: 칩 바로 아래(공간이 모자라면 위)에, 칩 왼쪽에 맞춰 화면 안쪽 8px 안으로. 높이는 그쪽 남은 공간까지 — 넘치면 창 안에서 스크롤
    const place = () => {
      if (window.innerWidth < 640) { setPos('sheet'); return; }
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.left));
      const below = window.innerHeight - r.bottom - 12, above = r.top - 12;
      const down = below >= 360 || below >= above;
      const maxHeight = Math.max(160, Math.min(520, down ? below : above));
      const next = down ? { left, top: r.bottom + 4, maxHeight } : { left, bottom: window.innerHeight - r.top + 4, maxHeight };
      setPos((p) => (p && p !== 'sheet' && p.left === next.left && p.top === next.top && p.bottom === next.bottom && p.maxHeight === next.maxHeight ? p : next));
    };
    if (window.innerWidth < 640) (document.activeElement as HTMLElement | null)?.blur?.(); // 키보드 내림
    place();
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); } };
    window.addEventListener('keydown', h, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('keydown', h, true); window.removeEventListener('resize', place); };
  }, [open, anchor, width]);
  if (!open || !pos || typeof document === 'undefined') return null;
  if (pos === 'sheet') return createPortal(
    <>
      <div className="fixed inset-0 z-[70] bg-slate-900/40" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div role="dialog" aria-label={title} data-sheet className="fixed inset-x-0 bottom-0 z-[71] flex max-h-[min(80dvh,calc(100dvh-var(--sat,0px)-24px))] animate-fade-up flex-col rounded-t-2xl bg-white shadow-pop"
        onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-slate-200" aria-hidden />
        {title && <p className="px-4 pt-2 text-sm font-semibold">{title}</p>}
        <div className="min-h-0 flex-1 overflow-y-auto p-2 [&_button]:min-h-11 [&_button]:text-[15px]">{children}</div>
        <div className="shrink-0 border-t border-line p-2 pb-[calc(var(--sab,0px)+8px)]">
          <button type="button" onClick={onClose} className="h-12 w-full rounded-input bg-brand-600 text-base font-semibold text-white" data-testid="sheet-done">완료</button>
        </div>
      </div>
    </>,
    document.body,
  );
  return createPortal(
    <>
      <div className="fixed inset-0 z-[70]" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div role="dialog" aria-label={title} data-popover className="fixed z-[71] animate-fade-up overflow-y-auto overscroll-contain rounded-card border border-line bg-white p-1 shadow-pop" style={{ ...pos, width }} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>{children}</div>
    </>,
    document.body,
  );
}

/** V11 3번: 시각은 큰 버튼 격자(09:00~18:00, 30분) + "직접"(15분 목록) */
const GRID_TIMES = Array.from({ length: 19 }, (_, i) => `${String(9 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
function TimeGrid({ value, onChange, label }: { value: string | null | undefined; onChange: (v: string | null) => void; label: string }) {
  return (
    <div className="px-1.5 py-1">
      <div className="mb-1 text-xs text-ink-2">시각</div>
      <div className="grid grid-cols-4 gap-1" role="group" aria-label={`시각 빠른 선택 (${label})`}>
        <button type="button" onClick={() => onChange(null)} aria-pressed={!value} className={cx('rounded-input border px-1 py-1.5 text-xs', !value ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700' : 'border-line')}>없음</button>
        {GRID_TIMES.map((t) => (
          <button key={t} type="button" onClick={() => onChange(t)} aria-pressed={value === t} className={cx('rounded-input border px-1 py-1.5 text-xs tabular-nums', value === t ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700' : 'border-line')}>{t}</button>
        ))}
      </div>
      <label className="mt-1.5 flex items-center gap-2 text-sm"><span className="shrink-0 text-xs text-ink-2">직접</span>
        <TimePick className="min-w-0 flex-1 rounded border border-line px-1.5 py-1 text-sm" value={value} onChange={onChange} ariaLabel={`${label} 시각`} />
      </label>
    </div>
  );
}

/** 마감일 칩: 누르면 빠른 선택 + 날짜 선택 */
export function DuePicker({ value, onChange, status, label = '마감일', compact, emptyText, time, onTime }: { value: string | null | undefined; onChange: (v: string | null) => void; status?: string; label?: string; compact?: boolean; emptyText?: string; time?: string | null; onTime?: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <span className="relative inline-flex">
      <button ref={ref} type="button" onClick={(e) => { e.stopPropagation(); setOpen(!open); }} onPointerDown={(e) => e.stopPropagation()} aria-label={label} aria-haspopup="dialog" aria-expanded={open} data-testid="due-picker"
        className={cx('inline-flex items-center rounded-md hover:bg-slate-100', !value && 'gap-1 px-1.5 py-0.5 text-xs text-ink-3', !value && emptyText && 'h-8 rounded-input border border-line bg-white px-2.5 text-sm')}>
        {value ? <span className="inline-flex items-center gap-1"><DueChip due={value} status={status} />{time && <span className="text-xs font-medium text-ink-2 tabular-nums">{timeLabel(time)}</span>}</span> : <><CalendarDays className="size-3.5" />{compact ? '' : emptyText ?? '마감일'}</>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} title={label} width={260}>
        {quickDues().map(([l, d]) => (
          <button key={l} type="button" onClick={() => { onChange(d); if (!onTime) setOpen(false); }} className="flex w-full items-center justify-between rounded-input px-2.5 py-1.5 text-left text-sm hover:bg-slate-50">
            <span>{l}</span><span className="text-xs text-ink-3 tabular-nums">{Number(d.slice(5, 7))}/{Number(d.slice(8))}</span>
          </button>
        ))}
        <label className="flex items-center gap-2 px-2.5 py-1.5 text-sm"><span className="shrink-0 text-ink-2">날짜</span>
          <input type="date" className="min-w-0 flex-1 rounded border border-line px-1.5 py-0.5 text-sm" value={value ?? ''} onChange={(e) => { onChange(e.target.value || null); if (!onTime) setOpen(false); }} aria-label={`${label} 날짜 선택`} />
        </label>
        {/* V6 10번: 날짜 다음에 시각(15분, 기본 없음) */}
        {value && onTime && <TimeGrid value={time} onChange={onTime} label={label} />}
        {value && <button type="button" onClick={() => { onChange(null); onTime?.(null); setOpen(false); }} className="flex w-full items-center gap-1.5 rounded-input px-2.5 py-1.5 text-left text-sm text-ink-2 hover:bg-slate-50"><X className="size-3.5" />마감일 지우기</button>}
      </Popover>
    </span>
  );
}

/** 담당자 칩: 아바타를 누르면 사람 선택. role="지시자"면 지시자(업무를 부여한 사람) 선택 — 이름이 함께 보이는 작은 칩 */
export function AssigneePicker({ value, name, onChange, size = 24, role = '담당자', withName }: { value: string | null | undefined; name?: string | null; onChange: (id: string | null) => void; size?: number; role?: '담당자' | '지시자'; withName?: boolean }) {
  const { dir, user } = useSession();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const people = [...dir.users].sort((a, b) => (a.id === user.id ? -1 : b.id === user.id ? 1 : a.name.localeCompare(b.name, 'ko')));
  const shown = people.filter((u) => !q || u.name.includes(q) || (u.title ?? '').includes(q));
  const cur = dir.users.find((u) => u.id === value);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <span className="relative inline-flex">
      <button ref={ref} type="button" onClick={(e) => { e.stopPropagation(); setOpen(!open); setQ(''); }} onPointerDown={(e) => e.stopPropagation()} aria-label={`${role}: ${cur?.name ?? name ?? '없음'}`} aria-haspopup="dialog" aria-expanded={open}
        className={withName ? 'inline-flex max-w-full items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2 text-xs text-ink-2 hover:bg-slate-100' : 'rounded-full hover:ring-2 hover:ring-accent-500/30'} data-testid={role === '지시자' ? 'requester-picker' : 'assignee-picker'}>
        <Avatar id={value} name={cur?.name ?? name ?? null} size={size} />{withName && <span className="truncate">{cur?.name ?? name ?? '없음'}{cur?.title && <span className="hidden text-ink-3 sm:inline"> · {cur.title}</span>}</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} title={`${role} 선택`}>
        <input autoFocus={typeof window !== 'undefined' && window.innerWidth >= 640} className="mb-1 w-full rounded-input border border-line px-2 py-1 text-sm" placeholder="이름·직책 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="담당자 검색" />
        <div className="max-h-60 overflow-y-auto">
          {shown.map((u) => (
            <button key={u.id} type="button" onClick={() => { onChange(u.id); setOpen(false); }} className="flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-left text-sm hover:bg-slate-50">
              <Avatar id={u.id} name={u.name} size={22} /><span className="flex-1">{u.name}{u.id === user.id ? ' (나)' : ''}{u.title && <span className="text-xs text-ink-3"> · {u.title}</span>}</span>{u.id === value && <Check className="size-4 text-accent-600" />}
            </button>
          ))}
        </div>
        {value && role === '담당자' && <button type="button" onClick={() => { onChange(null); setOpen(false); }} className="flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-left text-sm text-ink-2 hover:bg-slate-50"><UserRound className="size-4" />담당자 없음</button>}
      </Popover>
    </span>
  );
}

/** V12 5번: 담당자 여러 명(체크) — 2명 이상이면 각자 1건씩 만든다. 빈 배열 = 담당자 없음 */
export function MultiAssigneePicker({ values, onChange }: { values: string[]; onChange: (ids: string[]) => void }) {
  const { dir, user } = useSession();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLButtonElement>(null);
  const people = [...dir.users].sort((a, b) => (a.id === user.id ? -1 : b.id === user.id ? 1 : a.name.localeCompare(b.name, 'ko')));
  const shown = people.filter((u) => !q || u.name.includes(q) || (u.title ?? '').includes(q));
  const names = values.map((id) => dir.users.find((u) => u.id === id)?.name ?? '').filter(Boolean);
  const label = !values.length ? '없음' : values.length === 1 ? names[0] : `${names[0]} 외 ${values.length - 1}명`;
  return (
    <span className="relative inline-flex">
      <button ref={ref} type="button" onClick={(e) => { e.stopPropagation(); setOpen(!open); setQ(''); }} onPointerDown={(e) => e.stopPropagation()} aria-label={`담당자: ${label}`} aria-haspopup="dialog" aria-expanded={open}
        className="inline-flex max-w-full items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2 text-xs text-ink-2 hover:bg-slate-100" data-testid="assignee-picker">
        <Avatar id={values[0] ?? null} name={names[0] ?? null} size={20} /><span className="truncate">{label}{values.length === 1 && dir.users.find((u) => u.id === values[0])?.title && <span className="hidden text-ink-3 sm:inline"> · {dir.users.find((u) => u.id === values[0])!.title}</span>}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} title="담당자 선택 (여러 명 가능)">
        <p className="px-2 pb-1 text-[11px] text-ink-3">여러 명 선택 — 2명 이상이면 각자 1건씩 만들어집니다</p>
        <input autoFocus={typeof window !== 'undefined' && window.innerWidth >= 640} className="mb-1 w-full rounded-input border border-line px-2 py-1 text-sm" placeholder="이름·직책 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="담당자 검색" />
        <div className="max-h-60 overflow-y-auto">
          {shown.map((u) => { const on = values.includes(u.id); return (
            <button key={u.id} type="button" role="menuitemcheckbox" aria-checked={on} onClick={() => onChange(on ? values.filter((x) => x !== u.id) : [...values, u.id])} className="flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-left text-sm hover:bg-slate-50">
              <span className={cx('flex size-4 items-center justify-center rounded border', on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300')}>{on && <Check className="size-3" />}</span>
              <Avatar id={u.id} name={u.name} size={22} /><span className="flex-1">{u.name}{u.id === user.id ? ' (나)' : ''}{u.title && <span className="text-xs text-ink-3"> · {u.title}</span>}</span>
            </button>); })}
        </div>
        {values.length > 0 && <button type="button" onClick={() => onChange([])} className="flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-left text-sm text-ink-2 hover:bg-slate-50"><UserRound className="size-4" />담당자 없음</button>}
      </Popover>
    </span>
  );
}

/** V5 반복 칩: 안 함·매일·평일·매주·매월… (반복은 마감일 기준 — 마감이 없으면 오늘을 마감으로) */
/** V8 4번 음성 받아쓰기: 지원 안 되면(일부 앱 WebView) 키보드의 마이크로 말하도록 안내 — 날짜·담당자 인식은 입력한 문장에도 적용됨 */
export function voiceInput(setListening: (v: boolean) => void, onText: (t: string) => void) {
  if (!voiceAvailable()) { voiceErrorToast('unsupported'); return; }
  setListening(true);
  listen({ onEnd: async (r, e) => {
    if (!r) { setListening(false); voiceErrorToast(e); return; }
    const c = await correctVoice(r); // V24 회사 단어장 보정
    setListening(false);
    if (c.fixes.length) learnVoice(c.fixes, true);
    if (c.text.trim()) onText(c.text.trim());
  } });
}

/** V8 6번: 담당자가 그날 연차·출장·공휴일이면 알려 준다(배정은 그대로) */
/** V36 2: 배정은 그대로 하고, 지금 휴가·출장 중인 담당자는 "복귀 후 확인" 안내만 */
export function noteAway(r: any) {
  const away: { name: string; label: string }[] = r?.away ?? [];
  if (away.length) toast.info(`${away.map((a) => `${a.name}님 ${a.label}`).join(', ')} — 배정은 했고, 복귀 후 확인합니다`);
}
export function warnAway(userId: string, date: string, name: string) {
  api(`/api/availability?userId=${userId}&date=${date}`).then((r: any) => {
    const d = r?.days?.[0];
    if (d?.away || d?.holiday) toast.info(`${name}님은 ${date.slice(5).replace('-', '/')}에 ${d.holiday ? `공휴일(${d.holiday})` : '연차·출장(부재)'}입니다 — 마감일을 확인하세요`);
  }).catch(() => {});
}

/** V8 8번 🔔 미리 알림 칩: 업무마다 최대 3개, 비우면 각자 기본(시간 있는 업무 60분 전·날짜만은 당일 09시) */
const REMIND_OPTS: [number, string][] = [[0, '마감 시각'], [10, '10분 전'], [30, '30분 전'], [60, '1시간 전'], [120, '2시간 전'], [1440, '하루 전'], [4320, '3일 전']];
export const remindLabel = (m: number) => REMIND_OPTS.find((x) => x[0] === m)?.[1] ?? (m >= 1440 ? `${Math.round(m / 1440)}일 전` : m >= 60 ? `${Math.round(m / 60)}시간 전` : `${m}분 전`);
export function BellChip({ value, onChange, label = '미리 알림' }: { value: number[] | null; onChange: (v: number[] | null) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const cur = value ?? [];
  return (
    <span className="relative inline-flex">
      <button ref={ref} type="button" onClick={(e) => { e.stopPropagation(); setOpen(!open); }} onPointerDown={(e) => e.stopPropagation()} aria-label={`${label}: ${cur.length ? cur.map(remindLabel).join(', ') : '기본'}`} aria-haspopup="dialog" aria-expanded={open} data-testid="bell-chip"
        className={cx('hit inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-xs', cur.length ? 'border-accent-500/40 bg-accent-50 font-medium text-accent-700' : 'border-line bg-white text-ink-2 hover:bg-slate-50')}>
        <Bell className="size-3.5" />{cur.length ? `알림 ${cur.map(remindLabel).join('·')}` : '알림 기본'}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} title="미리 알림">
        <p className="px-2.5 py-1 text-[11px] text-ink-3">최대 3개 — 안 고르면 각자 기본 알림</p>
        {REMIND_OPTS.map(([m, l]) => { const on = cur.includes(m); return (
          <button key={m} type="button" disabled={!on && cur.length >= 3} onClick={() => { const n = on ? cur.filter((x) => x !== m) : [...cur, m].sort((a, b) => a - b); onChange(n.length ? n : null); }}
            className="flex w-full items-center justify-between rounded-input px-2.5 py-1.5 text-left text-sm hover:bg-slate-50 disabled:opacity-40" aria-pressed={on}>
            {l}{on && <Check className="size-3.5 text-accent-600" />}
          </button>); })}
        {cur.length > 0 && <button type="button" onClick={() => { onChange(null); setOpen(false); }} className="flex w-full items-center gap-1.5 rounded-input px-2.5 py-1.5 text-left text-sm text-ink-2 hover:bg-slate-50"><X className="size-3.5" />기본 알림으로</button>}
      </Popover>
    </span>
  );
}

export function RepeatChip({ value, anchorDate, onChange }: { value: string | null; anchorDate: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const presets = recurPresets(anchorDate ?? todayStr());
  const cur = presets.find((p) => p.rule === value);
  return (
    <span className="relative inline-flex">
      <button ref={ref} type="button" onClick={(e) => { e.stopPropagation(); setOpen(!open); }} onPointerDown={(e) => e.stopPropagation()} aria-label={`반복: ${value ? cur?.label ?? '사용자 지정' : '안 함'}`} aria-haspopup="dialog" aria-expanded={open} data-testid="repeat-chip"
        className={cx('hit inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-xs', value ? 'border-accent-500/40 bg-accent-50 font-medium text-accent-700' : 'border-line bg-white text-ink-2 hover:bg-slate-50')}>
        <Repeat className="size-3.5" />{value ? cur?.label ?? '반복' : '반복 안 함'}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} title="반복">
        {presets.map((p) => (
          <button key={p.label} type="button" onClick={() => { onChange(p.rule); setOpen(false); }} className="flex w-full items-center justify-between rounded-input px-2.5 py-1.5 text-left text-sm hover:bg-slate-50">
            {p.label}{p.rule === value && <Check className="size-3.5 text-accent-600" />}
          </button>
        ))}
      </Popover>
    </span>
  );
}

/**
 * Asana 형 한 줄 업무 추가: 제목 입력 → Enter 로 즉시 생성(담당 = 나), 연속 입력.
 * 같은 줄의 담당자·마감일 칩으로 바로 지정. 관리자 최종 확인은 기본 꺼짐, 소속은 프로젝트/내 소속(본사)으로 자동.
 */
export function InlineAddTask({ projectId, sectionId, defaultDue, defaultAssignee, defaultRequester, onCreated, onEscape, autoFocus, muted, placeholder = '업무 추가 — 제목 입력 후 Enter' }: {
  projectId?: string | null; sectionId?: string | null; defaultDue?: string | null; defaultAssignee?: string | null; defaultRequester?: string | null; onCreated?: (id: string) => void;
  onEscape?: () => void; autoFocus?: boolean; muted?: boolean; placeholder?: string;
}) {
  const { user } = useSession();
  const [title, setTitle] = useState('');
  // 묶음 끝 줄은 그 묶음 값(담당자·마감·프로젝트)이 자동으로 들어간다. 지정이 없으면 담당 = 나
  const initAssignee = defaultAssignee === undefined ? user.id : defaultAssignee;
  const [assignees, setAssignees] = useState<string[]>(initAssignee ? [initAssignee] : []);
  const assignee = assignees[0] ?? null;
  const setAssignee = (v: string | null) => setAssignees(v ? [v] : []);
  const [due, setDue] = useState<string | null>(defaultDue ?? null);
  const initRequester = defaultRequester ?? user.id;
  const [requester, setRequester] = useState<string | null>(initRequester);
  const [rrule, setRrule] = useState<string | null>(null);
  const [dueTime, setDueTime] = useState<string | null>(null);
  const [remind, setRemind] = useState<number[] | null>(null);
  const [priority, setPriority] = useState<string>('normal');
  const [proj, setProj] = useState<{ id: string; name: string } | null>(null); // 검수 20: "#프로젝트" 인식
  const projList = useApi<{ projects: { id: string; name: string }[] }>(projectId === undefined ? '/api/projects' : null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  const { dir } = useSession();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  // 한글 입력: 조합 중 Enter 는 글자만 확정되고 다시 Enter 가 오지 않는 브라우저(Chrome)가 있어, 조합이 끝나면 대신 저장
  const enterWhileComposing = useRef(false);
  async function submit(raw?: string, refocus = true) {
    const t = (raw ?? input.current?.value ?? title).trim();
    if (!t || busyRef.current) return;
    busyRef.current = true; setBusy(true); setErr(null);
    // 속도: 누르는 즉시 입력칸을 비워 다음 업무를 바로 쓸 수 있게(실패하면 되돌림)
    const keepRrule = rrule;
    setTitle(''); setRrule(null);
    try {
      const multi = assignees.length > 1;
      const r = await api('/api/tasks', { body: { title: autoTitle(t), priority, assigneeId: assignee, ...(multi ? { assigneeIds: assignees } : {}), requestedById: requester ?? user.id, dueDate: keepRrule && !due ? todayStr() : due, dueTime: due ? dueTime : null, recurrenceRule: keepRrule, reminderMinutes: remind, projectId: projectId ?? proj?.id ?? null, sectionId: sectionId ?? null, approvalRequired: false } });
      markNew(r.id); setRemind(null); setPriority('normal'); setProj(null);
      const who = multi ? `${assignees.length}명 각각` : assignee ? (assignee === user.id ? '나' : `${dir.users.find((u) => u.id === assignee)?.name ?? ''}님`) : '담당자 없이';
      toast.ok(`${who}에게 추가됨: ${t}${assignee && assignee !== user.id ? ' — 담당자에게 알림을 보냈습니다' : assignee ? ' — 본인 업무는 마감 때 알려 드립니다' : ''}`, { label: '보기', run: () => router.push(`/tasks/${r.id}`) });
      broadcastRefresh(); onCreated?.(r.id); noteAway(r);
      if (!r.away?.length && assignee && assignee !== user.id && due) warnAway(assignee, due, dir.users.find((u) => u.id === assignee)?.name ?? '담당자');
    } catch (e: any) {
      // 저장 실패: 입력값을 되살리고 이유를 줄 아래에 표시 (조용히 사라지지 않게)
      setTitle((cur) => cur || t); setRrule(keepRrule);
      setErr(e.message ?? '저장하지 못했습니다');
    } finally { busyRef.current = false; setBusy(false); if (refocus) input.current?.focus(); }
  }
  const showChips = !!(title || due || rrule || assignees.join() !== (initAssignee ?? '') || requester !== initRequester || autoFocus);
  // 업무 "생성"은 저장 버튼·Enter 로만 (WORKIN_SAVE_AND_SPEED, 대표 지시). 바깥을 눌러도 저장하지 않고 입력한 초안은 남긴다.
  // 칩(마감·담당·지시·반복)을 고른 뒤에는 입력칸으로 돌아온다
  const back = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setTimeout(() => input.current?.focus(), 0); };
  // V8 4번 · 검수 20: 문장 속 날짜·시각·담당자·!우선순위·#프로젝트·반복을 바로 칩에 반영(적용 버튼 없음). 저장할 때 제목에서 그 말을 뺀다
  const parsed = title.trim().length > 3 ? parseTaskText(title, dir.users, todayStr(), projList.data?.projects ?? []) : null;
  const autoTitle = (t: string) => { const p = t.trim().length > 3 ? parseTaskText(t, dir.users, todayStr(), projList.data?.projects ?? []) : null; return p && p.matched.length && p.title.trim() ? p.title.trim() : t; };
  const autoKey = parsed && parsed.matched.length ? JSON.stringify([parsed.dueDate, parsed.dueTime, parsed.assigneeId, parsed.priority, parsed.projectId, parsed.rrule]) : '';
  useEffect(() => {
    if (!parsed || !autoKey) return;
    if (parsed.dueDate) setDue(parsed.dueDate); if (parsed.dueTime) setDueTime(parsed.dueTime); if (parsed.assigneeId) setAssignee(parsed.assigneeId);
    if (parsed.rrule) setRrule(parsed.rrule); if (parsed.priority) setPriority(parsed.priority);
    if (parsed.projectId) setProj({ id: parsed.projectId, name: parsed.projectName ?? '' });
  }, [autoKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const applyParsed = (p: NonNullable<typeof parsed>) => {
    setTitle(p.title); if (p.dueDate) setDue(p.dueDate); if (p.dueTime) setDueTime(p.dueTime); if (p.assigneeId) setAssignee(p.assigneeId); if (p.rrule) setRrule(p.rrule);
    setTimeout(() => input.current?.focus(), 0);
  };
  const [listening, setListening] = useState(false);
  const voice = () => voiceInput(setListening, (text) => { const p = parseTaskText(text, dir.users, todayStr()); applyParsed(p); toast.info(`들은 내용: "${text}"${p.matched.length ? ` — ${p.matched.join(' · ')} 인식` : ''}`); });
  // 작성 중에 창을 닫거나 새로고침하면 브라우저가 "작성 중인 내용" 확인
  useEffect(() => {
    if (!title.trim()) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '작성 중인 업무가 있습니다'; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [title]);
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className={cx('border-b border-line last:border-b-0 focus-within:bg-accent-50/40', muted ? 'bg-transparent' : 'bg-white')} data-testid="inline-add">
      <div className="flex min-h-[44px] items-center gap-2 px-3 py-1.5 sm:gap-3">
        <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed border-slate-300 text-slate-400"><Plus className="size-3.5" /></span>
        {/* 휴대폰 키보드의 "완료/이동" 은 form 제출로 확실히 저장 (Enter 가 keyCode 229 로 오는 키보드 대비) */}
        <input ref={input} autoFocus={autoFocus} value={title} onChange={(e) => { setTitle(e.target.value); if (err) setErr(null); }} placeholder={placeholder} aria-label="업무 추가 제목" maxLength={200}
          enterKeyHint="done" autoComplete="off"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.nativeEvent.isComposing) { e.preventDefault(); enterWhileComposing.current = true; }
            if (e.key === 'Escape') { e.stopPropagation(); setTitle(''); setErr(null); onEscape?.(); }
          }}
          onCompositionEnd={() => { if (enterWhileComposing.current) { enterWhileComposing.current = false; setTimeout(() => submit(input.current?.value), 0); } }}
          className="min-w-0 flex-1 bg-transparent py-1 text-sm placeholder:text-ink-3 focus:outline-none" />
        {/* V11 4번: 음성은 입력칸 오른쪽 큰 마이크 버튼 */}
        <button type="button" onClick={voice} aria-label="음성으로 업무 추가" aria-pressed={listening} data-testid="voice-btn"
          className={cx('flex size-11 shrink-0 items-center justify-center rounded-full sm:size-9', listening ? 'animate-pulse bg-red-500 text-white' : 'bg-accent-50 text-accent-700 hover:bg-accent-100')}><Mic className="size-5" /></button>
        {title.trim() && <button type="submit" className="h-11 shrink-0 rounded-input bg-brand-600 px-4 text-sm font-semibold text-white shadow-card active:scale-95 sm:h-8 sm:px-3" data-testid="inline-save">{assignees.length > 1 ? `${assignees.length}명에게 각각 만들기` : '저장'}</button>}
        {busy && <span className="shrink-0 text-xs text-ink-3" data-testid="inline-saving">저장 중…</span>}
      </div>
      {showChips && (
        // V11 4번: 글자 있는 칩, 길면 2줄로 감김(가로 스크롤 없음)
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2 pl-12" data-testid="inline-chips">
          <span className="inline-flex items-center gap-1" title="지시자(업무를 부여한 사람)"><span className="text-[11px] text-ink-3">지시</span><AssigneePicker role="지시자" value={requester} onChange={back((v: string | null) => setRequester(v ?? user.id))} size={20} withName /></span>
          <DuePicker value={due} onChange={back(setDue)} label="새 업무 마감일" time={dueTime} onTime={setDueTime} emptyText="마감 없음" />
          <span className="inline-flex items-center gap-1"><span className="text-[11px] text-ink-3">담당</span><MultiAssigneePicker values={assignees} onChange={setAssignees} /></span>
          <RepeatChip value={rrule} anchorDate={due} onChange={back(setRrule)} />
          <BellChip value={remind} onChange={setRemind} />
          <PriorityPicker value={priority} onChange={back(setPriority)} />
          {proj && <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs" data-testid="inline-project">#{proj.name}<button type="button" aria-label="프로젝트 빼기" onClick={() => setProj(null)}>×</button></span>}
        </div>
      )}
      {parsed && parsed.matched.length > 0 && (
        <p className="mx-3 mb-2 ml-12 inline-flex items-center gap-1.5 text-xs text-accent-700" data-testid="nl-apply">
          <Sparkles className="size-3.5" />자동 인식: {parsed.matched.join(' · ')} — 칩에 반영, 저장하면 제목은 “{parsed.title}”
        </p>
      )}
      {err && <p className="px-3 pb-2 pl-12 text-xs font-medium text-red-600" role="alert">{err} — 입력한 내용은 그대로 있습니다. 저장(Enter)을 다시 눌러 주세요.</p>}
    </form>
  );
}

/** 방금 추가한 업무: 목록에 나타날 때 2초 강조 */
const freshIds = new Map<string, number>();
export function markNew(id: string) { freshIds.set(id, Date.now()); }
export function isFresh(id: string) { const t = freshIds.get(id); return !!t && Date.now() - t < 4000; }

const PRI: [string, string, string][] = [['urgent', '긴급', 'bg-red-50 text-red-700 ring-red-200'], ['high', '높음', 'bg-orange-50 text-orange-700 ring-orange-200'], ['normal', '보통', 'bg-slate-50 text-ink-2 ring-slate-200'], ['low', '낮음', 'bg-sky-50 text-sky-700 ring-sky-200']];
/** 우선순위 칩: 눌러서 긴급·높음·보통·낮음 */
export function PriorityPicker({ value, onChange, label = '우선순위' }: { value: string | null | undefined; onChange: (v: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const cur = PRI.find((p) => p[0] === (value ?? 'normal')) ?? PRI[2];
  return (
    <span className="relative inline-flex">
      <button ref={ref} type="button" onClick={(e) => { e.stopPropagation(); setOpen(!open); }} onPointerDown={(e) => e.stopPropagation()} aria-label={`${label}: ${cur[1]}`} aria-haspopup="dialog" aria-expanded={open} data-testid="priority-picker"
        className={cx('inline-flex h-6 items-center rounded-full px-2 text-xs font-medium ring-1 ring-inset', cur[0] === 'normal' ? 'bg-transparent text-ink-3 ring-transparent hover:bg-slate-100' : cur[2])}>
        {cur[0] === 'normal' ? '보통' : cur[1]}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} width={140}>
        {PRI.map(([k, l, c]) => (
          <button key={k} type="button" onClick={() => { onChange(k); setOpen(false); }} className="flex w-full items-center justify-between rounded-input px-2.5 py-1.5 text-left text-sm hover:bg-slate-50">
            <span className={cx('rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', c)}>{l}</span>{k === (value ?? 'normal') && <Check className="size-4 text-accent-600" />}
          </button>
        ))}
      </Popover>
    </span>
  );
}

/** 휴대폰 순서 메뉴: 맨 위로 · 위로 · 아래로 · 맨 아래로 (손잡이 끌기가 어려운 화면용) */
export function OrderMenu({ title, onMove }: { title: string; onMove: (to: 'top' | 'up' | 'down' | 'bottom') => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <span className="relative inline-flex sm:hidden">
      <button ref={ref} type="button" onClick={(e) => { e.stopPropagation(); setOpen(!open); }} onTouchStart={(e) => e.stopPropagation()} aria-label={`${title} 순서 바꾸기`} aria-haspopup="dialog" aria-expanded={open} data-testid="order-menu"
        className="inline-flex size-9 items-center justify-center rounded-full text-ink-3 active:bg-slate-100"><ArrowUpDown className="size-4" /></button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} width={150}>
        {([['top', '맨 위로'], ['up', '위로'], ['down', '아래로'], ['bottom', '맨 아래로']] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => { onMove(k); setOpen(false); }} className="flex w-full items-center rounded-input px-3 py-2.5 text-left text-sm hover:bg-slate-50">{l}</button>
        ))}
      </Popover>
    </span>
  );
}
