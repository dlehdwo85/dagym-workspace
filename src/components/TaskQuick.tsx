'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Check, Plus, UserRound, X } from 'lucide-react';
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
export function DuePicker({ value, onChange, status, label = '마감일', compact }: { value: string | null | undefined; onChange: (v: string | null) => void; status?: string; label?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <span className="relative inline-flex">
      <button ref={ref} type="button" onClick={(e) => { e.stopPropagation(); setOpen(!open); }} onPointerDown={(e) => e.stopPropagation()} aria-label={label} aria-haspopup="dialog" data-testid="due-picker"
        className={cx('inline-flex items-center rounded-md hover:bg-slate-100', !value && 'gap-1 px-1.5 py-0.5 text-xs text-ink-3')}>
        {value ? <DueChip due={value} status={status} /> : <><CalendarDays className="size-3.5" />{compact ? '' : '마감일'}</>}
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

/** 담당자 칩: 아바타를 누르면 사람 선택 */
export function AssigneePicker({ value, name, onChange, size = 24 }: { value: string | null | undefined; name?: string | null; onChange: (id: string | null) => void; size?: number }) {
  const { dir, user } = useSession();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const people = [...dir.users].sort((a, b) => (a.id === user.id ? -1 : b.id === user.id ? 1 : a.name.localeCompare(b.name, 'ko')));
  const shown = people.filter((u) => !q || u.name.includes(q));
  const cur = dir.users.find((u) => u.id === value);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <span className="relative inline-flex">
      <button ref={ref} type="button" onClick={(e) => { e.stopPropagation(); setOpen(!open); setQ(''); }} onPointerDown={(e) => e.stopPropagation()} aria-label={`담당자: ${cur?.name ?? name ?? '없음'}`} aria-haspopup="dialog" className="rounded-full hover:ring-2 hover:ring-accent-500/30" data-testid="assignee-picker">
        <Avatar id={value} name={cur?.name ?? name ?? null} size={size} />
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
        {value && <button type="button" onClick={() => { onChange(null); setOpen(false); }} className="flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-left text-sm text-ink-2 hover:bg-slate-50"><UserRound className="size-4" />담당자 없음</button>}
      </Popover>
    </span>
  );
}

/**
 * Asana 형 한 줄 업무 추가: 제목 입력 → Enter 로 즉시 생성(담당 = 나), 연속 입력.
 * 같은 줄의 담당자·마감일 칩으로 바로 지정. 관리자 최종 확인은 기본 꺼짐, 소속은 프로젝트/내 소속(본사)으로 자동.
 */
export function InlineAddTask({ projectId, sectionId, defaultDue, onCreated, placeholder = '업무 추가 — 제목 입력 후 Enter' }: {
  projectId?: string; sectionId?: string | null; defaultDue?: string | null; onCreated?: (id: string) => void; placeholder?: string;
}) {
  const { user } = useSession();
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState<string | null>(user.id);
  const [due, setDue] = useState<string | null>(defaultDue ?? null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function submit() {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const r = await api('/api/tasks', { body: { title: t, assigneeId: assignee, dueDate: due, projectId: projectId ?? null, sectionId: sectionId ?? null, approvalRequired: false }, queueOffline: `업무 등록: ${t}` });
      setTitle(''); broadcastRefresh(); onCreated?.(r.id);
    } catch (e: any) { if (e.code === 'queued') { toast.info(e.message); setTitle(''); } else toast.error(e.message); }
    finally { setBusy(false); input.current?.focus(); }
  }
  return (
    <div className="flex min-h-[44px] items-center gap-3 border-b border-line bg-white px-3 py-1.5 last:border-b-0" data-testid="inline-add">
      <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed border-slate-300 text-slate-400"><Plus className="size-3.5" /></span>
      <input ref={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={placeholder} aria-label="업무 추가 제목" maxLength={200}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } if (e.key === 'Escape') setTitle(''); }}
        className="min-w-0 flex-1 bg-transparent py-1 text-sm placeholder:text-ink-3 focus:outline-none" />
      {(title || due || assignee !== user.id) && (
        <>
          <DuePicker value={due} onChange={setDue} label="새 업무 마감일" />
          <AssigneePicker value={assignee} onChange={setAssignee} />
        </>
      )}
    </div>
  );
}
