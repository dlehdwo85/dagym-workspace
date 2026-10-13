'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity, BarChart3, Bell, CalendarClock, CalendarHeart, FileBarChart, Gauge, CalendarDays, CalendarPlus, ChevronDown, CircleCheck, FolderKanban, FolderPlus, House, Keyboard, LayoutTemplate,
  ListTodo, LogOut, Network, QrCode, Stamp, Workflow, PanelLeftClose, PanelLeftOpen, Plus, ScrollText, Search, Settings, SquarePen, Star, Users, X,
  type LucideIcon,
} from 'lucide-react';
import { SessionCtx, canManage, isAdminRole, type Sess } from './session';
import { api, flushOutbox, useOutboxCount, broadcastRefresh, useApi } from './client';
import { Avatar, Kbd, Modal, Toaster, toast, cx } from './ui';
import { ROLE_LABEL } from '@/lib/types';
import { enableNativePush, initNative } from './native';
import { QuickAddTask } from './QuickAddTask';
import { CommandPalette } from './CommandPalette';

type NavItem = { href: string; label: string; icon: LucideIcon };
/** 워크인(WORKIN_V2) 사이드바: 홈 · 업무(본사 전체) · 프로젝트 · 캘린더 · 알림 + 관리 묶음. 숨긴 화면(현장 신고 QR·자동화·현장 비교 등)은 코드·주소는 남겨 둔다 */
const NAV: NavItem[] = [
  { href: '/', label: '홈', icon: House },
  { href: '/tasks', label: '업무', icon: CircleCheck },
  { href: '/projects', label: '프로젝트', icon: FolderKanban },
  { href: '/calendar', label: '캘린더', icon: CalendarDays },
  { href: '/notifications', label: '알림', icon: Bell },
];
const MOBILE_TABS: NavItem[] = [NAV[0], NAV[1], NAV[3], NAV[4]];
/** 사이드바 "관리" 묶음 (대표·본사 관리자) */
const ADMIN_MENU: NavItem[] = [
  { href: '/reports', label: '주간 보고', icon: FileBarChart },
  { href: '/revenue', label: '매출', icon: BarChart3 },
  { href: '/admin/users', label: '사용자 관리', icon: Users },
  { href: '/admin/ops', label: '운영 상태', icon: Activity },
];
const SHORTCUTS: [string, string][] = [
  ['Ctrl K', '검색·명령 열기'], ['N', '새 업무 만들기'], ['?', '단축키 도움말'], ['Esc', '패널·창 닫기'],
  ['G 다음 H', '홈'], ['G 다음 M', '업무'], ['G 다음 C', '캘린더'],
  ['S', '(업무 상세) 하위 업무 추가'], ['D · W · M · A', '(캘린더) 일 · 주 · 월 · 일정목록'], ['T', '(캘린더) 오늘로'], ['C', '(캘린더) 새 일정'],
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
  const [pushAsk, setPushAsk] = useState(false);
  useEffect(() => { const h = () => setPushAsk(true); window.addEventListener('wos-push-ask', h); return () => window.removeEventListener('wos-push-ask', h); }, []);
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
        const to = { h: '/', m: '/tasks', c: '/calendar' }[e.key];
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
    return path.startsWith(p);
  };

  async function logout() {
    let pushEndpoint: string | undefined;
    try { pushEndpoint = localStorage.getItem('wos_push_endpoint') ?? undefined; } catch {}
    await api('/api/auth/logout', { body: { pushEndpoint } }).catch(() => {});
    location.href = '/login';
  }
  const toggleCollapsed = () => setCollapsed((c) => { writePref('wos_nav_collapsed', c ? '0' : '1'); return !c; });
  const [fabMenu, setFabMenu] = useState(false);
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
      <div className="app-shell min-h-screen bg-canvas text-ink sm:flex">
        {/* 사이드바 (데스크톱) */}
        <aside className={cx('hidden shrink-0 flex-col bg-brand-800 text-white transition-[width] duration-150 sm:sticky sm:top-0 sm:flex sm:h-screen', collapsed ? 'w-[60px]' : 'w-60')} aria-label="사이드바">
          <div className={cx('flex h-14 items-center gap-2.5 px-4', collapsed && 'justify-center px-0')}>
            <img src="/icon-192.png" alt="" className="size-7 rounded-md" />
            {!collapsed && <div className="min-w-0 leading-tight"><div className="truncate text-sm font-bold">워크인</div><div className="truncate text-[11px] text-slate-400">다짐 · 하이링크</div></div>}
          </div>
          <nav className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto px-2 pb-3" aria-label="주 메뉴">
            {NAV.map((n) => (
              <div key={n.href}>
                {navLink(n, n.href === '/notifications' ? unread : 0)}
                {/* 즐겨찾는 프로젝트는 "프로젝트" 바로 아래 */}
                {n.href === '/projects' && !collapsed && favorites.length > 0 && (
                  <div className="mb-1 ml-4 mt-0.5 space-y-0.5 border-l border-white/10 pl-2">
                    {favorites.map((p) => (
                      <Link key={p.id} href={`/projects/${p.id}`} className={cx('flex h-7 items-center gap-2 rounded-input px-2 text-[13px]', path === `/projects/${p.id}` ? 'bg-white/10 font-semibold text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white')}>
                        <span className="size-2 shrink-0 rounded-[3px]" style={{ background: p.color }} /><span className="truncate">{p.name}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {admin && (
              <div className="pt-3" data-testid="nav-admin">
                <div className="my-2 border-t border-white/10" />
                {!collapsed && <button onClick={() => setAdminOpen((v) => { writePref('wos_nav_admin', v ? '0' : '1'); return !v; })} aria-expanded={adminOpen}
                  className="flex w-full items-center gap-1 px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200">관리<ChevronDown className={cx('size-3 transition-transform', !adminOpen && '-rotate-90')} /></button>}
                {(adminOpen || collapsed) && ADMIN_MENU.map((n) => navLink(n))}
              </div>
            )}
          </nav>
          <div className={cx('border-t border-white/10 p-2', collapsed && 'flex justify-center')}>
            <button onClick={toggleCollapsed} className={cx('flex h-8 items-center gap-2 rounded-input px-2.5 text-xs text-slate-400 hover:bg-white/5 hover:text-white', !collapsed && 'w-full')} aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}>
              {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" />사이드바 접기</>}
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1 pb-[calc(6rem+var(--sab))] sm:pb-0">
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
                    {([['task', '업무', SquarePen, 'N'], ['event', '일정', CalendarPlus, '']] as const).map(([k, l, I, key]) => (
                      (
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
          {/* 머리줄은 상태바 높이만큼 아래로 (고정 높이 안에서 눌리지 않게 높이는 내용 줄에만) */}
          <header className="sticky top-0 z-30 border-b border-line bg-white/95 pt-[var(--sat)] backdrop-blur sm:hidden" data-testid="mobile-header">
            <div className="flex h-12 items-center justify-between px-3">
              <span className="flex items-center gap-2 text-[15px] font-bold text-brand-700"><img src="/icon-192.png" alt="" className="size-7 rounded" />워크인</span>
              <span className="flex items-center">
                <button onClick={() => setPalette(true)} className="inline-flex size-11 items-center justify-center rounded-full text-ink-2 active:bg-slate-100" aria-label="검색"><Search className="size-[22px]" /></button>
                <button onClick={() => setMore(true)} className="inline-flex size-11 items-center justify-center rounded-full active:bg-slate-100" aria-label="메뉴 더보기"><Avatar id={session.user.id} name={session.user.name} size={30} /></button>
              </span>
            </div>
          </header>
          <main className="mx-auto max-w-7xl p-3 sm:p-6">{children}</main>
        </div>

        {/* 하단 탭 (모바일): 홈 · 업무 · [+] · 캘린더 · 알림 */}
        <nav className="fixed bottom-0 left-0 right-0 z-40 grid grid-cols-5 border-t border-line bg-white/95 pb-[var(--sab)] backdrop-blur sm:hidden" aria-label="하단 메뉴">
          {MOBILE_TABS.slice(0, 2).map((n) => <TabLink key={n.href} n={n} on={active(n.href)} />)}
          <div className="flex items-center justify-center">
            <button onClick={() => setFabMenu(true)} aria-label="만들기" aria-haspopup="menu" aria-expanded={fabMenu} data-testid="fab" className="-mt-5 flex size-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-pop ring-4 ring-white active:scale-95">
              <Plus className="size-7" />
            </button>
          </div>
          {MOBILE_TABS.slice(2).map((n) => <TabLink key={n.href} n={n} on={active(n.href)} badge={n.href === '/notifications' ? unread : 0} />)}
        </nav>

        {/* + 버튼: 업무 · 일정 (V5) */}
        {fabMenu && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 sm:hidden" onClick={() => setFabMenu(false)}>
            <div role="menu" aria-label="만들기" className="absolute bottom-0 left-0 right-0 animate-fade-up rounded-t-2xl bg-white p-3 pb-[calc(var(--sab)+16px)]" onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" />
              <div className="grid grid-cols-2 gap-2">
                <button role="menuitem" onClick={() => { setFabMenu(false); setQuick(true); }} aria-label="업무 등록" className="flex flex-col items-center gap-1.5 rounded-card border border-line py-4 text-sm font-semibold active:bg-slate-50"><SquarePen className="size-6 text-brand-600" />업무</button>
                <button role="menuitem" onClick={() => { setFabMenu(false); router.push('/calendar?quick=1'); }} aria-label="일정 등록" className="flex flex-col items-center gap-1.5 rounded-card border border-line py-4 text-sm font-semibold active:bg-slate-50"><CalendarPlus className="size-6 text-emerald-600" />일정</button>
              </div>
            </div>
          </div>
        )}

        {more && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 sm:hidden" onClick={() => setMore(false)}>
            <div className="absolute bottom-0 left-0 right-0 animate-fade-up rounded-t-2xl bg-white p-3 pb-[calc(var(--sab)+16px)]" onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-200" />
              <div className="flex items-center gap-3 px-3 py-2">
                <Avatar id={session.user.id} name={session.user.name} size={40} />
                <div className="min-w-0 flex-1"><div className="font-semibold">{session.user.name}</div><div className="truncate text-xs text-ink-2">{ROLE_LABEL[session.user.role]} · {session.user.email}</div></div>
                <button onClick={() => setMore(false)} className="rounded-full p-2 text-ink-3" aria-label="닫기"><X className="size-5" /></button>
              </div>
              <div className="my-1 border-t border-line" />
              {([['/projects', '프로젝트', FolderKanban], ['/settings', '설정·알림', Settings],
                ...(session.features.googleSync ? [['/settings/google', 'Google Calendar 연동(선택)', CalendarDays]] : []),
                ...(admin ? ADMIN_MENU.map((n) => [n.href, n.label, n.icon]) : [])] as [string, string, LucideIcon][]).map(([h, l, I]) => (
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
        <Modal open={pushAsk} onClose={() => { try { localStorage.setItem('wos_push_asked', '1'); } catch {} setPushAsk(false); }} title="알림 받기">
          <div className="space-y-3 text-sm" data-testid="push-ask">
            <p>워크인은 다음 경우에 휴대폰으로 알려 드립니다. 앱이 닫혀 있어도 받을 수 있습니다.</p>
            <ul className="list-disc space-y-1 pl-5 text-ink-2">
              <li>일정 시작 전 (기본 30분 전, 설정·일정마다 변경)</li>
              <li>업무 배정 · 멘션 · 마감 임박 · 검토 요청</li>
            </ul>
            <p className="text-xs text-ink-3">알림을 누르면 해당 업무·일정 화면이 열립니다. 언제든 설정에서 끄거나 종류별로 고를 수 있습니다.</p>
            <div className="flex justify-end gap-2 pt-1">
              <button className="h-9 rounded-input px-3 text-sm text-ink-2 hover:bg-slate-100" onClick={() => { try { localStorage.setItem('wos_push_asked', '1'); } catch {} setPushAsk(false); }}>나중에</button>
              <button className="h-9 rounded-input bg-brand-600 px-4 text-sm font-semibold text-white" onClick={async () => { setPushAsk(false); try { await enableNativePush(); toast.ok('이 기기에서 알림을 받습니다'); } catch (e: any) { toast.error(e.message); } }}>알림 받기</button>
            </div>
          </div>
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
    <Link href={n.href} className={cx('relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 py-1.5 text-xs', on ? 'font-bold text-brand-700' : 'font-medium text-ink-2')}>
      <n.icon className="size-6" strokeWidth={on ? 2.4 : 1.8} aria-hidden />{n.label}
      {!!badge && <span className="absolute left-1/2 top-1 ml-2 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">{badge > 99 ? '99+' : badge}</span>}
    </Link>
  );
}
