'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { SessionCtx, isAdminRole, type Sess } from './session';
import { api, flushOutbox, useOutboxCount, broadcastRefresh } from './client';
import { Toaster, toast, cx } from './ui';
import { ROLE_LABEL } from '@/lib/types';
import { initNative } from './native';
import { QuickAddTask } from './QuickAddTask';
import { CommandPalette } from './CommandPalette';

const NAV = [
  { href: '/', label: '홈', icon: '⌂' },
  { href: '/tasks?view=my', label: '내 업무', icon: '☑' },
  { href: '/tasks', label: '전체 업무', icon: '☰', desktopOnly: true },
  { href: '/projects', label: '프로젝트', icon: '▦', desktopOnly: true },
  { href: '/calendar', label: '캘린더', icon: '▤' },
  { href: '/notifications', label: '알림', icon: '🔔' },
  { href: '/templates', label: '템플릿', icon: '❏', desktopOnly: true },
];

export function AppShell({ session, children }: { session: Sess; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [online, setOnline] = useState(true);
  const [more, setMore] = useState(false);
  const [quick, setQuick] = useState(false);
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const pending = useOutboxCount();
  const admin = isAdminRole(session.user.role);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try { const r = await api('/api/notifications?unread=1'); if (alive) setUnread(r.unread); } catch {}
    };
    poll();
    const t = setInterval(poll, 60_000);
    const onFocus = () => { poll(); };
    window.addEventListener('focus', onFocus);
    const sync = async () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) {
        const n = await flushOutbox();
        if (n) { toast.ok(`오프라인 중 저장한 ${n}건을 전송했습니다`); broadcastRefresh(); }
      }
    };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    let bc: BroadcastChannel | null = null;
    try { bc = new BroadcastChannel('wos'); bc.onmessage = () => window.dispatchEvent(new Event('wos-refresh')); } catch {}
    initNative(router).catch(() => {});
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    return () => { alive = false; clearInterval(t); window.removeEventListener('focus', onFocus); window.removeEventListener('online', sync); window.removeEventListener('offline', sync); bc?.close(); };
  }, [router]);

  const active = (href: string) => {
    const [p, q] = href.split('?');
    if (p === '/') return path === '/';
    if (q) return path === p && typeof window !== 'undefined' && window.location.search.includes(q);
    return path.startsWith(p) && !(p === '/tasks' && typeof window !== 'undefined' && window.location.search.includes('view=my'));
  };

  async function logout() {
    let pushEndpoint: string | undefined;
    try { pushEndpoint = localStorage.getItem('wos_push_endpoint') ?? undefined; } catch {}
    await api('/api/auth/logout', { body: { pushEndpoint } }).catch(() => {});
    location.href = '/login';
  }

  return (
    <SessionCtx.Provider value={session}>
      <div className="min-h-screen bg-slate-50 text-slate-900 sm:flex">
        <aside className="hidden w-56 shrink-0 flex-col border-r bg-white sm:flex sm:h-screen sm:sticky sm:top-0">
          <div className="border-b px-4 py-4">
            <div className="text-sm font-bold text-brand-700">업무·일정 관리</div>
            <div className="text-xs text-slate-500">다짐 · 하이링크 · BODY LAB</div>
          </div>
          <button onClick={() => setPalette(true)} className="mx-2 mt-2 flex items-center justify-between rounded-md border px-3 py-1.5 text-left text-sm text-slate-500 hover:bg-slate-50" data-testid="open-palette">
            <span>검색·명령</span><kbd className="rounded border bg-slate-50 px-1 text-[10px]">Ctrl K</kbd>
          </button>
          <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="주 메뉴">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={cx('flex items-center justify-between rounded-md px-3 py-2 text-sm', active(n.href) ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-700 hover:bg-slate-100')}>
                <span><span className="mr-2 inline-block w-4 text-center" aria-hidden>{n.icon}</span>{n.label}</span>
                {n.href === '/notifications' && unread > 0 && <span className="rounded-full bg-red-600 px-1.5 text-xs text-white">{unread}</span>}
              </Link>
            ))}
            {admin && (
              <div className="pt-3">
                <div className="px-3 pb-1 text-xs font-semibold text-slate-400">관리자</div>
                {[['/admin/users', '사용자·권한'], ['/admin/org', '조직 구성'], ['/admin/audit', '감사 기록'], ['/admin/ops', '운영 상태']].map(([h, l]) => (
                  <Link key={h} href={h} className={cx('block rounded-md px-3 py-2 text-sm', path.startsWith(h) ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-700 hover:bg-slate-100')}>{l}</Link>
                ))}
              </div>
            )}
          </nav>
          <div className="border-t p-3 text-sm">
            <Link href="/settings" className="block rounded-md px-2 py-1 hover:bg-slate-100">
              <div className="font-medium">{session.user.name}</div>
              <div className="text-xs text-slate-500">{ROLE_LABEL[session.user.role]} · 설정</div>
            </Link>
            <button onClick={logout} className="mt-1 w-full rounded-md px-2 py-1 text-left text-xs text-slate-500 hover:bg-slate-100">로그아웃</button>
          </div>
        </aside>

        <div className="min-w-0 flex-1 pb-20 sm:pb-0">
          {(!online || pending > 0) && (
            <div className={cx('px-4 py-1.5 text-center text-xs', online ? 'bg-amber-100 text-amber-900' : 'bg-slate-800 text-white')} role="status">
              {online ? `전송 대기 ${pending}건 — 다시 보내는 중` : `오프라인 상태입니다${pending ? ` · 전송 대기 ${pending}건` : ''}. 연결되면 자동 전송합니다.`}
            </div>
          )}
          <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-white/95 px-4 py-2.5 backdrop-blur sm:hidden">
            <span className="text-sm font-bold text-brand-700">업무·일정</span>
            <span className="flex items-center gap-3">
              <button onClick={() => setPalette(true)} className="text-lg text-slate-600" aria-label="검색">🔍</button>
              <button onClick={() => setMore(true)} className="text-sm text-slate-600" aria-label="메뉴 더보기">{session.user.name} ▾</button>
            </span>
          </header>
          <main className="mx-auto max-w-7xl p-3 sm:p-6">{children}</main>
        </div>

        <button onClick={() => setQuick(true)} aria-label="업무 등록"
          className="fixed bottom-20 right-4 z-40 h-14 w-14 rounded-full bg-brand-600 text-3xl leading-none text-white shadow-lg hover:bg-brand-700 sm:bottom-6 sm:right-6">+</button>

        <nav className="fixed bottom-0 left-0 right-0 z-40 grid grid-cols-5 border-t bg-white pb-[env(safe-area-inset-bottom)] sm:hidden" aria-label="하단 메뉴">
          {NAV.filter((n) => !n.desktopOnly).map((n) => (
            <Link key={n.href} href={n.href} className={cx('relative flex flex-col items-center py-2 text-[11px]', active(n.href) ? 'text-brand-700 font-semibold' : 'text-slate-500')}>
              <span className="text-lg leading-none" aria-hidden>{n.icon}</span>{n.label}
              {n.href === '/notifications' && unread > 0 && <span className="absolute right-4 top-1 rounded-full bg-red-600 px-1 text-[10px] text-white">{unread}</span>}
            </Link>
          ))}
          <button onClick={() => setMore(true)} className="flex flex-col items-center py-2 text-[11px] text-slate-500"><span className="text-lg leading-none">⋯</span>더보기</button>
        </nav>

        {more && (
          <div className="fixed inset-0 z-50 bg-black/40 sm:hidden" onClick={() => setMore(false)}>
            <div className="absolute bottom-0 left-0 right-0 rounded-t-xl bg-white p-3 pb-8" onClick={(e) => e.stopPropagation()}>
              {[['/tasks', '전체 업무'], ['/projects', '프로젝트'], ['/templates', '템플릿'], ['/settings', '설정·알림'], ...(session.features.googleSync ? [['/settings/google', 'Google Calendar 연동(선택)']] : []),
                ...(admin ? [['/admin/users', '사용자·권한'], ['/admin/org', '조직 구성'], ['/admin/audit', '감사 기록'], ['/admin/ops', '운영 상태']] : [])].map(([h, l]) => (
                <Link key={h} href={h} onClick={() => setMore(false)} className="block rounded-md px-3 py-3 text-sm hover:bg-slate-100">{l}</Link>
              ))}
              <button onClick={logout} className="block w-full rounded-md px-3 py-3 text-left text-sm text-red-700 hover:bg-slate-100">로그아웃</button>
            </div>
          </div>
        )}
        <QuickAddTask open={quick} onClose={() => setQuick(false)} />
        <CommandPalette open={palette} onClose={() => setPalette(false)} onQuickAdd={() => setQuick(true)} />
        <Toaster />
      </div>
    </SessionCtx.Provider>
  );
}
