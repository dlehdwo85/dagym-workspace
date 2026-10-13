'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ArrowUpDown, CalendarDays, Check, Plus, Repeat, UserRound, X } from 'lucide-react';
import { recurPresets } from './pickers';
import { api, broadcastRefresh } from './client';
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

/** 작은 떠 있는 창: 문서 맨 위(포털)에 고정 위치로 띄워 목록 행의 overflow 에 잘리지 않게. 바깥 클릭·Esc 로 닫힘 */
function Popover({ open, onClose, anchor, children, width = 224 }: { open: boolean; onClose: () => void; anchor: React.RefObject<HTMLElement | null>; children: React.ReactNode; width?: number }) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  useEffect(() => {
    if (!open) { setPos(null); return; }
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width));
    const below = window.innerHeight - r.bottom > 280;
    setPos(below ? { left, top: r.bottom + 4 } : { left, bottom: window.innerHeight - r.top + 4 });
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [open, onClose, anchor, width]);
  if (!open || !pos || typeof document === 'undefined') return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-[70]" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div role="dialog" className="fixed z-[71] animate-fade-up rounded-card border border-line bg-white p-1 shadow-pop" style={{ ...pos, width }} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>{children}</div>
    </>,
    document.body,
  );
}

/** 마감일 칩: 누르면 빠른 선택 + 날짜 선택 */
export function DuePicker({ value, onChange, status, label = '마감일', compact, emptyText }: { value: string | null | undefined; onChange: (v: string | null) => void; status?: string; label?: string; compact?: boolean; emptyText?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <span className="relative inline-flex">
      <button ref={ref} type="button" onClick={(e) => { e.stopPropagation(); setOpen(!open); }} onPointerDown={(e) => e.stopPropagation()} aria-label={label} aria-haspopup="dialog" aria-expanded={open} data-testid="due-picker"
        className={cx('inline-flex items-center rounded-md hover:bg-slate-100', !value && 'gap-1 px-1.5 py-0.5 text-xs text-ink-3', !value && emptyText && 'h-8 rounded-input border border-line bg-white px-2.5 text-sm')}>
        {value ? <DueChip due={value} status={status} /> : <><CalendarDays className="size-3.5" />{compact ? '' : emptyText ?? '마감일'}</>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref}>
        {quickDues().map(([l, d]) => (
          <button key={l} type="button" onClick={() => { onChange(d); setOpen(false); }} className="flex w-full items-center justify-between rounded-input px-2.5 py-1.5 text-left text-sm hover:bg-slate-50">
            <span>{l}</span><span className="text-xs text-ink-3 tabular-nums">{Number(d.slice(5, 7))}/{Number(d.slice(8))}</span>
          </button>
        ))}
        <label className="flex items-center gap-2 px-2.5 py-1.5 text-sm"><span className="shrink-0 text-ink-2">날짜</span>
          <input type="date" className="min-w-0 flex-1 rounded border border-line px-1.5 py-0.5 text-sm" value={value ?? ''} onChange={(e) => { onChange(e.target.value || null); setOpen(false); }} aria-label={`${label} 날짜 선택`} />
        </label>
        {value && <button type="button" onClick={() => { onChange(null); setOpen(false); }} className="flex w-full items-center gap-1.5 rounded-input px-2.5 py-1.5 text-left text-sm text-ink-2 hover:bg-slate-50"><X className="size-3.5" />마감일 지우기</button>}
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
  const shown = people.filter((u) => !q || u.name.includes(q));
  const cur = dir.users.find((u) => u.id === value);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <span className="relative inline-flex">
      <button ref={ref} type="button" onClick={(e) => { e.stopPropagation(); setOpen(!open); setQ(''); }} onPointerDown={(e) => e.stopPropagation()} aria-label={`${role}: ${cur?.name ?? name ?? '없음'}`} aria-haspopup="dialog" aria-expanded={open}
        className={withName ? 'inline-flex max-w-full items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2 text-xs text-ink-2 hover:bg-slate-100' : 'rounded-full hover:ring-2 hover:ring-accent-500/30'} data-testid={role === '지시자' ? 'requester-picker' : 'assignee-picker'}>
        <Avatar id={value} name={cur?.name ?? name ?? null} size={size} />{withName && <span className="truncate">{cur?.name ?? name ?? '없음'}</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref}>
        <input autoFocus className="mb-1 w-full rounded-input border border-line px-2 py-1 text-sm" placeholder="이름 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="담당자 검색" />
        <div className="max-h-60 overflow-y-auto">
          {shown.map((u) => (
            <button key={u.id} type="button" onClick={() => { onChange(u.id); setOpen(false); }} className="flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-left text-sm hover:bg-slate-50">
              <Avatar id={u.id} name={u.name} size={22} /><span className="flex-1">{u.name}{u.id === user.id ? ' (나)' : ''}</span>{u.id === value && <Check className="size-4 text-accent-600" />}
            </button>
          ))}
        </div>
        {value && role === '담당자' && <button type="button" onClick={() => { onChange(null); setOpen(false); }} className="flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-left text-sm text-ink-2 hover:bg-slate-50"><UserRound className="size-4" />담당자 없음</button>}
      </Popover>
    </span>
  );
}

/** V5 반복 칩: 안 함·매일·평일·매주·매월… (반복은 마감일 기준 — 마감이 없으면 오늘을 마감으로) */
export function RepeatChip({ value, anchorDate, onChange }: { value: string | null; anchorDate: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const presets = recurPresets(anchorDate ?? todayStr());
  const cur = presets.find((p) => p.rule === value);
  return (
    <span className="relative inline-flex">
      <button ref={ref} type="button" onClick={(e) => { e.stopPropagation(); setOpen(!open); }} onPointerDown={(e) => e.stopPropagation()} aria-label={`반복: ${value ? cur?.label ?? '사용자 지정' : '안 함'}`} aria-haspopup="dialog" aria-expanded={open} data-testid="repeat-chip"
        className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs hover:bg-slate-100', value ? 'font-medium text-accent-700' : 'text-ink-3')}>
        <Repeat className="size-3.5" />{value ? cur?.label ?? '반복' : ''}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref}>
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
  const [assignee, setAssignee] = useState<string | null>(initAssignee);
  const [due, setDue] = useState<string | null>(defaultDue ?? null);
  const initRequester = defaultRequester ?? user.id;
  const [requester, setRequester] = useState<string | null>(initRequester);
  const [rrule, setRrule] = useState<string | null>(null);
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
      const r = await api('/api/tasks', { body: { title: t, assigneeId: assignee, requestedById: requester ?? user.id, dueDate: keepRrule && !due ? todayStr() : due, recurrenceRule: keepRrule, projectId: projectId ?? null, sectionId: sectionId ?? null, approvalRequired: false } });
      markNew(r.id);
      const who = assignee ? (assignee === user.id ? '나' : `${dir.users.find((u) => u.id === assignee)?.name ?? ''}님`) : '담당자 없이';
      toast.ok(`${who}에게 추가됨: ${t}`, { label: '보기', run: () => router.push(`/tasks/${r.id}`) });
      broadcastRefresh(); onCreated?.(r.id);
    } catch (e: any) {
      // 저장 실패: 입력값을 되살리고 이유를 줄 아래에 표시 (조용히 사라지지 않게)
      setTitle((cur) => cur || t); setRrule(keepRrule);
      setErr(e.message ?? '저장하지 못했습니다');
    } finally { busyRef.current = false; setBusy(false); if (refocus) input.current?.focus(); }
  }
  const showChips = !!(title || due || rrule || assignee !== initAssignee || requester !== initRequester || autoFocus);
  // 업무 "생성"은 저장 버튼·Enter 로만 (WORKIN_SAVE_AND_SPEED, 대표 지시). 바깥을 눌러도 저장하지 않고 입력한 초안은 남긴다.
  // 칩(마감·담당·지시·반복)을 고른 뒤에는 입력칸으로 돌아온다
  const back = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setTimeout(() => input.current?.focus(), 0); };
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
        {showChips && (
          <>
            <span className="hidden sm:inline-flex" title="지시자(업무를 부여한 사람)"><span className="self-center text-[11px] text-ink-3">지시</span><AssigneePicker role="지시자" value={requester} onChange={back((v: string | null) => setRequester(v ?? user.id))} size={20} withName /></span>
            <DuePicker value={due} onChange={back(setDue)} label="새 업무 마감일" />
            <AssigneePicker value={assignee} onChange={back(setAssignee)} />
            <RepeatChip value={rrule} anchorDate={due} onChange={back(setRrule)} />
          </>
        )}
        {title.trim() && <button type="submit" className="h-11 shrink-0 rounded-input bg-brand-600 px-4 text-sm font-semibold text-white shadow-card active:scale-95 sm:h-8 sm:px-3" data-testid="inline-save">저장</button>}
        {busy && <span className="shrink-0 text-xs text-ink-3" data-testid="inline-saving">저장 중…</span>}
      </div>
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
