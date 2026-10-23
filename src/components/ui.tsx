'use client';
import clsx from 'clsx';
import { useSheetBack } from './backClose';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CalendarDays, CheckCircle2, Flag, Inbox, Info, Loader2, Lock, RotateCw, UserRound, X, type LucideIcon } from 'lucide-react';
import { STATUS_LABEL, PRIORITY_LABEL, type TaskStatus, type Priority } from '@/lib/types';

export const cx = clsx;

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
/** 버튼 모양(링크 <a> 에도 같은 모양을 쓰려고 분리) — 대표(10/19): 누를 수 있는 연결 = 주 버튼(초록), 보조 = 테두리, 준비 중 = 회색 비활성 */
export function btnCls(variant: BtnVariant = 'primary', size: 'sm' | 'md' = 'md', className?: string) {
  return clsx(
    'inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-input font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-1 [&_svg]:size-4',
    size === 'sm' ? 'h-8 px-2.5 text-sm' : 'h-9 px-3.5 text-sm',
    variant === 'primary' && 'bg-brand-600 text-white shadow-card hover:bg-brand-700 active:bg-brand-800',
    variant === 'accent' && 'bg-accent-600 text-white shadow-card hover:bg-accent-700',
    variant === 'secondary' && 'border border-line bg-white text-slate-800 shadow-card hover:bg-slate-50 active:bg-slate-100',
    variant === 'ghost' && 'text-slate-700 hover:bg-slate-100 active:bg-slate-200',
    variant === 'danger' && 'bg-red-600 text-white shadow-card hover:bg-red-700',
    className,
  );
}
/** 준비 중·심사 대기: 회색 비활성 버튼 + 이유 한 줄 */
export function PendingButton({ label, reason, testId }: { label: string; reason: string; testId?: string }) {
  return (
    <span className="inline-flex flex-col items-start gap-0.5" data-testid={testId}>
      <button type="button" disabled aria-disabled className="inline-flex h-8 cursor-not-allowed items-center rounded-input bg-slate-100 px-2.5 text-sm font-medium text-slate-400">{label}</button>
      <span className="text-[11px] text-ink-3">{reason}</span>
    </span>
  );
}
export function Button({ variant = 'primary', size = 'md', className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' }) {
  return (
    <button
      {...p}
      className={btnCls(variant, size, className)}
    />
  );
}

/** 아이콘만 있는 버튼 (aria-label 필수) */
export function IconButton({ className, label, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button {...p} aria-label={label} title={label}
    className={clsx('inline-flex size-8 shrink-0 items-center justify-center rounded-input text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-accent-500 [&_svg]:size-[18px]', className)} />;
}

export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={clsx('min-w-0 rounded-card border border-line bg-white shadow-card', className)}>{children}</div>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-slate-50 px-1.5 py-px font-sans text-[10px] font-medium text-slate-500">{children}</kbd>;
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full rounded-input border border-slate-300 bg-white px-3 py-2 text-sm text-ink placeholder:text-slate-400 transition-colors hover:border-slate-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20 disabled:bg-slate-50';

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useSheetBack(open, onClose); // V14 39번: 앱 뒤로 버튼은 열린 시트부터 닫는다
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  // 로컬 실기기 83: 열린 동안 업무 상세의 고정 댓글 입력줄을 숨김(시트 버튼 줄을 가리지 않게)
  useEffect(() => {
    if (!open) return;
    document.body.classList.add('modal-open');
    return () => { setTimeout(() => { if (!document.querySelector('[data-modal-root]')) document.body.classList.remove('modal-open'); }, 0); };
  }, [open]);
  if (!open || typeof document === 'undefined') return null;
  // body 로 띄움: 업무 상세 패널(transform) 안에서 fixed·z-index 가 갇혀 스크롤이 안 되고 댓글 입력줄 아래로 깔리던 문제
  return createPortal(
    <div data-modal-root className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-[1px] sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className={clsx('max-h-[calc(100dvh-var(--sat)-12px)] sm:max-h-[92vh] w-full animate-fade-up overflow-y-auto overscroll-contain rounded-t-2xl bg-white shadow-pop sm:rounded-card', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-200 sm:hidden" aria-hidden />
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <IconButton label="닫기" onClick={onClose}><X /></IconButton>
        </div>
        <div className="p-5 pb-[calc(var(--sab)+20px)] sm:pb-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

type ToastAction = { label: string; run: () => void };
type ToastMsg = { id: number; text: string; kind: 'ok' | 'error' | 'info'; action?: ToastAction };
let pushToast: (t: Omit<ToastMsg, 'id'>) => void = () => {};
/** 저장·이동·완료 피드백. action 을 주면 "되돌리기" 같은 버튼이 붙는다 */
export const toast = {
  ok: (text: string, action?: ToastAction) => pushToast({ text, kind: 'ok', action }),
  error: (text: string) => pushToast({ text, kind: 'error' }),
  info: (text: string, action?: ToastAction) => pushToast({ text, kind: 'info', action }),
};
export function Toaster() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  // 로컬 10/23(#508 확인): 버튼 있는 안내([완료됨 보기]·[되돌리기])는 8초, 마우스를 올리거나 손가락을 대면 멈춤(떼면 3초 뒤 닫힘)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const close = (id: number) => { clearTimeout(timers.current.get(id)); timers.current.delete(id); setItems((x) => x.filter((i) => i.id !== id)); };
  const arm = (id: number, ms: number) => { clearTimeout(timers.current.get(id)); timers.current.set(id, setTimeout(() => close(id), ms)); };
  useEffect(() => {
    pushToast = (t) => {
      const id = Date.now() + Math.random();
      // 3개를 넘으면 버튼 없는 안내부터 뺀다(버튼 있는 안내가 뒤 안내에 밀려 바로 사라지지 않게)
      setItems((x) => { const n = [...x, { ...t, id }]; while (n.length > 3) { const k = n.findIndex((i) => !i.action); const [gone] = n.splice(k >= 0 && k < n.length - 1 ? k : 0, 1); clearTimeout(timers.current.get(gone.id)); timers.current.delete(gone.id); } return n; });
      arm(id, t.kind === 'error' ? 6000 : t.action ? 8000 : 3000);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="pointer-events-none fixed bottom-[calc(6rem+var(--toast-lift,0px))] left-0 right-0 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:left-auto sm:right-6 sm:items-end" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} onMouseEnter={() => clearTimeout(timers.current.get(t.id))} onMouseLeave={() => arm(t.id, 3000)} onTouchStart={() => clearTimeout(timers.current.get(t.id))} onTouchEnd={() => arm(t.id, 3000)}
          className="pointer-events-auto flex max-w-md animate-fade-up items-center gap-3 rounded-card bg-slate-900 py-2.5 pl-3.5 pr-2 text-sm text-white shadow-pop" data-testid="toast">
          {t.kind === 'ok' ? <CheckCircle2 className="size-4 shrink-0 text-green-400" /> : t.kind === 'error' ? <AlertCircle className="size-4 shrink-0 text-red-400" /> : <Info className="size-4 shrink-0 text-sky-300" />}
          <span className="min-w-0 flex-1">{t.text}</span>
          {t.action && <button className="rounded px-2 py-1 font-semibold text-sky-300 hover:bg-white/10" onClick={() => { t.action!.run(); close(t.id); }}>{t.action.label}</button>}
          <button className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="알림 닫기" onClick={() => close(t.id)}><X className="size-3.5" /></button>
        </div>
      ))}
    </div>
  );
}

/** 상태 색 — 배지·보드 열 머리·타임라인 막대 공통 */
export const STATUS_TONE: Record<TaskStatus, { badge: string; dot: string; bar: string }> = {
  todo: { badge: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400', bar: '#94a3b8' },
  in_progress: { badge: 'bg-blue-50 text-blue-700', dot: 'bg-blue-500', bar: '#3b82f6' },
  review: { badge: 'bg-violet-50 text-violet-700', dot: 'bg-violet-500', bar: '#8b5cf6' },
  on_hold: { badge: 'bg-orange-50 text-orange-700', dot: 'bg-orange-500', bar: '#f97316' },
  done: { badge: 'bg-green-50 text-green-700', dot: 'bg-green-500', bar: '#22c55e' },
};
export function StatusBadge({ status }: { status: TaskStatus }) {
  const t = STATUS_TONE[status];
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', t.badge)}>
      <span className={clsx('size-1.5 rounded-full', t.dot)} aria-hidden />{STATUS_LABEL[status]}
    </span>
  );
}
const PRIO_COLOR: Record<Priority, string> = { low: 'text-slate-400', normal: 'text-slate-300', high: 'text-orange-500', urgent: 'text-red-600' };
/** 우선순위 깃발. 보통은 표시하지 않는다 */
export function PriorityTag({ p, label = true }: { p: Priority; label?: boolean }) {
  if (p === 'normal') return null;
  return (
    <span className={clsx('inline-flex items-center gap-0.5 whitespace-nowrap text-xs font-medium', PRIO_COLOR[p])} title={`우선순위 ${PRIORITY_LABEL[p]}`}>
      <Flag className="size-3.5" fill={p === 'low' ? 'none' : 'currentColor'} aria-hidden />{label && PRIORITY_LABEL[p]}
    </span>
  );
}
export const BRAND_TONE: Record<string, { name: string; dot: string; chip: string; hex: string }> = {
  dagym: { name: '다짐', dot: 'bg-orange-500', chip: 'bg-orange-50 text-orange-700', hex: '#f97316' },
  hilink: { name: '하이링크', dot: 'bg-blue-600', chip: 'bg-blue-50 text-blue-700', hex: '#2563eb' },
  bodylab: { name: 'BODY LAB', dot: 'bg-green-600', chip: 'bg-green-50 text-green-700', hex: '#16a34a' },
};
export function BrandDot({ brand }: { brand: string | null }) {
  if (!brand) return null;
  const b = BRAND_TONE[brand] ?? BRAND_TONE.bodylab;
  return <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-ink-2"><span className={clsx('size-2 rounded-full', b.dot)} />{b.name}</span>;
}

/** 사람 아바타: 이름 해시로 8색 중 하나, 이니셜(한글은 성 빼고 이름 앞 두 글자) */
const AVATAR_BG = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#4f46e5', '#b45309'];
export function avatarColor(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_BG[h % AVATAR_BG.length];
}
export function initials(name: string) {
  const n = name.trim();
  if (!n) return '?';
  if (/^[가-힣]+$/.test(n)) return n.length >= 3 ? n.slice(1, 3) : n.slice(-2);
  const parts = n.split(/\s+/);
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}
/** V14 24번: 직책 약칭(없으면 직책) — 한 번 받아 두고 모든 아바타가 같이 쓴다 */
let badgeCache: Record<string, string> | null = null;
let badgeLoading = false;
const badgeSubs = new Set<() => void>();
function loadBadges() {
  if (badgeLoading || badgeCache) return;
  badgeLoading = true;
  fetch('/api/people/badges').then((r) => (r.ok ? r.json() : { people: {} })).catch(() => ({ people: {} }))
    .then((j) => { badgeCache = j.people ?? {}; badgeLoading = false; badgeSubs.forEach((f) => f()); });
}
export function refreshBadges() { badgeCache = null; badgeLoading = false; loadBadges(); }
/** V35 2·V36 1 근무 상태(휴가·출장·외근·미팅) — 5분마다 새로 받음. 근무 중은 점 없음 */
type Pres = { s: 'leave' | 'trip' | 'out' | 'before' | 'done'; label: string; until: string };
let presCache: Record<string, Pres> | null = null;
let presAt = 0;
let presLoading = false;
const presSubs = new Set<() => void>();
function loadPresence() {
  if (presLoading || (presCache && Date.now() - presAt < 5 * 60000)) return;
  presLoading = true;
  fetch('/api/people/presence').then((r) => (r.ok ? r.json() : { people: {} })).catch(() => ({ people: {} }))
    .then((j) => { presCache = j.people ?? {}; presAt = Date.now(); presLoading = false; presSubs.forEach((f) => f()); });
}
export function usePresence(id: string | null | undefined): Pres | null {
  const [, force] = useState(0);
  useEffect(() => {
    if (!id) return;
    const f = () => force((x) => x + 1);
    presSubs.add(f);
    loadPresence();
    return () => { presSubs.delete(f); };
  }, [id]);
  const p = id ? presCache?.[id] ?? null : null;
  return p && new Date(p.until).getTime() > Date.now() ? p : null;
}
export const PRESENCE_DOT = { leave: 'bg-slate-400', trip: 'bg-sky-500', out: 'bg-sky-500', before: 'bg-white border border-slate-400', done: 'bg-slate-200 border border-slate-400' } as const; // V30 ③ 출근 전·퇴근은 빈 점
function useBadge(id: string | null | undefined) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!id) return;
    const f = () => force((x) => x + 1);
    badgeSubs.add(f);
    loadBadges();
    return () => { badgeSubs.delete(f); };
  }, [id]);
  return id ? badgeCache?.[id] ?? null : null;
}

export function Avatar({ name, id, size = 24, className, ring, badge = true }: { name: string | null | undefined; id?: string | null; size?: number; className?: string; ring?: boolean; badge?: boolean }) {
  const label = useBadge(badge && !ring && name ? id : null);
  const pres = usePresence(name ? id : null);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!name) {
    return <span className={clsx('inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 text-slate-300', className)} style={{ width: size, height: size }} title="담당자 없음"><UserRound style={{ width: size * 0.6, height: size * 0.6 }} /></span>;
  }
  const dot = (
    <span title={label ? undefined : name} aria-label={name} className={clsx('inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white', ring && 'ring-2 ring-white', !label && className)}
      style={{ width: size, height: size, background: avatarColor(id ?? name), fontSize: Math.max(9, Math.round(size * 0.4)) }}>
      {initials(name)}
    </span>
  );
  // 근무 상태 점(오른쪽 아래) — 휴가 회색, 출장·외근·미팅 파랑
  const withPres = pres ? (
    <span className={clsx('relative inline-flex shrink-0', !label && className)} title={`${name} · ${pres.label}`} data-presence={pres.s}>
      {dot}<span className={clsx('absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-white', PRESENCE_DOT[pres.s])} style={{ width: Math.max(7, Math.round(size * 0.32)), height: Math.max(7, Math.round(size * 0.32)) }} aria-label={pres.label} />
    </span>
  ) : dot;
  if (!label) return withPres;
  const end = () => { if (press.current) clearTimeout(press.current); press.current = null; };
  return (
    <span className={clsx('inline-flex min-w-0 shrink-0 items-center gap-1', className)} title={`${name} · ${label}`} data-testid="avatar-badge"
      onTouchStart={() => { end(); press.current = setTimeout(() => toast.info(`${name} · ${label}`), 500); }} onTouchEnd={end} onTouchMove={end}>
      {withPres}<span className="max-w-[4.5rem] truncate text-[10px] font-medium leading-none text-ink-3">{label}</span>
    </span>
  );
}
export function AvatarStack({ people, max = 3, size = 22 }: { people: { id?: string; name: string }[]; max?: number; size?: number }) {
  return (
    <span className="inline-flex items-center -space-x-1.5">
      {people.slice(0, max).map((p, i) => <Avatar key={p.id ?? i} id={p.id} name={p.name} size={size} ring />)}
      {people.length > max && <span className="inline-flex items-center justify-center rounded-full bg-slate-200 text-[10px] font-semibold text-slate-600 ring-2 ring-white" style={{ width: size, height: size }}>+{people.length - max}</span>}
    </span>
  );
}

/** 마감일 칩: 지남=빨강, 오늘=파랑, 3일 이내=주황 */
export function DueChip({ due, status, time, className }: { due: string | null | undefined; status?: string; time?: string | null; className?: string }) {
  if (!due) return null;
  const t = todayStr();
  const days = Math.round((Date.parse(due) - Date.parse(t)) / 86400000);
  const done = status === 'done';
  const tone = done ? 'text-slate-400' : days < 0 ? 'bg-red-50 text-red-700' : days === 0 ? 'bg-blue-50 text-blue-700' : days <= 3 ? 'bg-orange-50 text-orange-700' : 'text-ink-2';
  // 로컬 10/22(#427): 기한 지남은 '· n일 지남'이 붙어 길어지므로 날짜를 숫자(10/21)로 짧게
  const [, mm, dd] = due.split('-').map(Number);
  const label = days === 0 ? '오늘' : days === 1 ? '내일' : !done && days < 0 && Number(due.slice(0, 4)) === new Date().getFullYear() ? `${mm}/${dd}` : fmtShort(due);
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums', tone, className)}
      title={`마감 ${fmtDate(due)}${!done && days < 0 ? ` · ${-days}일 지남` : ''}`}>
      <CalendarDays className="size-3.5 opacity-70" aria-hidden />{label}{time ? ` ${time.slice(0, 5)}` : ''}{!done && days < 0 && <span className="font-semibold lg:max-xl:hidden"> · {-days}일 지남</span>}
    </span>
  );
}

export function Loading({ label = '불러오는 중…' }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-2" role="status"><Loader2 className="size-4 animate-spin text-brand-500" />{label}</div>;
}
/** 첫 로딩용 자리 표시 (행 n개) */
export function Skeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={clsx('space-y-2', className)} role="status" aria-label="불러오는 중">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-input bg-white px-3 py-2.5">
          <span className="skeleton size-5 rounded-full" /><span className="skeleton h-3.5 rounded" style={{ width: `${40 + ((i * 37) % 45)}%` }} />
          <span className="ml-auto skeleton h-5 w-14 rounded-full" /><span className="skeleton size-6 rounded-full" />
        </div>
      ))}
    </div>
  );
}
/** 빈 화면: 아이콘 + 설명 + 다음 행동 */
export function Empty({ title, children, icon: Icon = Inbox, action }: { title: string; children?: ReactNode; icon?: LucideIcon; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center">
      <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-500"><Icon className="size-6" /></span>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-ink-2">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
export function ErrorBox({ error, retry }: { error: { status?: number; message: string } | null; retry?: () => void }) {
  if (!error) return null;
  const denied = error.status === 403 || error.status === 404;
  return (
    <div className={clsx('flex gap-3 rounded-card border p-4 text-sm', denied ? 'border-line bg-slate-50' : 'border-red-200 bg-red-50')} role="alert">
      {denied ? <Lock className="mt-0.5 size-5 shrink-0 text-slate-400" /> : <AlertCircle className="mt-0.5 size-5 shrink-0 text-red-500" />}
      <div>
        <p className="font-semibold">{denied ? (error.status === 403 ? '접근 권한이 없습니다' : '찾을 수 없거나 접근 권한이 없습니다') : '불러오지 못했습니다'}</p>
        <p className="mt-1 text-ink-2">{error.message}</p>
        {retry && !denied && <Button variant="secondary" size="sm" className="mt-3" onClick={retry}><RotateCw />다시 시도</Button>}
      </div>
    </div>
  );
}

/** 화면 제목 줄 */
export function PageHeader({ title, sub, actions, icon: Icon }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon && <span className="flex size-9 items-center justify-center rounded-input bg-brand-50 text-brand-600"><Icon className="size-5" /></span>}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight text-ink">{title}</h1>
          {sub && <p className="mt-0.5 text-sm text-ink-2">{sub}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day));
  const w = '일월화수목금토'[dt.getUTCDay()];
  const thisYear = new Date().getFullYear() === y;
  return `${thisYear ? '' : y + '. '}${m}. ${day}. (${w})`;
}
export function fmtDateTime(iso: string | Date) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
/** S-4 시간 표기 통일: "10. 14. (수) 오후 2:00~3:00", 오전/오후가 바뀌면 "오전 11:00~오후 1:00", 날짜가 바뀌면 날짜도 */
export function fmtTime(d: Date | string) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' }).format(new Date(d));
}
export function fmtTimeRange(start: Date | string, end: Date | string, opts: { allDay?: boolean; withDate?: boolean } = {}) {
  const sd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(start));
  const edRaw = new Date(new Date(end).getTime() - (opts.allDay ? 1 : 0));
  const ed = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(edRaw);
  if (opts.allDay) return sd === ed ? `${fmtDate(sd)} 종일` : `${fmtDate(sd)} ~ ${fmtDate(ed)} 종일`;
  const a = fmtTime(start), b = fmtTime(end);
  const sameMer = a.slice(0, 2) === b.slice(0, 2);
  const range = sd === ed ? `${a}~${sameMer ? b.slice(3) : b}` : `${a} ~ ${fmtDate(ed)} ${b}`;
  return opts.withDate === false ? range : `${fmtDate(sd)} ${range}`;
}
export function fmtMinutes(m: number | null | undefined) {
  if (m === null || m === undefined) return '';
  const h = Math.floor(m / 60), mm = m % 60;
  return h ? `${h}시간${mm ? ` ${mm}분` : ''}` : `${mm}분`;
}
export function fmtShort(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date().getFullYear() === y ? `${m}월 ${day}일` : `${String(y).slice(2)}.${m}.${day}`;
}
export function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}
export function dueClass(due: string | null, status: string) {
  if (!due || status === 'done') return 'text-slate-500';
  const t = todayStr();
  if (due < t) return 'text-red-600 font-medium';
  if (due === t) return 'text-orange-600 font-medium';
  return 'text-slate-600';
}

/** V13 13번: 사람 표시 "김민수 · 본부장" (직책 없으면 이름만) */
export const personLabel = (u: { name: string; title?: string | null } | null | undefined) => (u ? `${u.name}${u.title ? ` · ${u.title}` : ''}` : '');
