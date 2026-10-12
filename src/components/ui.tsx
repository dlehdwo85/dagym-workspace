'use client';
import clsx from 'clsx';
import { useEffect, useState, type ReactNode } from 'react';
import { STATUS_LABEL, PRIORITY_LABEL, type TaskStatus, type Priority } from '@/lib/types';

export const cx = clsx;

export function Button({ variant = 'primary', size = 'md', className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' }) {
  return (
    <button
      {...p}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
        size === 'sm' ? 'px-2.5 py-1 text-sm' : 'px-3.5 py-2 text-sm',
        variant === 'primary' && 'bg-brand-600 text-white hover:bg-brand-700',
        variant === 'secondary' && 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
        variant === 'ghost' && 'text-slate-700 hover:bg-slate-100',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        className,
      )}
    />
  );
}

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputCls = 'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className={clsx('max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-white shadow-xl sm:rounded-xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-4 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="닫기">✕</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

type ToastMsg = { id: number; text: string; kind: 'ok' | 'error' | 'info' };
let pushToast: (t: Omit<ToastMsg, 'id'>) => void = () => {};
export const toast = {
  ok: (text: string) => pushToast({ text, kind: 'ok' }),
  error: (text: string) => pushToast({ text, kind: 'error' }),
  info: (text: string) => pushToast({ text, kind: 'info' }),
};
export function Toaster() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(() => {
    pushToast = (t) => {
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { ...t, id }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), t.kind === 'error' ? 6000 : 3000);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-20 left-0 right-0 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={clsx('pointer-events-auto max-w-md rounded-md px-4 py-2 text-sm text-white shadow-lg',
          t.kind === 'ok' && 'bg-emerald-700', t.kind === 'error' && 'bg-red-700', t.kind === 'info' && 'bg-slate-800')}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

const STATUS_COLOR: Record<TaskStatus, string> = {
  todo: 'bg-slate-100 text-slate-700', in_progress: 'bg-blue-100 text-blue-800', review: 'bg-amber-100 text-amber-800',
  on_hold: 'bg-zinc-200 text-zinc-700', done: 'bg-emerald-100 text-emerald-800',
};
export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={clsx('inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium', STATUS_COLOR[status])}>{STATUS_LABEL[status]}</span>;
}
const PRIO_COLOR: Record<Priority, string> = { low: 'text-slate-400', normal: 'text-slate-500', high: 'text-orange-600', urgent: 'text-red-600 font-semibold' };
export function PriorityTag({ p }: { p: Priority }) {
  if (p === 'normal') return null;
  return <span className={clsx('text-xs', PRIO_COLOR[p])}>{p === 'urgent' ? '●' : p === 'high' ? '▲' : '▽'} {PRIORITY_LABEL[p]}</span>;
}
export function BrandDot({ brand }: { brand: string | null }) {
  if (!brand) return null;
  const c = brand === 'dagym' ? 'bg-orange-500' : brand === 'hilink' ? 'bg-blue-600' : 'bg-emerald-600';
  const n = brand === 'dagym' ? '다짐' : brand === 'hilink' ? '하이링크' : 'BODY LAB';
  return <span className="inline-flex items-center gap-1 text-xs text-slate-600"><span className={clsx('h-2 w-2 rounded-full', c)} />{n}</span>;
}

export function Loading({ label = '불러오는 중…' }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500" role="status"><span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />{label}</div>;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 py-10 text-center"><p className="text-sm font-medium text-slate-700">{title}</p>{children && <div className="mt-2 text-sm text-slate-500">{children}</div>}</div>;
}
export function ErrorBox({ error, retry }: { error: { status?: number; message: string } | null; retry?: () => void }) {
  if (!error) return null;
  const denied = error.status === 403 || error.status === 404;
  return (
    <div className={clsx('rounded-lg border p-4 text-sm', denied ? 'border-slate-300 bg-slate-50' : 'border-red-200 bg-red-50')} role="alert">
      <p className="font-medium">{denied ? (error.status === 403 ? '접근 권한이 없습니다' : '찾을 수 없거나 접근 권한이 없습니다') : '불러오지 못했습니다'}</p>
      <p className="mt-1 text-slate-600">{error.message}</p>
      {retry && !denied && <Button variant="secondary" size="sm" className="mt-3" onClick={retry}>다시 시도</Button>}
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
