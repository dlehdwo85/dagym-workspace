'use client';
import { ChatBubble } from '@/components/ChatBubble';
import { RoleBadge } from '@/components/RoleBadge';
import { aiName } from '@/lib/aiNames';
import { TitleBar } from '@/components/TitleBar';
import { IN_APP_BILLING_NOTE, useInApp } from './inApp';
import { ADMIN_PAGES } from '@/lib/adminPages';
import Link from 'next/link';
import { Fragment, Suspense } from 'react';
import { AiDock } from './AiDock';
import { AlarmBar, type AlarmItem } from './AlarmBar';
import { BioLock } from './BioLock';
import { MessengerDock } from './MessengerDock';
import { VersionWatch } from './VersionWatch';
import { Onboarding } from './Onboarding';
import { TourHost, restartTours } from './Tour';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity, BarChart3, Bell, CalendarClock, CalendarHeart, FileBarChart, FileText, Gauge, CalendarDays, CalendarPlus, ChevronDown, CircleCheck, FolderKanban, FolderPlus, House, Keyboard, LayoutTemplate,
  Building2, Compass, HelpCircle, ListTodo, Library, LogOut, Sparkles, Network, QrCode, Stamp, Workflow, PanelLeftClose, PanelLeftOpen, Plus, ScrollText, Search, Settings, SquarePen, Star, Users, X,
  type LucideIcon,
  MessageCircle, Mail,
  TrendingUp, Megaphone, ChevronsUpDown, Check, CalendarCheck, SlidersHorizontal as SlidersIcon, Phone, ClipboardCheck, Link2,
  History, Rocket, Target, Briefcase,
Contact, Globe, } from 'lucide-react';
import { SessionCtx, canManage, isAdminRole, type Sess } from './session';
import { SPACE_META, spaceOfPath, type SpaceKey } from './spaceMeta';
import { api, flushOutbox, useOutboxCount, broadcastRefresh, useApi } from './client';
import { Avatar, Kbd, Modal, Toaster, toast, cx } from './ui';
import { ROLE_LABEL } from '@/lib/types';
import { clearReminders, enableNativePush, initNative } from './native';
import { QuickAddTask } from './QuickAddTask';
import { CommandPalette } from './CommandPalette';
import { VoiceAddTask } from './VoiceAddTask';

type NavItem = { href: string; label: string; icon: LucideIcon; group?: string };
/** 워크인(WORKIN_V2) 사이드바: 홈 · 업무(본사 전체) · 프로젝트 · 캘린더 · 알림 + 관리 묶음. 숨긴 화면(현장 신고 QR·자동화·현장 비교 등)은 코드·주소는 남겨 둔다 */
const COMMON_PATHS = ['/tasks', '/calendar', '/messages', '/library', '/assistant', '/notifications'];
const NAV: NavItem[] = [
  { href: '/', label: '홈', icon: House },
  { href: '/tasks', label: '업무', icon: CircleCheck },
  { href: '/projects', label: '프로젝트', icon: FolderKanban },
  { href: '/calendar', label: '캘린더', icon: CalendarDays },
  { href: '/messages', label: '메시지', icon: MessageCircle }, // V13 10번 사내 메신저
  { href: '/notifications', label: '알림', icon: Bell },
  { href: '/reports/mine', label: '내 주간 보고', icon: FileText },
  { href: '/notices', label: '공지', icon: Megaphone }, // V30 ② 공지(게시판)
  { href: '/approvals', label: '결재', icon: Stamp }, // V30 ④ 결재 양식(휴가·지출결의·품의)
  { href: '/contacts', label: '연락처', icon: Contact }, // V31 회사 공용 연락처
];
/** 사이드바 "관리" 묶음 — 주소·이름·메뉴 키는 lib/adminPages(V36 3 한 곳), 여기는 아이콘만 */
const ADMIN_ICON: Record<string, NavItem['icon']> = { '/reports': FileBarChart, '/revenue': BarChart3, '/admin/users': Users, '/admin/ops': Activity, '/admin/company': Building2, '/admin/mail': Mail, '/admin/usage': Gauge, '/admin/ai-logs': Sparkles, '/admin/approval-settings': Stamp };
const ADMIN_MENU: NavItem[] = ADMIN_PAGES.filter((p) => p.sidebar).map((p) => ({ href: p.href, label: p.label, icon: ADMIN_ICON[p.href] ?? Activity }));
/** V14 7번: 관리 메뉴 ↔ 메뉴 권한 키 (꺼진 메뉴는 숨김) */
const ADMIN_KEY: Record<string, string> = Object.fromEntries(ADMIN_PAGES.map((p) => [p.href, p.menu]));
const SHORTCUTS: [string, string][] = [
  ['Ctrl K', '검색·명령 열기'], ['N', '새 업무 만들기'], ['?', '단축키 도움말'], ['Esc', '패널·창 닫기'],
  ['G 다음 H', '홈'], ['G 다음 M', '업무'], ['G 다음 C', '캘린더'],
  ['S', '(업무 상세) 하위 업무 추가'], ['D · W · M · A', '(캘린더) 일 · 주 · 월 · 일정목록'], ['T', '(캘린더) 오늘로'], ['C', '(캘린더) 새 일정'],
];

function readPref(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function writePref(k: string, v: string) { try { localStorage.setItem(k, v); } catch {} }

export function AppShell({ session, children }: { session: Sess; children: ReactNode }) {
  const path = usePathname();
  const inApp = useInApp(); // 스토어 심사: 앱 안에서는 결제 링크·버튼 없음
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [alarms, setAlarms] = useState<AlarmItem[]>([]); // 로컬 10/20(대표): 웹 알람 띠(알람처럼 울리는 알림, 해제 전)
  const [approvalsTodo, setApprovalsTodo] = useState(0); // #114 ⑦ 휴대폰 상단 '결재할 것 n건'(알림 폴링에 실려 옴)
  const [chatUnread, setChatUnread] = useState(0);
  const [aiDock, setAiDock] = useState(false); // V14 11번 모든 화면 AI 비서
  // #429 '← 이전 화면': 앱 안에서 화면을 옮겨 다닌 횟수(처음 연 화면 = 1) — 1이면 뒤로 갈 앱 화면이 없으니 정해 둔 화면으로
  useEffect(() => { const w = window as any; w.__wosNav = (w.__wosNav ?? 0) + 1; }, [path]);
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
  // V41 공간: 지금 공간(주소로) · 들어갈 수 있는 공간 · 전환(마지막 공간 기억)
  const spaces = (session.spaces ?? ['work']) as SpaceKey[];
  // 대표 지적(10/18): 영업·마케팅 공간에서 공통 메뉴(업무·캘린더·메시지·자료실·AI 비서)로 가도 그 공간에 머묾 — 공간 메뉴 아래 '공통' 묶음
  const pathSpace = spaceOfPath(path);
  const common = COMMON_PATHS.some((c) => path === c || path.startsWith(c + '/'));
  const [ctxSpace, setCtxSpace] = useState<SpaceKey>('work');
  useEffect(() => {
    if (pathSpace !== 'work') { setCtxSpace(pathSpace); try { sessionStorage.setItem('wos_space_ctx', pathSpace); } catch {} }
    else if (!common) { setCtxSpace('work'); try { sessionStorage.setItem('wos_space_ctx', 'work'); } catch {} }
    else { try { const c = sessionStorage.getItem('wos_space_ctx') as SpaceKey | null; if (c && spaces.includes(c)) setCtxSpace(c); } catch {} }
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  const space: SpaceKey = pathSpace !== 'work' ? pathSpace : common && spaces.includes(ctxSpace) ? ctxSpace : 'work';
  const sm = SPACE_META[space];
  // 로컬 10/19(대표): 공간 강조색을 화면 전체(머리줄·하단 탭·강조 버튼·모달)에 — html[data-space] 로 brand 색 변수를 바꿈. 공간을 바꾸면 바로 바뀜
  useEffect(() => { const h = document.documentElement; h.dataset.space = space; return () => { delete h.dataset.space; }; }, [space]);
  const [spaceMenu, setSpaceMenu] = useState(false);
  const [spaceSheet, setSpaceSheet] = useState(false); // 휴대폰 머리줄 로고·공간 이름 → 공간 전환 시트
  const v3 = session.features.sidebar3 !== false; // ⑦ 사이드바 3구역(대표 승인 10/20 오후). FEATURE_SIDEBAR3=0 → 예전 모양
  const spaceInfo = useApi<{ summary: Record<string, { text: string; badge: number }> }>(spaces.length > 1 && (v3 || spaceMenu || more || spaceSheet || space === 'marketing') ? '/api/spaces' : null, [space]);
  const goSpace = (sp: SpaceKey) => { setSpaceMenu(false); try { localStorage.setItem('wos_space', sp); } catch {} router.push(SPACE_META[sp].home); };
  useEffect(() => { // 앱을 처음 열 때 마지막으로 쓴 공간으로
    if (path !== '/') return;
    let last: string | null = null; try { last = localStorage.getItem('wos_space'); } catch {}
    if (last && last !== 'work' && spaces.includes(last as SpaceKey)) router.replace(SPACE_META[last as SpaceKey].home);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const favs = useApi<{ projects: { id: string; name: string; color: string; favorite: boolean }[] }>('/api/projects');
  const favorites = (favs.data?.projects ?? []).filter((p) => p.favorite);
  // V9: 자료실(체험 계정 제외) · AI 비서(플랫폼 API 키가 있을 때만)
  // V13 메뉴 권한: 매출·주간 보고는 권한 있는 사람만(관리 묶음이 없는 사람도 매출 권한이 있으면 주 메뉴에)
  const menus = session.menus ?? {};
  const adminMenu = ADMIN_MENU.filter((n) => (menus[ADMIN_KEY[n.href]] ?? 'none') !== 'none').map((n) => (inApp && n.href === '/admin/usage' ? { ...n, label: '사용량' } : n)); // 앱 안: 요금제 글자 없이
  const nav: NavItem[] = [...NAV, ...(!admin && (menus.revenue ?? 'none') !== 'none' ? [{ href: '/revenue', label: '매출', icon: BarChart3 }] : []), ...(session.features.library ? [{ href: '/library', label: '자료실', icon: Library }] : []),
    ...(session.features.ai ? [{ href: '/assistant', label: 'AI 비서', icon: Sparkles }] : [])];
  // V41: 영업·마케팅 공간 메뉴(단계 2·4에서 채움) — 업무·일정·자료·AI 는 업무 공간 것을 함께 씀
  // 대표 10/21 12:00 영업 재편 3): 홈 → 영업 기회 허브(모든 원천 입구: 신규 현장·시설·협력사·계약만료·공공데이터·지역별) → 입찰·공고 → 리드·거래처(진행 단계 포함) → 제안·계약 → 데이터 설정. '파이프라인' 메뉴 없음(리드 안 단계별 보기)
  const spaceNav: NavItem[] = space === 'sales' ? [{ href: '/s/sales', label: '홈', icon: TrendingUp }, { href: '/s/sales/hub', label: '영업 기회 허브', icon: Building2 }, ...(session.features.salesBids !== false ? [{ href: '/s/sales/bids', label: '입찰·공고', icon: Stamp }] : []), { href: '/s/sales/leads', label: '리드·거래처', icon: Users }, { href: '/s/sales/deals', label: '제안·계약', icon: FileText }, { href: '/s/sales/sources', label: '데이터 설정', icon: SlidersIcon }] : space === 'marketing' ? [{ href: '/s/marketing', label: '홈', icon: Megaphone, group: '운영' }, { href: '/s/marketing/approvals', label: '승인 대기', icon: ClipboardCheck, group: '운영' }, { href: '/s/marketing/calendar', label: '콘텐츠 캘린더', icon: CalendarDays, group: '운영' },
    { href: '/s/marketing/goals', label: '월 운영 목표', icon: Target, group: '운영' }, { href: '/s/marketing/ops', label: '운영실', icon: Briefcase, group: '운영' }, { href: '/s/marketing/automation', label: '자동 제작', icon: Sparkles, group: '제작' },
    { href: '/s/marketing/ads', label: '광고 성과', icon: BarChart3, group: '성과' }, { href: '/s/marketing/sites', label: '사이트별 집계', icon: Globe, group: '성과' }, { href: '/s/marketing/ad-ops', label: '광고 운영', icon: Rocket, group: '성과' }, ...(admin ? [{ href: '/s/marketing/report', label: '월간 보고', icon: FileBarChart, group: '성과' }] : []), { href: '/s/marketing/calls', label: '전화 문의', icon: Phone, group: '성과' },
    { href: '/s/marketing/connections', label: '연결 계정', icon: Link2, group: '설정' }, ...(session.user.platformAdmin ? [{ href: '/s/marketing/history', label: '운영실 기록', icon: History, group: '설정' }] : []) /* 로컬 10/19: 예전 운영실 이관 기록은 플랫폼 관리자만(고객 화면에 없음) */] : [];

  const commonNav: NavItem[] = [{ href: '/tasks', label: '업무', icon: CircleCheck }, { href: '/calendar', label: '캘린더', icon: CalendarDays }, { href: '/messages', label: '메시지', icon: MessageCircle },
    ...(session.features.library ? [{ href: `/library?space=${space}`, label: '자료실', icon: Library }] : []), ...(session.features.ai ? [{ href: `/assistant?space=${space}`, label: aiName(space), icon: Sparkles }] : [])];

  // ⑦ 사이드바 3구역(시안 DESIGN_HOME_SIDEBAR 10/20, 대표 승인): ① 공간 전환 탭 ② '○○ 메뉴'(공간마다 바뀜 — 업무: 홈·업무·프로젝트·내 주간 보고·결재(·매출)) ③ '공통'(캘린더·알림·메시지·자료실·연락처·공지·AI 비서 — 어느 공간에서나 같은 자리) + 관리(접힘)
  // 영업·마케팅에서는 공통 맨 위에 '업무'(대표 지적 10/18: 공통 메뉴로 가도 그 공간에 머묾)
  const byHref = (h: string) => NAV.find((n) => n.href === h)!;
  const spaceMenuV3: NavItem[] = space === 'work' ? [byHref('/'), byHref('/tasks'), byHref('/projects'), byHref('/reports/mine'), byHref('/approvals'), ...(!admin && (menus.revenue ?? 'none') !== 'none' ? [{ href: '/revenue', label: '매출', icon: BarChart3 }] : [])] : spaceNav;
  const sp_ = space === 'work' ? '' : `?space=${space}`;
  const commonV3: NavItem[] = [...(space !== 'work' ? [byHref('/tasks')] : []), byHref('/calendar'), byHref('/notifications'), byHref('/messages'),
    ...(session.features.library ? [{ href: `/library${sp_}`, label: '자료실', icon: Library }] : []), byHref('/contacts'), byHref('/notices'), ...(session.features.ai ? [{ href: `/assistant${sp_}`, label: aiName(space), icon: Sparkles }] : [])];

  // 단축키: Ctrl K, N, ?, g h / g m / g c
  const gPressed = useRef(0);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); return; }
      // V41 공간 전환 단축키 Ctrl 1·2·3 (들어갈 수 있는 공간만)
      if ((e.ctrlKey || e.metaKey) && ['1', '2', '3'].includes(e.key)) { const sp = (['work', 'sales', 'marketing'] as SpaceKey[])[Number(e.key) - 1]; if (spaces.includes(sp)) { e.preventDefault(); goSpace(sp); } return; }
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
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return; // 10/21 DB 쿼터 장애: 가려진 탭은 폴링하지 않음
      try { const r = await api('/api/notifications?unread=1'); if (alive) { setUnread(r.unread); setAlarms(r.alarms ?? []); setApprovalsTodo(r.approvalsTodo ?? 0); } } catch {}
      try { const c = await api('/api/chat/unread'); if (alive) setChatUnread(c.unread); } catch {}
    };
    poll();
    const t = setInterval(poll, 120_000); // 10/21: 60초 → 120초(탭 포커스·wos-refresh 때는 바로)
    const onFocus = () => { poll(); };
    window.addEventListener('focus', onFocus);
    // V32 0: 읽음 즉시 배지 반영(알림 화면이 보내는 값) + 다른 화면에서 바뀌면 다시 셈
    const onUnread = (e: Event) => { const d = (e as CustomEvent<{ delta?: number; value?: number }>).detail ?? {}; setUnread((u) => Math.max(0, d.value ?? u + (d.delta ?? 0))); };
    let rt: ReturnType<typeof setTimeout> | undefined;
    const onRefresh = () => { clearTimeout(rt); rt = setTimeout(poll, 400); };
    window.addEventListener('wos-unread', onUnread);
    window.addEventListener('wos-refresh', onRefresh);
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
    return () => { alive = false; clearInterval(t); clearTimeout(rt); window.removeEventListener('focus', onFocus); window.removeEventListener('wos-unread', onUnread); window.removeEventListener('wos-refresh', onRefresh); window.removeEventListener('online', sync); window.removeEventListener('offline', sync); bc?.close(); };
  }, [router]);
  // #110: 앱 아이콘 숫자(PWA 설치·지원 브라우저) — 안 읽은 알림 수와 같이, 0이면 지움. 네이티브 앱 배지는 앱(로컬) 쪽
  useEffect(() => { try { const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> }; if (unread > 0) nav.setAppBadge?.(unread).catch(() => {}); else nav.clearAppBadge?.().catch(() => {}); } catch { /* 미지원 */ } }, [unread]);
  const reloadFavs = favs.reload;
  useEffect(() => { const h = () => reloadFavs(); window.addEventListener('wos-favorites', h); return () => window.removeEventListener('wos-favorites', h); }, [reloadFavs]);
  useEffect(() => { setCreateMenu(false); setUserMenu(false); setMore(false); setSpaceMenu(false); }, [path]);
  // V32 0: 업무·일정 등 화면을 열면 그 화면으로 가는 안 읽은 알림을 자동 읽음(앱 푸시로 들어온 경우 포함)
  const hasUnread = unread > 0;
  const readTried = useRef('');
  useEffect(() => {
    // 화면을 처음 열 때는 안 읽은 수를 아직 모를 수 있어(0 으로 시작) 한 번은 늘 확인 — 그 뒤엔 안 읽은 게 있을 때만
    if (path === '/notifications' || path === '/' || (!hasUnread && readTried.current === path)) return;
    readTried.current = path;
    api<{ changed: number; unread: number }>('/api/notifications/read', { body: { link: path } })
      .then((r) => { if (r.changed) setUnread(r.unread); }).catch(() => {});
  }, [path, hasUnread]);

  // 공간별 하단 탭 4개(+ 더보기) — 배지: 메시지 안 읽음 · 마케팅 승인 대기
  // 로컬 검수 10/19: 하단 탭은 마지막 공간이 아니라 지금 주소의 공간 기준(/tasks 등 공통 화면 = 업무)
  const tabSpace = path.startsWith('/s/sales') ? 'sales' : path.startsWith('/s/marketing') ? 'marketing' : 'work';
  const mobileTabs: (NavItem & { badge?: number })[] = tabSpace === 'sales'
    // 대표 검수 10/20 ②: 앱에서 파이프라인(칸반) 탭 제거. 대표(10/19·#438): 입찰은 안 쓰는 회사도 있어 하단 탭에 넣지 않음 — 그 칸은 제안·계약, 입찰·공고는 프로필 시트 '영업 메뉴'·영업기회 허브·PC 사이드바(켠 회사만)
    ? [{ href: '/s/sales', label: '홈', icon: TrendingUp }, { href: '/s/sales/leads', label: '리드', icon: Users }, { href: '/s/sales/deals', label: '제안·계약', icon: FileText }, { href: '/s/sales/hub', label: '영업기회', icon: Building2 }]
    : tabSpace === 'marketing'
      ? [{ href: '/s/marketing', label: '홈', icon: Megaphone }, { href: '/s/marketing/approvals', label: '승인 대기', icon: ClipboardCheck, badge: spaceInfo.data?.summary.marketing?.badge ?? 0 },
        { href: '/s/marketing/calendar', label: '캘린더', icon: CalendarDays }, { href: '/s/marketing/ads', label: '광고 성과', icon: BarChart3 }]
      // 대표 핫픽스 10/20 19:10(앱 캡처): 업무 공간 하단 = 홈 · 업무 · 캘린더 · 결재 · 더보기 — 프로젝트는 더보기 › 업무 메뉴로. 탭 구성 변경은 앞으로 대표 확인 뒤에만
      // 대표 확정 10/22(#422): 업무 공간 하단 = 홈 · 업무 · 캘린더 · 메시지 · 결재, 더보기 없음 — 나머지 메뉴는 오른쪽 위 프로필 버튼 시트로
      : v3 ? [byHref('/'), byHref('/tasks'), byHref('/calendar'), { ...byHref('/messages'), badge: chatUnread }, { ...byHref('/approvals'), badge: approvalsTodo }] : [NAV[0], NAV[1], NAV[3], { ...NAV[4], badge: chatUnread }];
  const tabHrefs = new Set(mobileTabs.map((n) => n.href.split('?')[0]));
  // 프로필 시트: 하단 탭·머리줄(알림·AI)과 겹치는 메뉴는 빼고, 남은 공통 메뉴 + 설정만(#422 b·d)
  const sheetLinks: NavItem[] = [...commonV3.filter((n) => !tabHrefs.has(n.href.split('?')[0]) && n.href !== '/notifications' && !n.href.startsWith('/assistant')), { href: '/settings', label: '설정·알림', icon: Settings }];
  // #422 c: 업무 공간 메뉴 칸은 '내 주간 보고'(+ 매출 권한)만 — 홈·업무·결재는 하단 탭, 프로젝트는 업무 화면 안에서
  const sheetSpaceMenu: NavItem[] = (v3 ? spaceMenuV3 : spaceNav).filter((n) => !tabHrefs.has(n.href.split('?')[0]) && !(space === 'work' && n.href === '/projects'));
  const active = (href: string) => {
    const [p, q] = href.split('?');
    if (p === '/') return path === '/';
    if (/^\/s\/[a-z]+$/.test(p)) return path === p; // 로컬 검수 10/17: 공간 첫 화면(영업 홈 등)은 하위 메뉴에 있을 때 같이 강조하지 않음
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
  const create = (what: 'task' | 'event' | 'project') => {
    setCreateMenu(false);
    if (what === 'task') setQuick(true);
    else router.push(what === 'event' ? '/calendar?new=1' : '/projects?new=1');
  };

  const navLink = (n: NavItem, badge?: number) => {
    const on = active(n.href);
    return (
      <Link key={n.href} href={n.href} aria-current={on ? 'page' : undefined} title={collapsed ? n.label : undefined} style={on && space !== 'work' ? { background: sm.color } : undefined}
        className={cx('group flex h-9 items-center gap-2.5 rounded-input px-2.5 text-sm transition-colors', on ? 'bg-brand-600 font-semibold text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-ink', collapsed && 'justify-center px-0')}>
        <n.icon className={cx('size-[18px] shrink-0', on ? 'text-white' : 'text-slate-400 group-hover:text-slate-600')} aria-hidden />
        {!collapsed && <span className="flex-1 truncate">{n.label}</span>}
        {!!badge && <span className={cx('rounded-full bg-red-500 text-[10px] font-semibold leading-4 text-white tabular-nums', collapsed ? 'absolute ml-5 -mt-5 px-1' : 'px-1.5')}>{badge > 99 ? '99+' : badge}</span>}
      </Link>
    );
  };

  return (
    <SessionCtx.Provider value={session}>
      <div className="app-shell min-h-screen bg-canvas text-ink sm:flex" data-space={space} style={sm.bg ? { background: sm.bg } : undefined}>
        {/* 사이드바 (데스크톱) */}
        <aside className={cx('hidden shrink-0 flex-col border-r border-line bg-white text-slate-700 transition-[width] duration-150 sm:sticky sm:top-0 sm:flex sm:h-screen', collapsed ? 'w-[60px]' : 'w-60')} aria-label="사이드바">
          {spaces.length > 1 && v3 ? (
            // ⑦ ① 공간 전환 탭(공간 색) — 요약은 title, 다른 공간 배지
            <div className={cx('px-2 pt-2', collapsed && 'px-1')} data-testid="space-tabs">
              <div className={cx('grid gap-1 rounded-[10px] bg-slate-100 p-1', collapsed ? 'grid-cols-1' : spaces.length >= 3 ? 'grid-cols-3' : 'grid-cols-2')} role="tablist" aria-label="공간 전환">
                {spaces.map((sp, i) => { const on = sp === space; const info = spaceInfo.data?.summary[sp]; return (
                  <button key={sp} role="tab" aria-selected={on} onClick={() => goSpace(sp)} data-testid={`space-tab-${sp}`} title={`${SPACE_META[sp].label}${info?.text ? ` · ${info.text}` : ''} (Ctrl ${i + 1})`}
                    className={cx('relative flex h-8 items-center justify-center gap-1 rounded-[8px] text-xs font-semibold transition-colors', on ? 'text-white shadow-sm' : 'text-slate-500 hover:text-ink')} style={on ? { background: SPACE_META[sp].color } : undefined}>
                    <SpaceIcon s={sp} />{!collapsed && <span>{SPACE_META[sp].short}</span>}
                    {!on && !!info?.badge && <span className="absolute -right-0.5 -top-1 min-w-[16px] rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">{info.badge}</span>}
                  </button>); })}
              </div>
              {!collapsed && <div className="truncate px-1 pt-1.5 text-[11px] text-slate-500"><span data-testid="space-current">{sm.label}</span>{session.tenant?.name && session.tenant.name !== '워크인' && <span> · {session.tenant.name}</span>}</div>}
            </div>
          ) : spaces.length > 1 ? (
            // V41 공간 카드 → 드롭다운(공간·요약·단축키)
            <div className="relative px-2 pt-2">
              <button onClick={() => setSpaceMenu((v) => !v)} aria-haspopup="menu" aria-expanded={spaceMenu} aria-label="공간 전환" data-testid="space-switch"
                className={cx('flex w-full items-center gap-2.5 rounded-[10px] border p-2 text-left', collapsed && 'justify-center border-transparent p-1')} style={{ background: sm.soft, borderColor: collapsed ? 'transparent' : sm.border }}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] text-white" style={{ background: sm.color }}><SpaceIcon s={space} /></span>
                {!collapsed && <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-sm font-bold text-ink" data-testid="space-current">{sm.label}</span><span className="block truncate text-[11px] text-slate-500">{session.tenant?.name ?? '워크인'}</span></span>}
                {!collapsed && <ChevronsUpDown className="size-4 shrink-0" style={{ color: sm.color }} />}
              </button>
              {spaceMenu && (<>
                <div className="fixed inset-0 z-40" onClick={() => setSpaceMenu(false)} />
                <div role="menu" aria-label="공간 전환 메뉴" className="absolute left-2 top-full z-50 mt-1 w-80 rounded-card border border-line bg-white p-2 shadow-pop" data-testid="space-menu">
                  <div className="px-2 py-1.5 text-xs text-ink-3">공간</div>
                  {spaces.map((sp, i) => (
                    <button key={sp} role="menuitem" onClick={() => goSpace(sp)} data-testid={`space-go-${sp}`} className="flex w-full items-center gap-2.5 rounded-[10px] p-2.5 text-left hover:bg-slate-50" style={sp === space ? { background: SPACE_META[sp].soft } : undefined}>
                      <span className="size-3 shrink-0 rounded-full" style={{ background: SPACE_META[sp].color }} />
                      <span className="min-w-0 flex-1"><span className={cx('block text-sm', sp === space ? 'font-bold' : 'font-medium')}>{SPACE_META[sp].label}</span>{spaceInfo.data?.summary[sp] && <span className="block truncate text-[11px] text-ink-3">{spaceInfo.data.summary[sp].text}</span>}</span>
                      {sp === space ? <span className="text-xs" style={{ color: SPACE_META[sp].color }}>지금</span> : <Kbd>Ctrl {i + 1}</Kbd>}
                    </button>
                  ))}
                  <div className="my-1 h-px bg-slate-100" />
                  <p className="px-2 py-1.5 text-[11px] text-ink-3">{admin ? '관리자는 켠 공간을 모두 봅니다 · 공간 켜기와 직원 배정은 관리 › 사용자 › 공간' : '배정된 공간만 보입니다'}</p>
                </div>
              </>)}
            </div>
          ) : (
          <div className={cx('flex h-14 items-center gap-2.5 px-4', collapsed && 'justify-center px-0')}>
            <img src="/icon.svg" alt="" className="size-7" />
            {!collapsed && <div className="min-w-0 leading-tight"><div className="truncate text-sm font-bold text-ink">워크인</div><div className="truncate text-[11px] text-slate-500">{session.tenant?.name ?? '워크인'}</div></div>}
          </div>
          )}
          <nav className="scrollbar-thin flex-1 space-y-0.5 overflow-y-auto px-2 pb-3" aria-label="주 메뉴">
            {v3 ? <div className={cx('mb-0.5 flex items-center gap-1.5 px-2.5 pb-1 pt-1 text-[11px] font-semibold text-slate-500', collapsed && 'sr-only')} data-testid="nav-space-head"><span className="h-3 w-1 shrink-0 rounded-full" style={{ background: sm.color }} aria-hidden />{sm.short} 메뉴</div>
              : space !== 'work' && !collapsed && <div className="px-2.5 pb-1 pt-0.5 text-[11px] font-semibold text-slate-400">{sm.short}</div>}
            {(v3 ? spaceMenuV3 : space === 'work' ? nav : [...spaceNav, ...commonNav]).map((n, k) => (
              <div key={n.href}>
                {/* 로컬 검수 10/19: 마케팅 메뉴 묶음(운영·제작·성과·설정) */}
                {k < spaceNav.length && n.group && n.group !== spaceNav[k - 1]?.group && <div className={cx('px-2.5 pb-1 pt-2.5 text-[11px] font-semibold text-slate-400', collapsed && 'sr-only')} data-testid="nav-group">{n.group}</div>}
                {!v3 && space !== 'work' && k === spaceNav.length && <div className={cx('px-2.5 pb-1 pt-3 text-[11px] font-semibold text-slate-400', collapsed && 'sr-only')} data-testid="nav-common">공통</div>}
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
            {v3 && (<div className="pt-2" data-testid="nav-common-v3">
              <div className="my-1.5 border-t border-line" />
              <div className={cx('px-2.5 pb-1 text-[11px] font-semibold text-slate-400', collapsed && 'sr-only')} data-testid="nav-common">공통</div>
              {commonV3.map((n) => <div key={n.href}>{navLink(n, n.href === '/notifications' ? unread : n.href === '/messages' ? chatUnread : 0)}</div>)}
            </div>)}
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

        {/* 대표 16:30 핫픽스: 휴대폰 대화방(?room=)이 열려 있으면(html[data-chat-room]) 하단 탭·아래 여백을 없애 키보드가 열려도 입력창이 보이게 */}
        <div className="min-w-0 flex-1 pb-[calc(6rem+var(--sab))] sm:pb-0 [[data-chat-room]_&]:pb-0">
          <TitleBar title={sm.label} />
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
                      <div className="min-w-0"><div className="flex items-center gap-1.5 truncate text-sm font-semibold">{session.user.name}<RoleBadge role={session.user.role} /></div><div className="truncate text-xs text-ink-2">{ROLE_LABEL[session.user.role]} · {session.user.email}</div></div>
                    </div>
                    <div className="my-1 border-t border-line" />
                    <Link role="menuitem" href="/settings" className="flex items-center gap-2.5 rounded-input px-2.5 py-2 text-sm hover:bg-slate-50"><Settings className="size-4 text-ink-2" />설정·알림</Link>
                    <Link role="menuitem" href="/help" className="flex items-center gap-2.5 rounded-input px-2.5 py-2 text-sm hover:bg-slate-50"><HelpCircle className="size-4 text-ink-2" />도움말·문의</Link>
                    <button role="menuitem" onClick={() => { setUserMenu(false); restartTours(); }} className="flex w-full items-center gap-2.5 rounded-input px-2.5 py-2 text-sm hover:bg-slate-50" data-testid="tour-restart"><Compass className="size-4 text-ink-2" />사용 안내 다시 보기</button>
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
              {/* 대표(10/19): 앱도 PC 처럼 로고·공간 이름을 누르면 공간 전환 시트 */}
              {spaces.length > 1 ? (
                <button type="button" onClick={() => setSpaceSheet(true)} aria-haspopup="dialog" aria-label={`공간 전환 — 지금 ${sm.label}`} data-testid="mobile-space-switch"
                  className="-ml-1 flex min-h-[44px] items-center gap-2 rounded-xl px-1 text-[15px] font-bold text-brand-700 active:bg-slate-100">{space === 'work' ? <img src="/icon.svg" alt="" className="size-7" /> : <span className="flex size-7 items-center justify-center rounded-[8px] text-white" style={{ background: sm.color }} data-testid="mobile-space-logo"><SpaceIcon s={space} /></span>}<span className="max-[380px]:sr-only" style={{ color: sm.color }}>워크인</span>
                  <span className="inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-xs font-medium" style={{ color: sm.color, background: sm.soft, borderColor: sm.border }} data-testid="mobile-space-chip">{sm.short}<ChevronDown className="size-3.5" aria-hidden /></span></button>
              ) : <span className="flex items-center gap-2 text-[15px] font-bold text-brand-700"><img src="/icon.svg" alt="" className="size-7" />워크인</span>}
              {/* 대표(10/19): 아이콘마다 44px·사이 8px, 알림 배지는 아이콘 칸 안에서(프로필과 겹치지 않게) */}
              <span className="flex items-center gap-2" data-testid="mobile-header-actions">
                <button onClick={() => setPalette(true)} className="inline-flex size-11 items-center justify-center rounded-full text-ink-2 active:bg-slate-100" aria-label="검색"><Search className="size-[22px]" /></button>
                {session.features.ai && <button onClick={() => setAiDock(true)} className="inline-flex size-11 items-center justify-center rounded-full text-violet-600 active:bg-violet-50" aria-label={aiName(space)} data-testid="mobile-ai"><Sparkles className="size-[22px]" /></button>}
                <Link href="/notifications" className="relative inline-flex size-11 items-center justify-center rounded-full text-ink-2 active:bg-slate-100" aria-label={`알림${unread ? ` ${unread}건` : ''}`} data-testid="mobile-bell">
                  <Bell className="size-[22px]" />{unread > 0 && <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-4 text-white">{unread > 99 ? '99+' : unread}</span>}
                </Link>
                <button onClick={() => setMore(true)} className="relative inline-flex size-11 items-center justify-center rounded-full active:bg-slate-100" aria-label="프로필·메뉴" data-testid="profile-menu"><Avatar id={session.user.id} name={session.user.name} size={30} /></button>
              </span>
            </div>
          </header>
          {/* #114 ⑦ 휴대폰 상단 '결재할 것 n건' — 내 결재 차례가 있을 때만, 누르면 결재 › 내가 결재할 것 */}
          {approvalsTodo > 0 && !path.startsWith('/approvals') && (
            <Link href="/approvals?view=todo" className="flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 sm:hidden" data-testid="approvals-todo-bar">
              <span className="inline-flex items-center gap-1.5"><Stamp className="size-4 text-amber-700" aria-hidden />결재할 것 {approvalsTodo}건</span><span className="text-amber-700">결재하기 ›</span>
            </Link>
          )}
          {/* 대표(10/19): 휴대폰 상단 공간 메뉴 칩 줄은 없앰 — 하단 탭 + 더보기 › 공간 메뉴로(하단 탭과 겹치고 깔끔하지 않음) */}
          <AlarmBar items={alarms} onChange={(id) => { setAlarms((a) => a.filter((x) => x.id !== id)); window.dispatchEvent(new Event('wos-refresh')); }} />
          <main className="mx-auto max-w-7xl p-3 sm:p-6 sm:pb-24">{children}</main>{/* 점검 ⑧: PC 오른쪽 아래 떠 있는 메신저·AI 버튼이 마지막 줄을 가리지 않게 */}
        </div>

        {session.tenant?.onboarding && <Onboarding />}
        {/* #77 처음 사용 안내 — 회사 첫 안내 창·결제 잠금 동안은 기다림 */}
        {session.tours && <TourHost userId={session.user.id} seen={session.tours.seen} auto={session.tours.auto} admin={admin} blocked={!!session.tenant?.onboarding || !!session.tenant?.billingLock} />}
        <BioLock />
        {session.features.ai && <Suspense><AiDock open={aiDock} onOpenChange={setAiDock} name={aiName(space)} /></Suspense>}
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
            결제가 7일 넘게 밀려 읽기 전용입니다 — {inApp ? IN_APP_BILLING_NOTE : <><a href="/admin/usage" className="underline">결제하면 바로 복구</a> (30일 미납이면 이용 중지)</>}
          </div>
        )}
        {session.tenant?.billingLock === 'suspended' && path !== '/admin/usage' && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/70 p-4" data-testid="billing-suspended">
            <div className="max-w-sm rounded-card bg-white p-5 text-center shadow-pop">
              <p className="text-lg font-bold">워크인 이용이 중지되었습니다</p>
              <p className="mt-2 text-sm text-ink-2">{inApp ? `데이터는 그대로 남아 있습니다. ${IN_APP_BILLING_NOTE}` : <>결제가 30일 넘게 밀렸습니다. {['owner', 'admin'].includes(session.user.role) ? '결제하면 바로 다시 쓸 수 있어요. 데이터는 그대로 남아 있습니다.' : '회사 관리자에게 결제를 요청해 주세요. 데이터는 그대로 남아 있습니다.'}</>}</p>
              {!inApp && ['owner', 'admin'].includes(session.user.role) && <a href="/admin/usage" className="mt-4 inline-block rounded-input bg-brand-600 px-4 py-2 text-sm font-medium text-white">결제하러 가기</a>}
            </div>
          </div>
        )}
        {/* 17차: 무료 체험 D-n · 끝나면 읽기 전용 안내 */}
        {session.tenant?.trial && (
          <div className={cx('fixed inset-x-0 top-0 z-[35] flex items-center justify-center gap-2 px-3 py-1 text-xs font-medium sm:left-auto sm:right-4 sm:top-2 sm:rounded-full sm:shadow-card',
            session.tenant.trial.readOnly ? 'bg-red-600 text-white' : session.tenant.trial.daysLeft <= 3 ? 'bg-warm-500 text-white' : 'bg-brand-50 text-brand-800')} data-testid="trial-banner">
            {session.tenant.trial.readOnly ? '무료 체험이 끝나 읽기 전용입니다' : session.tenant.trial.daysLeft === 0 ? '무료 체험 오늘 종료' : `무료 체험 D-${session.tenant.trial.daysLeft}`}
            {inApp ? <span className="font-normal">· {IN_APP_BILLING_NOTE}</span> : <Link href="/admin/usage" className="underline">요금제 선택</Link>}
          </div>
        )}
        {/* 하단 탭 (모바일): 홈 · 업무 · [+] · 캘린더 · 메시지 (+ 정중앙) */}
        {/* 대표 결정(10/19): 가운데 + 버튼 없이 공간마다 같은 크기 5칸 — 4개 메뉴 + 더보기(그 공간 나머지 메뉴·공통·공간 전환·만들기) */}
        <nav className={cx('fixed bottom-0 left-0 right-0 z-40 grid border-t border-line bg-white/95 pb-[var(--sab)] backdrop-blur sm:hidden [[data-chat-room]_&]:hidden', mobileTabs.length >= 5 ? 'grid-cols-5' : 'grid-cols-4')} aria-label="하단 메뉴" data-testid="mobile-tabs" data-space={tabSpace}>
          {mobileTabs.map((n) => <TabLink key={n.href} n={n} on={active(n.href)} badge={n.badge} />)}
        </nav>
        {/* 대표 10/20 16:20 (#106) 휴대폰 오른쪽 아래 말풍선 — 최근 대화방 바로·안 읽은 수·길게 누르면 AI 비서, 대화방·키보드·알람 띠에서 숨김 */}
        <ChatBubble unread={chatUnread} ai={!!session.features.ai} alarm={alarms.length > 0} />

        {spaceSheet && spaces.length > 1 && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 sm:hidden" onClick={() => setSpaceSheet(false)}>
            <div role="dialog" aria-label="공간 전환" className="absolute bottom-0 left-0 right-0 max-h-[90dvh] animate-fade-up overflow-y-auto overscroll-contain rounded-t-2xl bg-white p-3 pb-[calc(var(--sab)+16px)]" onClick={(e) => e.stopPropagation()} data-testid="space-sheet">
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-200" />
              <div className="flex items-center gap-2 px-2 pb-2"><div className="min-w-0 flex-1"><div className="text-base font-bold">공간 전환</div><div className="truncate text-xs text-ink-2">{session.tenant?.name ?? '워크인'}</div></div>
                <button onClick={() => setSpaceSheet(false)} className="rounded-full p-2 text-ink-3" aria-label="닫기"><X className="size-5" /></button></div>
              <div className="space-y-1">{spaces.map((sp) => (
                <button key={sp} onClick={() => { setSpaceSheet(false); goSpace(sp); }} data-testid={`sheet-space-${sp}`} className="flex min-h-[60px] w-full items-center gap-3 rounded-xl border-[1.5px] px-3 py-2 text-left"
                  style={sp === space ? { background: SPACE_META[sp].soft, borderColor: SPACE_META[sp].color } : { borderColor: 'transparent' }}>
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] text-white" style={{ background: SPACE_META[sp].color }}><SpaceIcon s={sp} /></span>
                  <span className="min-w-0 flex-1"><span className="block text-[15px] font-bold">{SPACE_META[sp].label}</span>{spaceInfo.data?.summary[sp] && <span className="block truncate text-xs text-ink-2">{spaceInfo.data.summary[sp].text}</span>}</span>
                  {sp === space && <Check className="size-5" style={{ color: SPACE_META[sp].color }} aria-label="지금 공간" />}
                  {sp !== space && !!spaceInfo.data?.summary[sp]?.badge && <span className="min-w-[22px] rounded-full bg-red-600 px-1.5 text-center text-xs font-bold leading-[22px] text-white">{spaceInfo.data.summary[sp].badge}</span>}
                </button>))}</div>
              <p className="px-2 pt-2 text-[11px] text-ink-3">{admin ? '관리자는 켠 공간을 모두 봅니다' : '배정된 공간만 보입니다'}</p>
            </div>
          </div>
        )}
        {/* V14 51: 메뉴 항목을 누르면 화면이 바뀔 때(경로 변경 effect) 닫는다 — 누르는 순간 닫으면 iOS 가 눌림 효과를 뒤 화면 요소에 남긴다 */}
        {more && (
          <div className="fixed inset-0 z-50 bg-slate-900/40 sm:hidden" onClick={() => setMore(false)}>
            {/* 로컬 검수 10/17: 공간 카드가 더해져 화면보다 길어짐 → 화면 90% 까지만, 안에서 스크롤(맨 위 프로필·공간부터 보임) */}
            <div className="absolute bottom-0 left-0 right-0 max-h-[90dvh] animate-fade-up overflow-y-auto overscroll-contain rounded-t-2xl bg-white p-3 pb-[calc(var(--sab)+16px)]" onClick={(e) => e.stopPropagation()} data-testid="more-sheet">
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-200" />
              <div className="flex items-center gap-3 px-3 py-2">
                <Avatar id={session.user.id} name={session.user.name} size={40} />
                <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5 font-semibold">{session.user.name}<RoleBadge role={session.user.role} /></div><div className="truncate text-xs text-ink-2">{ROLE_LABEL[session.user.role]} · {session.user.email}</div></div>
                <button onClick={() => setMore(false)} className="rounded-full p-2 text-ink-3" aria-label="닫기"><X className="size-5" /></button>
              </div>
              {/* 대표 확정 10/22(#422 b): 하단 '더보기'를 없애고 이 시트는 오른쪽 위 프로필 버튼으로 연다 — '만들기' 줄은 뺌(업무 화면 [업무 추가]·캘린더·리드 화면에 있음, 음성은 업무 등록 창 안 [음성]) */}
              {spaces.length > 1 && (
                <div className="space-y-1 border-t border-line px-1 pb-1 pt-2" data-testid="mobile-spaces">
                  <div className="px-2 text-xs text-ink-3">공간 전환</div>
                  {spaces.map((sp) => (
                    <button key={sp} onClick={() => goSpace(sp)} data-testid={`mobile-space-${sp}`} className="flex min-h-[60px] w-full items-center gap-3 rounded-xl border-[1.5px] px-3 py-2 text-left"
                      style={sp === space ? { background: SPACE_META[sp].soft, borderColor: SPACE_META[sp].color } : { borderColor: 'transparent' }}>
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] text-white" style={{ background: SPACE_META[sp].color }}><SpaceIcon s={sp} /></span>
                      <span className="min-w-0 flex-1"><span className="block text-[15px] font-bold">{SPACE_META[sp].label}</span>{spaceInfo.data?.summary[sp] && <span className="block truncate text-xs text-ink-2">{spaceInfo.data.summary[sp].text}</span>}</span>
                      {sp === space && <Check className="size-5" style={{ color: SPACE_META[sp].color }} aria-label="지금 공간" />}
                      {sp !== space && !!spaceInfo.data?.summary[sp]?.badge && <span className="min-w-[22px] rounded-full bg-red-600 px-1.5 text-center text-xs font-bold leading-[22px] text-white">{spaceInfo.data.summary[sp].badge}</span>}
                    </button>
                  ))}
                </div>
              )}
              {sheetSpaceMenu.length > 0 && (
                <div className="border-t border-line px-1 pb-1 pt-2" data-testid="mobile-space-menu">
                  <div className="px-2 text-xs text-ink-3">{sm.short} 메뉴</div>
                  <div className="mt-1 grid grid-cols-2 gap-1.5">{sheetSpaceMenu.map((n) => (
                    <Link key={n.href} href={n.href} onClick={() => setMore(false)} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-line px-3 text-sm" style={active(n.href) ? { background: sm.soft, borderColor: sm.color } : undefined}>
                      <n.icon className="size-4 shrink-0" style={{ color: sm.color }} aria-hidden /><span className="truncate">{n.label}</span></Link>))}</div>
                </div>
              )}
              {/* #422 d: 하단 탭·머리줄(알림·AI 비서)과 겹치지 않는 공통 메뉴 + 설정 */}
              <div className="border-t border-line px-1 pb-1 pt-2" data-testid="profile-links">
                <div className="mt-1 grid grid-cols-2 gap-1.5">{sheetLinks.map((n) => { const b = n.href === '/messages' ? chatUnread : 0; return (
                  <Link key={n.href} href={n.href} onClick={() => setMore(false)} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-line px-3 text-sm" style={active(n.href) ? { background: sm.soft, borderColor: sm.color } : undefined}>
                    <n.icon className="size-4 shrink-0 text-ink-2" aria-hidden /><span className="truncate">{n.label}</span>{!!b && <span className="ml-auto rounded-full bg-red-500 px-1.5 text-[10px] font-semibold leading-4 text-white">{b}</span>}</Link>); })}</div>
              </div>
              <div className="my-1 border-t border-line" />
              {(v3 ? [['/help', '도움말·문의', HelpCircle], ...(session.features.googleSync ? [['/settings/google', 'Google Calendar 연동(선택)', CalendarDays]] : []),
                ...(admin ? adminMenu.map((n) => [n.href, n.label, n.icon]) : nav.filter((n) => n.href === '/revenue').map((n) => [n.href, n.label, n.icon])), ...(session.user.platformAdmin ? [['/platform', '플랫폼 운영', Building2]] : [])] as [string, string, LucideIcon][]
              : [['/projects', '프로젝트', FolderKanban], ...nav.filter((n) => n.href === '/library' || n.href === '/assistant').map((n) => [n.href, n.label, n.icon]), ['/settings', '설정·알림', Settings], ['/help', '도움말·문의', HelpCircle],
                ...(session.features.googleSync ? [['/settings/google', 'Google Calendar 연동(선택)', CalendarDays]] : []),
                ...(admin ? adminMenu.map((n) => [n.href, n.label, n.icon]) : nav.filter((n) => n.href === '/revenue').map((n) => [n.href, n.label, n.icon])), ...(session.user.platformAdmin ? [['/platform', '플랫폼 운영', Building2]] : [])] as [string, string, LucideIcon][]).map(([h, l, I], i) => (<Fragment key={h}>
                {v3 && admin && i === 1 + (session.features.googleSync ? 1 : 0) && adminMenu.length > 0 && <div className="px-3 pt-2 text-xs text-ink-3" data-testid="mobile-admin-head">관리</div>}
                <Link href={h} onClick={() => { if (path === h) setMore(false); }} className="flex items-center gap-3 rounded-input px-3 py-3 text-sm active:bg-slate-100"><I className="size-5 text-ink-2" />{l}</Link>
              </Fragment>))}
              <button onClick={() => { setMore(false); restartTours(); }} className="flex w-full items-center gap-3 rounded-input px-3 py-3 text-left text-sm active:bg-slate-100" data-testid="tour-restart-m"><Compass className="size-5 text-ink-2" />사용 안내 다시 보기</button>
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

/** V41 공간 아이콘(업무 체크 달력 · 영업 상승 · 마케팅 확성기) */
function SpaceIcon({ s }: { s: SpaceKey }) {
  const I = s === 'sales' ? TrendingUp : s === 'marketing' ? Megaphone : CalendarCheck;
  return <I className="size-[18px]" aria-hidden />;
}
