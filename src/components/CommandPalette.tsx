'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './client';
import { StatusBadge, cx, fmtDate, fmtDateTime } from './ui';

type Item = { key: string; label: string; sub?: string; href?: string; run?: () => void; group: string; badge?: React.ReactNode };

/** B-4 빠른 검색·명령 (Ctrl+K / ⌘K). 결과는 서버가 권한 범위로 거른다 */
export function CommandPalette({ open, onClose, onQuickAdd }: { open: boolean; onClose: () => void; onQuickAdd: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<any>(null);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setQ(''); setRes(null); setSel(0); setTimeout(() => input.current?.focus(), 10); } }, [open]);
  useEffect(() => {
    if (!open || !q.trim()) { setRes(null); return; }
    const t = setTimeout(() => api(`/api/search?q=${encodeURIComponent(q.trim())}`).then(setRes).catch(() => setRes(null)), 180);
    return () => clearTimeout(t);
  }, [q, open]);

  const items = useMemo<Item[]>(() => {
    const commands: Item[] = [
      { key: 'c-new', label: '업무 만들기', group: '명령', run: onQuickAdd },
      { key: 'c-today', label: '캘린더 — 오늘로 이동', group: '명령', href: '/calendar' },
      { key: 'c-my', label: '내 업무 보기', group: '명령', href: '/tasks?view=my' },
      { key: 'c-overdue', label: '지연 업무 보기', group: '명령', href: '/tasks?view=overdue' },
      { key: 'c-review', label: '검토 대기 보기', group: '명령', href: '/tasks?view=review' },
      { key: 'c-noti', label: '알림 열기', group: '명령', href: '/notifications' },
    ];
    const term = q.trim().toLowerCase();
    const cmd = commands.filter((c) => !term || c.label.toLowerCase().includes(term));
    if (!res) return cmd;
    return [
      ...res.tasks.map((t: any) => ({ key: 't' + t.id, label: t.title, sub: `${t.org_unit_name}${t.due_date ? ' · 마감 ' + fmtDate(t.due_date) : ''}`, href: `/tasks/${t.id}`, group: '업무', badge: <StatusBadge status={t.status} /> })),
      ...res.projects.map((p: any) => ({ key: 'p' + p.id, label: p.name, href: `/projects/${p.id}`, group: '프로젝트' })),
      ...res.events.map((e: any) => ({ key: 'e' + e.id, label: e.title, sub: fmtDateTime(e.start_at), href: `/calendar?event=${e.id}`, group: '일정' })),
      ...res.people.map((u: any) => ({ key: 'u' + u.id, label: u.name, sub: u.title ?? '', href: `/tasks?assigneeId=${u.id}`, group: '사람 (담당 업무 보기)' })),
      ...cmd,
    ];
  }, [res, q, onQuickAdd]);

  function go(it: Item) {
    onClose();
    if (it.run) it.run(); else if (it.href) router.push(it.href);
  }
  if (!open) return null;
  let lastGroup = '';
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 p-4 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label="빠른 검색" className="w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl">
        <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} placeholder="업무·프로젝트·일정·사람 검색 또는 명령"
          className="w-full border-b px-4 py-3 text-base outline-none" aria-label="빠른 검색어" data-testid="palette-input"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            if (e.key === 'Enter' && items[sel]) { e.preventDefault(); go(items[sel]); }
            if (e.key === 'Escape') onClose();
          }} />
        <ul className="max-h-[60vh] overflow-y-auto py-1" data-testid="palette-results">
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? (lastGroup = it.group) : null;
            return (
              <li key={it.key}>
                {head && <div className="px-4 pb-1 pt-2 text-[11px] font-semibold text-slate-400">{head}</div>}
                <button onMouseEnter={() => setSel(i)} onClick={() => go(it)} className={cx('flex w-full items-center gap-2 px-4 py-2 text-left text-sm', i === sel && 'bg-brand-50')}>
                  <span className="min-w-0 flex-1"><span className="block truncate">{it.label}</span>{it.sub && <span className="block truncate text-xs text-slate-500">{it.sub}</span>}</span>
                  {it.badge}
                </button>
              </li>
            );
          })}
          {res && !res.tasks.length && !res.projects.length && !res.events.length && !res.people.length && <li className="px-4 py-3 text-sm text-slate-500">검색 결과가 없습니다 (볼 수 있는 범위 안에서만 찾습니다)</li>}
        </ul>
        <div className="border-t px-4 py-1.5 text-[11px] text-slate-400">↑↓ 이동 · Enter 열기 · Esc 닫기</div>
      </div>
    </div>
  );
}
