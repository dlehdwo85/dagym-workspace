'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity, BarChart3, Bell, CalendarHeart, FileBarChart, Gauge, CalendarDays, CalendarPlus, ChevronDown, CircleCheck, FolderKanban, FolderPlus, House, Keyboard, LayoutTemplate,
  ListTodo, LogOut, Network, QrCode, Stamp, Workflow, PanelLeftClose, PanelLeftOpen, Plus, ScrollText, Search, Settings, SquarePen, Star, Users, X,
  type LucideIcon,
} from 'lucide-react';
import { SessionCtx, canManage, isAdminRole, type Sess } from './session';
import { api, flushOutbox, useOutboxCount, broadcastRefresh, useApi } from './client';
import { Avatar, Kbd, Modal, Toaster, toast, cx } from './ui';
import { ROLE_LABEL } from '@/lib/types';
import { initNative } from './native';
import { QuickAddTask } from './QuickAddTask';
import { CommandPalette } from './CommandPalette';

type NavItem = { href: string; label: string; icon: LucideIcon; desktopOnly?: boolean };
const NAV: NavItem[] = [
  { href: '/', label: '홈', icon: House },
  { href: '/tasks?view=my', label: '내 업무', icon: CircleCheck },
  { href: '/tasks', label: '전체 업무', icon: ListTodo, desktopOnly: true },
  { href: '/projects', label: '프로젝트', icon: FolderKanban, desktopOnly: true },
  { href: '/calendar', label: '캘린더', icon: CalendarDays },
  { href: '/notifications', label: '알림', icon: Bell },
  { href: '/templates', label: '템플릿', icon: LayoutTemplate, desktopOnly: true },
];
const MANAGE_NAV: NavItem[] = [
  { href: '/insights', label: '현장 비교', icon: BarChart3 },
  { href: '/workload', label: '업무량', icon: Gauge },
  { href: '/forms', label: '현장 신고 QR', icon: QrCode },
  { href: '/automations', label: '자동화', icon: Workflow },
];
const ADMIN_NAV: NavItem[] = [
  { href: '/admin/users', label: '사용자·권한', icon: Users },
  { href: '/reports', label: '주간 보고', icon: FileBarChart },
  { href: '/admin/approvals', label: '결재선', icon: Stamp },
  { href: '/admin/holidays', label: '공휴일', icon: CalendarHeart },
  { href: '/admin/org', label: '조직 구성', icon: Network },
  { href: '/admin/audit', label: '감사 기록', icon: ScrollText },
  { href: '/admin/ops', label: '운영 상태', icon: Activity },
];
const SHORTCUTS: [string, string][] = [
  ['Ctrl K', '검색·명령 열기'], ['N', '새 업무 만들기'], ['?', '단축키 도움말'], ['Esc', '패널·창 닫기'],
  ['G 다음 H', '홈'], ['G 다음 M', '내 업무'], ['G 다음 C', '캘린더'],
  ['S', '(업무 상세) 하위 업무 추가'], ['C', '(업무 상세) 댓글 쓰기'], ['D · W · M · A', '(캘린더) 일 · 주 · 월 · 일정목록'], ['T', '(캘린더) 오늘로'],
];

function readPref(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function writePref(k: string, v: string) { try { localStorage.setItem(k, v); } catch {} }

export function AppShell({ session, children }: { session: Sess; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [online, setOnline] = useState(true);
  const [more, setMore] = useState(false);
  const [quick, setQuick] = useState(false);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [createMenu, setCreateMenu] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [adminOpen, setAdminOpen] = useState(true);
  const [search, setSearch] = useState('');
  useEffect(() => { setCollapsed(readPref('wos_nav_collapsed') === '1'); setAdminOpen(readPref('wos_nav_admin') !== '0'); }, []);
  const pending = useOutboxCount();
  const admin = isAdminRole(session.user.role);
  const favs = useApi<{ projects: { id: string; name: string; color: string; favorite: boolean }[] }>('/api/projects');
  const favorites = (favs.data?.projects ?? []).filter((p) => p.favorite);

  // 단축키: Ctrl K, N, ?, g h / g m / g c
  const gPressed = useRef(0);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); return; }
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || document.querySelector('[role=dialog]')) return;
      if (e.key === '?') { e.preventDefault(); setHelp(true); return; }
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setQuick(true); return; }
      if (e.key === 'g') { gPressed.current = Date.now(); return; }
      if (Date.now() - gPressed.current < 1200) {
        const to = { h: '/', m: '/tasks?view=my', c: '/calendar' }[e.key];
        if (to) { e.preventDefault(); router.push(to); }
        gPressed.current = 0;
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [router]);

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
  const reloadFavs = favs.reload;
  useEffect(() => { const h = () => reloadFavs(); window.addEventListener('wos-favorites', h); return () => window.removeEventListener('wos-favorites', h); }, [reloadFavs]);
  useEffect(() => { setCreateMenu(false); setUserMenu(false); setMore(false); }, [path]);

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
  const toggleCollapsed = () => setCollapsed((c) => { writePref('wos_nav_collapsed', c ? '0' : '1'); return !c; });
  const create = (what: 'task' | 'event' | 'project') => {
    setCreateMenu(false);
    if (what === 'task') setQuick(true);
    else router.push(what === 'event' ? '/calendar?new=1' : '/projects?new=1');
  };

  const navLink = (n: NavItem, badge?: number) => {
    const on = active(n.href);
    return (
      <Link key={n.href} href={n.href} title={collapsed ? n.label : undefined}
        className={cx('group flex h-9 items-center gap-2.5 rounded-input px-2.5 text-sm transition-colors', on ? 'bg-white/10 font-semibold text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white', collapsed && 'justify-center px-0')}>
        <n.icon className={cx('size-[18px] shrink-0', on ? 'text-white' : 'text-slate-400 group-hover:text-slate-200')} aria-hidden />
        {!collapsed && <span className="flex-1 truncate">{n.label}</span>}
        {!!badge && <span className={cx('rounded-full bg-red-500 text-[10px] font-semibold leading-4 text-white tabular-nums', collapsed ? 'absolute ml-5 -mt-5 px-1' : 'px-1.5')}>{badge > 99 ? '99+' : badge}</span>}
      </Link>
    );
  };

  return (
    <SessionCtx.Provider value={session}>
      <div className="min-h-screen bg-canvas text-ink sm:flex">
        {/* 사이드바 (데스크톱) */}
        <aside className={cx('hidden shrink-0 flex-col bg-brand-800 text-white transition-[width] duration-150 sm:sticky sm:top-0 sm:flex sm:h-screen', collapsed ? 'w-[60px]' : 'w-60')} aria-label="사이드바">
          <div className={cx('flex h-14 items-center gap-2.5 px-4', collapsed && 'justify-center px-0')}>
            <img src="/icon-192.png" alt="" className="size-7 rounded-md" />
            {!collapsed && <div className="min-w-0 leading-tight"><div className="truncate text-sm font-bold">업무·일정</div><div className="truncate text-[11px] text-slate-400">다짐 · 하이링크 · BODY LAB</div></div>}
          </div>
          <nav className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto px-2 pb-3" aria-label="주 메뉴">
            {NAV.map((n) => navLink(n, n.href === '/notifications' ? unread : undefined))}
            {!collapsed && (
              <div className="pt-5">
                <div className="flex items-center gap-1.5 px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><Star className="size-3" />즐겨찾는 프로젝트</div>
                {favorites.length ? favorites.map((p) => (
                  <Link key={p.id} href={`/projects/${p.id}`} className={cx('flex h-8 items-center gap-2.5 rounded-input px-2.5 text-sm', path === `/projects/${p.id}` ? 'bg-white/10 font-semibold text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white')}>
                    <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} /><span className="truncate">{p.name}</span>
                  </Link>
                )) : <p className="px-2.5 py-1 text-xs text-slate-500">프로젝트 화면에서 ☆ 를 누르면 여기에 고정됩니다</p>}
              </div>
            )}
            {canManage(session.user.role) && (
              <div className="pt-5">
                {!collapsed && <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">현장 운영</div>}
                {MANAGE_NAV.map((n) => navLink(n))}
              </div>
            )}
            {admin && (
              <div className="pt-5">
                {!collapsed && (
                  <button onClick={() => setAdminOpen((o) => { writePref('wos_nav_admin', o ? '0' : '1'); return !o; })}
                    className="flex w-full items-center gap-1 px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200" aria-expanded={adminOpen}>
                    관리자<ChevronDown className={cx('size-3 transition-transform', !adminOpen && '-rotate-90')} />
                  </button>
                )}
                {(adminOpen || collapsed) && ADMIN_NAV.map((n) => navLink(n))}
              </div>
            )}
          </nav>
          <div className={cx('border-t border-white/10 p-2', collapsed && 'flex justify-center')}>
            <button onClick={toggleCollapsed} className={cx('flex h-8 items-center gap-2 rounded-input px-2.5 text-xs text-slate-400 hover:bg-white/5 hover:text-white', !collapsed && 'w-full')} aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}>
              {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" />사이드바 접기</>}
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1 pb-24 sm:pb-0">
          {/* 상단 바 (데스크톱) */}
          <header className="sticky top-0 z-30 hidden h-14 items-center gap-3 border-b border-line bg-white/90 px-5 backdrop-blur sm:flex">
            <button onClick={() => setPalette(true)} data-testid="open-palette"
              className="mx-auto flex h-9 w-full max-w-md items-center gap-2 rounded-input border border-line bg-canvas px-3 text-sm text-ink-3 transition-colors hover:border-slate-300 hover:bg-white">
              <Search className="size-4" /><span className="flex-1 text-left">업무·프로젝트·사람·일정 검색</span><Kbd>Ctrl K</Kbd>
            </button>
            <div className="relative">
              <button onClick={() => setCreateMenu((v) => !v)} aria-haspopup="menu" aria-expanded={createMenu} data-testid="create-menu"
                className="inline-flex h-9 items-center gap-1.5 rounded-input bg-brand-600 px-3.5 text-sm font-semibold text-white shadow-card hover:bg-brand-700">
                <Plus className="size-4" />만들기
              </button>
              {createMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setCreateMenu(false)} />
                  <div role="menu" className="absolute right-0 z-50 mt-1.5 w-52 animate-fade-up rounded-card border border-line bg-white p-1 shadow-pop">
                    {([['task', '업무', SquarePen, 'N'], ['event', '일정', CalendarPlus, ''], ['project', '프로젝트', FolderPlus, '']] as const).map(([k, l, I, key]) => (
                      (k !== 'project' || session.user.role !== 'staff') && (
                        <button key={k} role="menuitem" onClick={() => create(k)} className="flex w-full items-center gap-2.5 rounded-input px-2.5 py-2 text-sm hover:bg-slate-50">
                          <I className="size-4 text-ink-2" /><span className="flex-1 text-left">{l}</span>{key && <Kbd>{key}</Kbd>}
                        </button>
                      )
                    ))}
                  </div>
                </>
              )}
            </div>
            <Link href="/notifications" aria-label={`알림${unread ? ` ${unread}건` : ''}`} className="relative inline-flex size-9 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100">
              <Bell className="size-[18px]" />{unread > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">{unread > 99 ? '99+' : unread}</span>}
            </Link>
            <div className="relative">
              <button onClick={() => setUserMenu((v) => !v)} aria-haspopup="menu" aria-expanded={userMenu} aria-label="내 계정 메뉴" className="flex items-center gap-2 rounded-full p-0.5 pr-2 hover:bg-slate-100">
                <Avatar id={session.user.id} name={session.user.name} size={30} /><ChevronDown className="size-3.5 text-ink-3" />
              </button>
              {userMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenu(false)} />
                  <div role="menu" className="absolute right-0 z-50 mt-1.5 w-60 animate-fade-up rounded-card border border-line bg-white p-1 shadow-pop">
                    <div className="flex items-center gap-2.5 px-2.5 py-2.5">
                      <Avatar id={session.user.id} name={session.user.name} size={36} />
                      <div className="min-w-0"><div className="truncate text-sm font-semibold">{session.user.name}</div><div className="truncate text-xs text-ink-2">{ROLE_LABEL[session.user.role]} · {session.user.email}</div></div>
                    </div>
                    <div className="my-1 border-t border-line" />
                    <Link role="menuitem" href="/settings" className="flex items-center gap-2.5 rounded-input px-2.5 py-2 text-sm hover:bg-slate-50"><Settings className="size-4 text-ink-2" />설정·알림</Link>
                    <button role="menuitem" onClick={() => { setUserMenu(false); setHelp(true); }} className="flex w-full items-center gap-2.5 rounded-input px-2.5 py-2 text-sm hover:bg-slate-50"><Keyboard className="size-4 text-ink-2" /><span className="flex-1 text-left">단축키</span><Kbd>?</Kbd></button>
                    <button role="menuitem" onClick={logout} className="flex w-full items-center gap-2.5 rounded-input px-2.5 py-2 text-sm text-red-600 hover:bg-red-50"><LogOut className="size-4" />로그아웃</button>
                  </div>
                </>
              )}
            </div>
          </header>

          {(!online || pending > 0) && (
            <div className={cx('px-4 py-1.5 text-center text-xs', online ? 'bg-amber-100 text-amber-900' : 'bg-slate-800 text-white')} role="status">
              {online ? `전송 대기 ${pending}건 — 다시 보내는 중` : `오프라인 상태입니다${pending ? ` · 전송 대기 ${pending}건` : ''}. 연결되면 자동 전송합니다.`}
            </div>
          )}
          {/* 상단 바 (모바일) */}
          <header className="sticky top-0 z-30 flex h-12 items-center justify-between border-b border-line bg-white/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur sm:hidden">
            <span className="flex items-center gap-2 text-sm font-bold text-brand-700"><img src="/icon-192.png" alt="" className="size-6 rounded" />업무·일정</span>
            <span className="flex items-center gap-1">
              <button onClick={() => setPalette(true)} className="inline-flex size-9 items-center justify-center rounded-full text-ink-2 active:bg-slate-100" aria-label="검색"><Search className="size-5" /></button>
              <button onClick={() => setMore(true)} className="inline-flex size-9 items-center justify-center rounded-full active:bg-slate-100" aria-label="메뉴 더보기"><Avatar id={session.user.id} name={session.user.name} size={28} /></button>
            </span>
          </header>
          <main className="mx-auto max-w-7xl p-3 sm:p-6">{children}</main>
        </div>

        {/* 하단 탭 (모바일): 홈 · 내 업무 · [+] · 캘린더 · 알림 */}
        <nav className="fixed bottom-0 left-0 right-0 z-40 grid grid-cols-5 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden" aria-label="하단 메뉴">
          {NAV.filter((n) => !n.desktopOnly).slice(0, 2).map((n) => <TabLink key={n.href} n={n} on={active(n.href)} />)}
          <div className="flex items-center justify-center">
            <button onClick={() => setQuick(true)} aria-label="업무 등록" className="-mt-5 flex size-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-pop ring-4 ring-white active:scale-95">
              <Plus className="size-7" />
            </button>
          </div>
          {NAV.filter((n) => !n.desktopOnly).slice(2).map((n) => <TabLink key={n.href} n={n} on={active(n.href)} badge={n.href === '/notifications' ? unread : 0} />)}
        </nav>

        {more && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 sm:hidden" onClick={() => setMore(false)}>
            <div className="absolute bottom-0 left-0 right-0 animate-fade-up rounded-t-2xl bg-white p-3 pb-[calc(env(safe-area-inset-bottom)+16px)]" onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-200" />
              <div className="flex items-center gap-3 px-3 py-2">
                <Avatar id={session.user.id} name={session.user.name} size={40} />
                <div className="min-w-0 flex-1"><div className="font-semibold">{session.user.name}</div><div className="truncate text-xs text-ink-2">{ROLE_LABEL[session.user.role]} · {session.user.email}</div></div>
                <button onClick={() => setMore(false)} className="rounded-full p-2 text-ink-3" aria-label="닫기"><X className="size-5" /></button>
              </div>
              <div className="my-1 border-t border-line" />
              {([['/tasks', '전체 업무', ListTodo], ['/projects', '프로젝트', FolderKanban], ['/templates', '템플릿', LayoutTemplate], ['/settings', '설정·알림', Settings],
                ...(session.features.googleSync ? [['/settings/google', 'Google Calendar 연동(선택)', CalendarDays]] : []),
                ...(canManage(session.user.role) ? MANAGE_NAV.map((n) => [n.href, n.label, n.icon]) : []),
                ...(admin ? ADMIN_NAV.map((n) => [n.href, n.label, n.icon]) : [])] as [string, string, LucideIcon][]).map(([h, l, I]) => (
                <Link key={h} href={h} onClick={() => setMore(false)} className="flex items-center gap-3 rounded-input px-3 py-3 text-sm active:bg-slate-100"><I className="size-5 text-ink-2" />{l}</Link>
              ))}
              <button onClick={logout} className="flex w-full items-center gap-3 rounded-input px-3 py-3 text-left text-sm text-red-600 active:bg-red-50"><LogOut className="size-5" />로그아웃</button>
            </div>
          </div>
        )}
        <Modal open={help} onClose={() => setHelp(false)} title="단축키">
          <ul className="divide-y divide-line text-sm">
            {SHORTCUTS.map(([k, l]) => <li key={k} className="flex items-center justify-between py-2"><span>{l}</span><span className="flex gap-1">{k.split(' ').filter((x) => x !== '다음' && x !== '·').map((x) => <Kbd key={x}>{x}</Kbd>)}</span></li>)}
          </ul>
          <p className="mt-3 text-xs text-ink-2">업무 목록에서는 ↑↓ 로 이동하고 Enter 로 엽니다.</p>
        </Modal>
        <QuickAddTask open={quick} onClose={() => setQuick(false)} />
        <CommandPalette open={palette} onClose={() => setPalette(false)} onQuickAdd={() => setQuick(true)} />
        <Toaster />
      </div>
    </SessionCtx.Provider>
  );
}

function TabLink({ n, on, badge }: { n: NavItem; on: boolean; badge?: number }) {
  return (
    <Link href={n.href} className={cx('relative flex flex-col items-center gap-0.5 py-2 text-[11px]', on ? 'font-semibold text-brand-700' : 'text-ink-3')}>
      <n.icon className="size-[22px]" strokeWidth={on ? 2.3 : 1.8} aria-hidden />{n.label}
      {!!badge && <span className="absolute left-1/2 top-1 ml-2 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">{badge > 99 ? '99+' : badge}</span>}
    </Link>
  );
}
