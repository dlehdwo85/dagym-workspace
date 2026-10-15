'use client';
import Link from 'next/link';
import { Suspense } from 'react';
import { AiDock } from './AiDock';
import { MessengerDock } from './MessengerDock';
import { VersionWatch } from './VersionWatch';
import { Onboarding } from './Onboarding';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity, BarChart3, Bell, CalendarClock, CalendarHeart, FileBarChart, FileText, Gauge, CalendarDays, CalendarPlus, ChevronDown, CircleCheck, FolderKanban, FolderPlus, House, Keyboard, LayoutTemplate,
  Building2, HelpCircle, ListTodo, Library, LogOut, Mic, Sparkles, Network, QrCode, Stamp, Workflow, PanelLeftClose, PanelLeftOpen, Plus, ScrollText, Search, Settings, SquarePen, Star, Users, X,
  type LucideIcon,
  MessageCircle, Mail,
} from 'lucide-react';
import { SessionCtx, canManage, isAdminRole, type Sess } from './session';
import { api, flushOutbox, useOutboxCount, broadcastRefresh, useApi } from './client';
import { Avatar, Kbd, Modal, Toaster, toast, cx } from './ui';
import { ROLE_LABEL } from '@/lib/types';
import { clearReminders, enableNativePush, initNative } from './native';
import { QuickAddTask } from './QuickAddTask';
import { CommandPalette } from './CommandPalette';
import { VoiceAddTask, openVoiceAdd } from './VoiceAddTask';

type NavItem = { href: string; label: string; icon: LucideIcon };
/** 워크인(WORKIN_V2) 사이드바: 홈 · 업무(본사 전체) · 프로젝트 · 캘린더 · 알림 + 관리 묶음. 숨긴 화면(현장 신고 QR·자동화·현장 비교 등)은 코드·주소는 남겨 둔다 */
const NAV: NavItem[] = [
  { href: '/', label: '홈', icon: House },
  { href: '/tasks', label: '업무', icon: CircleCheck },
  { href: '/projects', label: '프로젝트', icon: FolderKanban },
  { href: '/calendar', label: '캘린더', icon: CalendarDays },
  { href: '/messages', label: '메시지', icon: MessageCircle }, // V13 10번 사내 메신저
  { href: '/notifications', label: '알림', icon: Bell },
  { href: '/reports/mine', label: '내 주간 보고', icon: FileText },
];
const MOBILE_TABS: NavItem[] = [NAV[0], NAV[1], NAV[3], NAV[4]]; // V14 9번: 홈·업무·(+)·캘린더·메시지 — 알림은 상단 종
/** 사이드바 "관리" 묶음 (대표·본사 관리자) */
const ADMIN_MENU: NavItem[] = [
  { href: '/reports', label: '주간 보고', icon: FileBarChart },
  { href: '/revenue', label: '매출', icon: BarChart3 },
  { href: '/admin/users', label: '사용자 관리', icon: Users },
  { href: '/admin/ops', label: '운영 상태', icon: Activity },
  { href: '/admin/company', label: '회사 정보·디자인', icon: Building2 }, // V22
  { href: '/admin/mail', label: '메일 계정·명함', icon: Mail }, // V21
  { href: '/admin/usage', label: '사용량·요금제', icon: Gauge },
  { href: '/admin/ai-logs', label: 'AI 사용 내역', icon: Sparkles },
];
/** V14 7번: 관리 메뉴 ↔ 메뉴 권한 키 (꺼진 메뉴는 숨김) */
const ADMIN_KEY: Record<string, string> = { '/reports': 'team_reports', '/revenue': 'revenue', '/admin/users': 'admin_users', '/admin/ops': 'ops', '/admin/company': 'ops', '/admin/mail': 'mail_settings', '/admin/usage': 'usage', '/admin/ai-logs': 'ai_logs' };
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
  const [chatUnread, setChatUnread] = useState(0);
  const [aiDock, setAiDock] = useState(false); // V14 11번 모든 화면 AI 비서
  // 메시지 화면을 오가면 메시지 배지를 바로 새로
  useEffect(() => { api('/api/chat/unread').then((c) => setChatUnread(c.unread)).catch(() => {}); }, [path]);
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
  // V9: 자료실(체험 계정 제외) · AI 비서(플랫폼 API 키가 있을 때만)
  // V13 메뉴 권한: 매출·주간 보고는 권한 있는 사람만(관리 묶음이 없는 사람도 매출 권한이 있으면 주 메뉴에)
  const menus = session.menus ?? {};
  const adminMenu = ADMIN_MENU.filter((n) => (menus[ADMIN_KEY[n.href]] ?? 'none') !== 'none');
  const nav: NavItem[] = [...NAV, ...(!admin && (menus.revenue ?? 'none') !== 'none' ? [{ href: '/revenue', label: '매출', icon: BarChart3 }] : []), ...(session.features.library ? [{ href: '/library', label: '자료실', icon: Library }] : []),
    ...(session.features.ai ? [{ href: '/assistant', label: 'AI 비서', icon: Sparkles }] : [])];

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
      try { const c = await api('/api/chat/unread'); if (alive) setChatUnread(c.unread); } catch {}
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
    await clearReminders().catch(() => {});
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
        className={cx('group flex h-9 items-center gap-2.5 rounded-input px-2.5 text-sm transition-colors', on ? 'bg-brand-600 font-semibold text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-ink', collapsed && 'justify-center px-0')}>
        <n.icon className={cx('size-[18px] shrink-0', on ? 'text-white' : 'text-slate-400 group-hover:text-slate-600')} aria-hidden />
        {!collapsed && <span className="flex-1 truncate">{n.label}</span>}
        {!!badge && <span className={cx('rounded-full bg-red-500 text-[10px] font-semibold leading-4 text-white tabular-nums', collapsed ? 'absolute ml-5 -mt-5 px-1' : 'px-1.5')}>{badge > 99 ? '99+' : badge}</span>}
      </Link>
    );
  };

  return (
    <SessionCtx.Provider value={session}>
      <div className="app-shell min-h-screen bg-canvas text-ink sm:flex">
        {/* 사이드바 (데스크톱) */}
        <aside className={cx('hidden shrink-0 flex-col border-r border-line bg-white text-slate-700 transition-[width] duration-150 sm:sticky sm:top-0 sm:flex sm:h-screen', collapsed ? 'w-[60px]' : 'w-60')} aria-label="사이드바">
          <div className={cx('flex h-14 items-center gap-2.5 px-4', collapsed && 'justify-center px-0')}>
            <img src="/icon.svg" alt="" className="size-7" />
            {!collapsed && <div className="min-w-0 leading-tight"><div className="truncate text-sm font-bold text-ink">워크인</div><div className="truncate text-[11px] text-slate-500">{session.tenant?.name ?? '워크인'}</div></div>}
          </div>
          <nav className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto px-2 pb-3" aria-label="주 메뉴">
            {nav.map((n) => (
              <div key={n.href}>
                {navLink(n, n.href === '/notifications' ? unread : n.href === '/messages' ? chatUnread : 0)}
                {/* 즐겨찾는 프로젝트는 "프로젝트" 바로 아래 */}
                {n.href === '/projects' && !collapsed && favorites.length > 0 && (
                  <div className="mb-1 ml-4 mt-0.5 space-y-0.5 border-l border-line pl-2">
                    {favorites.map((p) => (
                      <Link key={p.id} href={`/projects/${p.id}`} className={cx('flex h-7 items-center gap-2 rounded-input px-2 text-[13px]', path === `/projects/${p.id}` ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-ink')}>
                        <span className="size-2 shrink-0 rounded-[3px]" style={{ background: p.color }} /><span className="truncate">{p.name}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {(adminMenu.length > 0 || session.user.platformAdmin) && (
              <div className="pt-3" data-testid="nav-admin">
                <div className="my-2 border-t border-line" />
                {!collapsed && <button onClick={() => setAdminOpen((v) => { writePref('wos_nav_admin', v ? '0' : '1'); return !v; })} aria-expanded={adminOpen}
                  className="flex w-full items-center gap-1 px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700">관리<ChevronDown className={cx('size-3 transition-transform', !adminOpen && '-rotate-90')} /></button>}
                {(adminOpen || collapsed) && [...adminMenu, ...(session.user.platformAdmin ? [{ href: '/platform', label: '플랫폼 운영', icon: Building2 }] : [])].map((n) => navLink(n))}
              </div>
            )}
          </nav>
          <div className={cx('border-t border-line p-2', collapsed && 'flex justify-center')}>
            <button onClick={toggleCollapsed} className={cx('flex h-8 items-center gap-2 rounded-input px-2.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-ink', !collapsed && 'w-full')} aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}>
              {collapsed ? <PanelLeftOpen className="size-4" /> : <><PanelLeftClose className="size-4" />사이드바 접기</>}
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1 pb-[calc(6rem+var(--sab))] sm:pb-0">
          {/* 상단 바 (데스크톱) */}
          <header className="sticky top-0 z-30 hidden h-14 items-center gap-3 border-b border-line bg-white/90 px-5 backdrop-blur sm:flex">
            <button onClick={() => setPalette(true)} data-testid="open-palette"
              className="mx-auto flex h-9 w-full max-w-md items-center gap-2 rounded-input border border-line bg-canvas px-3 text-sm text-ink-3 transition-colors hover:border-slate-300 hover:bg-white">
              <Search className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate text-left">{/* 점검 ⑧: 좁은 PC(768)에서 두 줄로 꺾이지 않게 */}<span className="lg:hidden">검색</span><span className="hidden lg:inline">업무·프로젝트·사람·일정 검색</span></span><span className="hidden lg:inline"><Kbd>Ctrl K</Kbd></span>
            </button>
            <div className="relative">
              <button onClick={() => setCreateMenu((v) => !v)} aria-haspopup="menu" aria-expanded={createMenu} data-testid="create-menu"
                className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-input bg-brand-600 px-3.5 text-sm font-semibold text-white shadow-card hover:bg-brand-700">
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
                    <Link role="menuitem" href="/help" className="flex items-center gap-2.5 rounded-input px-2.5 py-2 text-sm hover:bg-slate-50"><HelpCircle className="size-4 text-ink-2" />도움말·문의</Link>
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
              <span className="flex items-center gap-2 text-[15px] font-bold text-brand-700"><img src="/icon.svg" alt="" className="size-7" />워크인</span>
              <span className="flex items-center">
                <button onClick={() => setPalette(true)} className="inline-flex size-11 items-center justify-center rounded-full text-ink-2 active:bg-slate-100" aria-label="검색"><Search className="size-[22px]" /></button>
                {session.features.ai && <button onClick={() => setAiDock(true)} className="inline-flex size-11 items-center justify-center rounded-full text-violet-600 active:bg-violet-50" aria-label="AI 비서" data-testid="mobile-ai"><Sparkles className="size-[22px]" /></button>}
                <Link href="/notifications" className="relative inline-flex size-11 items-center justify-center rounded-full text-ink-2 active:bg-slate-100" aria-label={`알림${unread ? ` ${unread}건` : ''}`} data-testid="mobile-bell">
                  <Bell className="size-[22px]" />{unread > 0 && <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">{unread > 99 ? '99+' : unread}</span>}
                </Link>
                <button onClick={() => setMore(true)} className="inline-flex size-11 items-center justify-center rounded-full active:bg-slate-100" aria-label="메뉴 더보기"><Avatar id={session.user.id} name={session.user.name} size={30} /></button>
              </span>
            </div>
          </header>
          <main className="mx-auto max-w-7xl p-3 sm:p-6 sm:pb-24">{children}</main>{/* 점검 ⑧: PC 오른쪽 아래 떠 있는 메신저·AI 버튼이 마지막 줄을 가리지 않게 */}
        </div>

        {session.tenant?.onboarding && <Onboarding />}
        {session.features.ai && <Suspense><AiDock open={aiDock} onOpenChange={setAiDock} /></Suspense>}
        <MessengerDock aiOpen={aiDock} />
        <VersionWatch />
        {/* V28-3 지원 모드: 빨간 띠(읽기 전용·남은 시간) + 끝내기 */}
        {session.support && (
          <div className="fixed inset-x-0 top-0 z-[60] flex flex-wrap items-center justify-center gap-2 bg-red-600 px-3 py-1.5 text-xs font-semibold text-white" data-testid="support-banner">
            지원 모드 — {session.support.tenantName} (읽기 전용 · {new Date(session.support.until).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}까지 · 모든 조회 기록)
            <button type="button" className="rounded bg-white/20 px-2 py-0.5 hover:bg-white/30" data-testid="support-end"
              onClick={async () => { await api('/api/platform/support', { method: 'DELETE' }).catch(() => {}); window.location.href = '/platform'; }}>지원 모드 끝내기</button>
          </div>
        )}
        {/* V28 B2 미납: 7일 읽기 전용 띠 · 30일 이용 중지(결제 안내만) */}
        {session.tenant?.billingLock === 'read_only' && (
          <div className="fixed inset-x-0 top-0 z-[36] bg-red-600 px-3 py-1 text-center text-xs font-medium text-white" data-testid="billing-ro-banner">
            결제가 7일 넘게 밀려 읽기 전용입니다 — <a href="/admin/usage" className="underline">결제하면 바로 복구</a> (30일 미납이면 이용 중지)
          </div>
        )}
        {session.tenant?.billingLock === 'suspended' && path !== '/admin/usage' && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/70 p-4" data-testid="billing-suspended">
            <div className="max-w-sm rounded-card bg-white p-5 text-center shadow-pop">
              <p className="text-lg font-bold">워크인 이용이 중지되었습니다</p>
              <p className="mt-2 text-sm text-ink-2">결제가 30일 넘게 밀렸습니다. {['owner', 'admin'].includes(session.user.role) ? '결제하면 바로 다시 쓸 수 있어요. 데이터는 그대로 남아 있습니다.' : '회사 관리자에게 결제를 요청해 주세요. 데이터는 그대로 남아 있습니다.'}</p>
              {['owner', 'admin'].includes(session.user.role) && <a href="/admin/usage" className="mt-4 inline-block rounded-input bg-brand-600 px-4 py-2 text-sm font-medium text-white">결제하러 가기</a>}
            </div>
          </div>
        )}
        {/* 17차: 무료 체험 D-n · 끝나면 읽기 전용 안내 */}
        {session.tenant?.trial && (
          <div className={cx('fixed inset-x-0 top-0 z-[35] flex items-center justify-center gap-2 px-3 py-1 text-xs font-medium sm:left-auto sm:right-4 sm:top-2 sm:rounded-full sm:shadow-card',
            session.tenant.trial.readOnly ? 'bg-red-600 text-white' : session.tenant.trial.daysLeft <= 3 ? 'bg-warm-500 text-white' : 'bg-brand-50 text-brand-800')} data-testid="trial-banner">
            {session.tenant.trial.readOnly ? '무료 체험이 끝나 읽기 전용입니다' : session.tenant.trial.daysLeft === 0 ? '무료 체험 오늘 종료' : `무료 체험 D-${session.tenant.trial.daysLeft}`}
            <Link href="/admin/usage" className="underline">요금제 선택</Link>
          </div>
        )}
        {/* 하단 탭 (모바일): 홈 · 업무 · [+] · 캘린더 · 메시지 (+ 정중앙) */}
        <nav className="fixed bottom-0 left-0 right-0 z-40 grid grid-cols-5 border-t border-line bg-white/95 pb-[var(--sab)] backdrop-blur sm:hidden" aria-label="하단 메뉴">
          {MOBILE_TABS.slice(0, 2).map((n) => <TabLink key={n.href} n={n} on={active(n.href)} />)}
          <div className="flex items-center justify-center">
            <button onClick={() => setFabMenu(true)} aria-label="만들기" aria-haspopup="menu" aria-expanded={fabMenu} data-testid="fab" className="-mt-5 flex size-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-pop ring-4 ring-white active:scale-95">
              <Plus className="size-7" />
            </button>
          </div>
          {MOBILE_TABS.slice(2).map((n) => <TabLink key={n.href} n={n} on={active(n.href)} badge={n.href === '/notifications' ? unread : n.href === '/messages' ? chatUnread : 0} />)}
        </nav>

        {/* + 버튼: 업무 · 일정 (V5) */}
        {fabMenu && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 sm:hidden" onClick={() => setFabMenu(false)}>
            <div role="menu" aria-label="만들기" className="absolute bottom-0 left-0 right-0 animate-fade-up rounded-t-2xl bg-white p-3 pb-[calc(var(--sab)+16px)]" onClick={(e) => e.stopPropagation()}>
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" />
              <button role="menuitem" onClick={() => { setFabMenu(false); openVoiceAdd(); }} aria-label="음성 등록" className="mb-2 flex w-full items-center justify-center gap-2 rounded-card bg-brand-600 py-3.5 text-base font-semibold text-white active:bg-brand-700" data-testid="fab-voice"><Mic className="size-5" />음성 등록</button>
              <div className="grid grid-cols-2 gap-2">
                <button role="menuitem" onClick={() => { setFabMenu(false); setQuick(true); }} aria-label="업무 등록" className="flex flex-col items-center gap-1.5 rounded-card border border-line py-4 text-sm font-semibold active:bg-slate-50"><SquarePen className="size-6 text-brand-600" />업무</button>
                <button role="menuitem" onClick={() => { setFabMenu(false); router.push('/calendar?quick=1'); }} aria-label="일정 등록" className="flex flex-col items-center gap-1.5 rounded-card border border-line py-4 text-sm font-semibold active:bg-slate-50"><CalendarPlus className="size-6 text-green-600" />일정</button>
              </div>
            </div>
          </div>
        )}

        {/* V14 51: 메뉴 항목을 누르면 화면이 바뀔 때(경로 변경 effect) 닫는다 — 누르는 순간 닫으면 iOS 가 눌림 효과를 뒤 화면 요소에 남긴다 */}
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
              {([['/projects', '프로젝트', FolderKanban], ...nav.filter((n) => n.href === '/library' || n.href === '/assistant').map((n) => [n.href, n.label, n.icon]), ['/settings', '설정·알림', Settings], ['/help', '도움말·문의', HelpCircle],
                ...(session.features.googleSync ? [['/settings/google', 'Google Calendar 연동(선택)', CalendarDays]] : []),
                ...(admin ? adminMenu.map((n) => [n.href, n.label, n.icon]) : nav.filter((n) => n.href === '/revenue').map((n) => [n.href, n.label, n.icon])), ...(session.user.platformAdmin ? [['/platform', '플랫폼 운영', Building2]] : [])] as [string, string, LucideIcon][]).map(([h, l, I]) => (
                <Link key={h} href={h} onClick={() => { if (path === h) setMore(false); }} className="flex items-center gap-3 rounded-input px-3 py-3 text-sm active:bg-slate-100"><I className="size-5 text-ink-2" />{l}</Link>
              ))}
              <button onClick={logout} className="flex w-full items-center gap-3 rounded-input px-3 py-3 text-left text-sm text-red-600 active:bg-red-50"><LogOut className="size-5" />로그아웃</button>
            </div>
          </div>
        )}
        <VoiceAddTask />
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
