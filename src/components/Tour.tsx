'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { api } from './client';
import { isNativeApp } from './native';
import { Button } from './ui';

/**
 * #77(대표 10/16) 처음 사용 안내(코치마크 투어): "처음 앱 화면을 켜면 페이지별·기능별 버튼을 가리키며 안내 문구 — 딱 처음 들어갔을 때만!"
 * - 사람별·화면별 1번. 본 기록은 서버(user_tours) — 기기가 바뀌어도 다시 안 뜸. 홈 → 업무·캘린더·메시지·자료실·AI 비서는 그 화면에 처음 왔을 때, 업무 상세는 처음 열 때.
 * - 대상 버튼 둘레만 밝게(나머지 어둡게) + 말풍선(n/총수·제목·설명·[건너뛰기][이전][다음]). 화면에 없는 단계(권한·휴대폰/PC 차이)는 건너뜀.
 * - 회사 첫 안내 창(Onboarding)·다른 창이 떠 있으면 기다림. 지원 모드·시험 서버(TOURS_AUTO=0)는 자동으로 안 띄움(시험은 localStorage wos_tour_auto=1).
 * - 다시 보기: 프로필 메뉴·도움말 [사용 안내 다시 보기] = 기록 초기화 → 홈부터. Esc 닫기, ←/→ 이전/다음.
 */
type Ctx = { mobile: boolean; admin: boolean };
type Text = string | ((c: Ctx) => string);
type Step = { sel: string[]; title: Text; body: Text; admin?: boolean; widget?: boolean };

export const TOURS: Record<string, Step[]> = {
  home: [
    { sel: [], title: '워크인 사용 안내', body: '주요 버튼을 30초 만에 짚어 드릴게요. 언제든 [건너뛰기]로 닫고, 프로필 메뉴의 [사용 안내 다시 보기]로 다시 볼 수 있습니다.' },
    { sel: ['[data-testid="create-menu"]'], title: '업무·일정 만들기', body: '업무와 일정을 여기서 바로 등록합니다. 등록 창의 마이크를 누르면 음성 등록도 됩니다.' },
    { sel: ['[data-testid="mobile-tabs"] a[href="/tasks"]', 'aside a[href="/tasks"]'], title: '업무', body: (c) => `내 업무와 요청한 업무를 한곳에서 봅니다. ${c.mobile ? '[업무 추가]' : '[업무 추가]나 위 [만들기]'}로 등록하고, 마이크로 음성 등록도 됩니다.` },
    { sel: ['[data-testid="mobile-tabs"] a[href="/calendar"]', 'aside a[href="/calendar"]'], title: '캘린더', body: '일정과 마감 업무를 함께 봅니다. 빈 칸을 누르면 그 시간에 바로 추가됩니다.' },
    { sel: ['[data-testid="mobile-ai"]', 'aside a[href^="/assistant"]'], title: 'AI 비서', body: '"내일 3시 거래처 미팅 잡아 줘"처럼 말하거나 쓰면 업무·일정 등록, 메일·문자 초안까지 도와줍니다. 등록 전에 꼭 확인을 받습니다.' },
    { sel: ['[data-testid="mobile-bell"]', 'header a[href="/notifications"]'], title: '알림', body: '배정·마감·댓글·결재 알림이 여기에 모입니다. 앱 푸시로도 받을 수 있어요.' },
    { sel: ['aside a[href="/admin/users"]', '[data-testid="profile-menu"]'], admin: true, title: '동료 초대·회사 설정',
      body: (c) => c.mobile ? '오른쪽 위 프로필 버튼에 자료실·연락처·설정과 관리 메뉴(동료 초대·회사 정보·메일 연동)가 있습니다.' : '관리 › 사용자 관리에서 동료를 초대하고, 회사 정보·메일 연동도 관리 메뉴에서 설정합니다.' },
    { sel: ['[data-testid="open-palette"]', '[data-testid="profile-menu"]'], title: (c) => (c.mobile ? '더 많은 메뉴' : '검색 (Ctrl K)'),
      body: (c) => c.mobile ? '오른쪽 위 프로필 버튼에 자료실·연락처·공지·설정이 있습니다.' : '업무·프로젝트·사람·일정을 한 번에 찾습니다. 어느 화면에서든 Ctrl K.' },
    { sel: [], widget: true, title: '바탕화면 위젯', body: '오늘 할 일을 휴대폰 바탕화면에서 바로 보고 완료할 수 있습니다. [위젯 추가]를 누르면 홈 화면에 놓을 수 있어요.' },
  ],
  tasks: [
    { sel: ['[data-testid="add-task-top"]'], title: '업무 추가', body: '제목만 써도 됩니다. "내일 3시 김대리 견적 보내기"처럼 쓰면 마감·담당자를 알아서 채우고, 마이크로 음성 등록도 됩니다.' },
    { sel: ['[data-testid="group-by"]'], title: '묶어 보기', body: '담당자별·상태별·마감별로 묶어 봅니다.' },
    { sel: ['[data-testid="filter-toggle"]'], title: '필터', body: '내 업무·요청한 업무·기한 지난 업무만 골라 봅니다.' },
    { sel: ['[data-testid="task-list"] [data-testid="row-status-chip"]'], title: '상태 바꾸기', body: '상태 칩을 눌러 진행 중·완료로 바꿉니다. 줄을 누르면 업무 상세가 열립니다.' },
  ],
  calendar: [
    { sel: ['[aria-label="보기"]'], title: '보기 바꾸기', body: '일·3일·주·월·목록으로 바꿔 봅니다.' },
    { sel: ['[data-testid="cal-new-meeting"]', '[data-testid="cal-meeting-fab"]'], title: '미팅 일정', body: '장소·이동 시간을 넣어 미팅을 잡고, 준비할 업무도 함께 만들 수 있습니다.' },
    { sel: ['[data-testid="mini-month"]'], title: '작은 달력', body: '날짜를 눌러 그날로 바로 이동합니다.' },
    { sel: ['[data-testid="unscheduled"]'], title: '날짜 없는 업무', body: '캘린더 칸으로 끌어 놓으면 그 시간에 할 일로 잡힙니다.' },
    { sel: ['[data-testid="people-filter"]'], title: '동료 일정', body: '동료 일정을 겹쳐 보고 빈 시간을 찾습니다.' },
  ],
  messages: [
    { sel: ['[data-testid="chat-new"]'], title: '새 대화', body: '동료를 골라 1:1·그룹 대화를 시작합니다.' },
    { sel: ['[data-testid="chat-rooms"]'], title: '대화방', body: '안 읽은 대화가 위로 올라옵니다. 업무 상세의 [대화]에서도 바로 이어집니다.' },
  ],
  library: [
    { sel: ['[data-testid="library-upload"]'], title: '파일 올리기', body: '끌어 놓거나 눌러서 올립니다. PDF·한글(HWP)·엑셀 본문까지 검색됩니다.' },
    { sel: ['[data-testid="library-new-doc"]'], title: '새 문서', body: '워크인 안에서 동료와 함께 문서를 씁니다.' },
    { sel: ['[data-testid="library-tree"]'], title: '폴더', body: '폴더마다 볼 수 있는 사람을 정하고, 인사·재무 자료는 기밀로 보호합니다.' },
    { sel: ['[data-testid="library-organize-all"]'], title: 'AI 정리', body: 'AI가 파일을 알맞은 폴더로 정리하자고 제안합니다(확인 뒤 적용).' },
  ],
  assistant: [
    { sel: ['[data-testid="ai-chat"] textarea'], title: 'AI 비서에게 요청', body: '할 일을 말하듯 쓰세요. 업무·일정 등록, 메일·문자·견적서 초안, 자료 찾기를 해 주고, 등록 전에 꼭 확인을 받습니다.' },
    { sel: ['[data-testid="ai-voice-toggle"]'], title: '음성 모드', body: '운전 중에도 말로 묻고 답을 소리로 듣습니다.' },
    { sel: ['[data-testid="ai-threads-open"]', '[data-testid="ai-new-thread"]'], title: '대화 목록', body: '지난 대화를 이어 가거나 새 대화를 시작합니다.' },
  ],
  task: [
    { sel: ['[data-testid="task-progress"]'], title: '진행 단계', body: '단계를 눌러 진행 상황을 바꿉니다. 완료하면 요청자에게 알림이 갑니다.' },
    { sel: ['[data-testid="sum-due"]', '[data-testid="detail-due"]'], title: '마감', body: '마감이 빠듯하면 마감 연장을 요청할 수 있습니다.' },
    { sel: ['[data-testid="assist-section"]'], title: '이 업무의 AI 비서', body: '이 업무 내용으로 메일·문자·카카오톡 초안을 만들어 줍니다. 보내기 전에 직접 확인합니다.' },
    { sel: ['[data-testid="attach-section"]'], title: '첨부', body: '파일을 올리거나 자료실에서 가져옵니다. 문서·엑셀은 열어서 바로 고칠 수 있어요.' },
    { sel: ['[data-testid="comment-form"]'], title: '댓글', body: '@이름으로 동료를 불러 묻고 답합니다.' },
  ],
};
const PAGE_TOUR: [RegExp, string][] = [[/^\/$/, 'home'], [/^\/tasks$/, 'tasks'], [/^\/calendar$/, 'calendar'], [/^\/messages$/, 'messages'], [/^\/library$/, 'library'], [/^\/assistant$/, 'assistant']];

/** 화면 쪽에서 투어를 요청(업무 상세를 처음 열 때 등) — 볼 차례가 아니면 무시. force = [다시 보기] */
export function requestTour(id: string, force = false) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('wos-tour', { detail: { id, force } }));
}
/** [사용 안내 다시 보기] — 기록 초기화 후 홈부터 */
export function restartTours() { if (typeof window !== 'undefined') window.dispatchEvent(new Event('wos-tour-restart')); }

/** 바탕화면 위젯 단계: 앱이 네이티브 위젯 플러그인(WorkInWidget.requestPin)을 내보낼 때만 */
const widgetPlugin = () => { try { return isNativeApp() ? ((window as any).Capacitor?.Plugins?.WorkInWidget ?? null) : null; } catch { return null; } };
const text = (t: Text, c: Ctx) => (typeof t === 'function' ? t(c) : t);
function visible(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false;
  const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
}
const find = (sel: string[]) => { for (const s of sel) for (const el of Array.from(document.querySelectorAll(s))) if (visible(el)) return el as HTMLElement; return null; };
const otherDialog = () => Array.from(document.querySelectorAll('[role="dialog"]')).some((d) => !d.closest('[data-tour-root]') && visible(d));
const localKey = (uid: string) => `wos_tour_seen:${uid}`;
const readLocal = (uid: string): string[] => { try { return JSON.parse(localStorage.getItem(localKey(uid)) ?? '[]'); } catch { return []; } };
const testAuto = () => { try { return localStorage.getItem('wos_tour_auto') === '1'; } catch { return false; } };

type Run = { id: string; steps: Step[]; i: number; el: HTMLElement | null };

export function TourHost({ userId, seen: seen0, auto, admin, blocked }: { userId: string; seen: string[]; auto: boolean; admin: boolean; blocked: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const seen = useRef(new Set([...seen0, ...readLocal(userId)]));
  const [run, setRun] = useState<Run | null>(null);
  const runRef = useRef<Run | null>(null); runRef.current = run;
  const busy = useRef(false); // 대상 기다리는 중
  const blockedRef = useRef(blocked); blockedRef.current = blocked;

  const markSeen = useCallback((id: string) => {
    seen.current.add(id);
    try { localStorage.setItem(localKey(userId), JSON.stringify([...seen.current])); } catch {}
    api('/api/tours', { body: { tourId: id } }).catch(() => {});
  }, [userId]);

  /** i 부터 화면에 보이는 단계를 찾아 그 단계로(직전 단계와 같은 버튼이면 건너뜀). 없으면 끝 */
  const go = useCallback((steps: Step[], id: string, from: number, dir: 1 | -1, prevEl: HTMLElement | null) => {
    for (let k = from; k >= 0 && k < steps.length; k += dir) {
      const st = steps[k];
      if (!st.sel.length) { setRun({ id, steps, i: k, el: null }); return true; }
      const el = find(st.sel);
      if (el && el !== prevEl) { el.scrollIntoView({ block: 'center', inline: 'nearest' }); setRun({ id, steps, i: k, el }); return true; }
    }
    return false;
  }, []);

  const finish = useCallback((mark: boolean) => {
    const r = runRef.current; if (!r) return;
    if (mark) markSeen(r.id);
    setRun(null);
  }, [markSeen]);

  const start = useCallback(async (id: string, force: boolean) => {
    if (runRef.current || busy.current || !TOURS[id]) return;
    if (!force && (!(auto || testAuto()) || seen.current.has(id))) return;
    busy.current = true;
    try {
      const steps = TOURS[id].filter((s) => (!s.admin || admin) && (!s.widget || !!widgetPlugin()));
      // 화면이 그려지고(대상 버튼이 생기고) 다른 창이 닫힐 때까지 최대 8초
      for (let t = 0; t < 32; t++) {
        await new Promise((r) => setTimeout(r, 250));
        if (blockedRef.current || otherDialog()) continue;
        const ready = steps.some((s) => s.sel.length && find(s.sel));
        if (ready) { if (!go(steps, id, 0, 1, null)) markSeen(id); return; }
      }
    } finally { busy.current = false; }
  }, [admin, auto, go, markSeen]);

  // 화면에 처음 왔을 때
  useEffect(() => {
    const id = PAGE_TOUR.find(([re]) => re.test(path))?.[1];
    if (runRef.current && runRef.current.id !== id && runRef.current.id !== 'task') setRun(null); // 다른 화면으로 가면 닫음(봤음 표시 없이 — 그 화면에 다시 오면 이어서)
    if (id) start(id, false);
  }, [path, start]);
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent).detail ?? {}; start(String(d.id), !!d.force); };
    const restart = async () => {
      seen.current = new Set(); try { localStorage.removeItem(localKey(userId)); } catch {}
      await api('/api/tours', { method: 'DELETE' }).catch(() => {});
      setRun(null);
      if (location.pathname !== '/') router.push('/');
      start('home', true);
    };
    window.addEventListener('wos-tour', h); window.addEventListener('wos-tour-restart', restart);
    return () => { window.removeEventListener('wos-tour', h); window.removeEventListener('wos-tour-restart', restart); };
  }, [router, start, userId]);

  if (!run || typeof document === 'undefined') return null;
  return createPortal(<Coach run={run} admin={admin}
    onNext={() => { if (!go(run.steps, run.id, run.i + 1, 1, run.el)) finish(true); }}
    onPrev={() => { go(run.steps, run.id, run.i - 1, -1, null); }}
    onClose={() => finish(true)} />, document.body);
}

function Coach({ run, admin, onNext, onPrev, onClose }: { run: Run; admin: boolean; onNext: () => void; onPrev: () => void; onClose: () => void }) {
  const st = run.steps[run.i];
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [vp, setVp] = useState({ w: 0, h: 0, mobile: false });
  const box = useRef<HTMLDivElement>(null);
  // 단계 번호: 이 사람에게 실제로 보일 단계 기준(화면에 없는 단계·바로 앞과 같은 버튼은 셈에서 뺌 — go() 와 같은 규칙)
  const shown: Step[] = []; let prevEl: HTMLElement | null = null;
  for (const s of run.steps) { if (!s.sel.length) { shown.push(s); prevEl = null; continue; } const el = find(s.sel); if (el && el !== prevEl) { shown.push(s); prevEl = el; } }
  const n = Math.max(shown.length, 1); const idx = Math.max(shown.indexOf(st), 0) + 1;
  const last = idx >= n;
  const c: Ctx = { mobile: vp.mobile, admin };

  useEffect(() => {
    let raf = 0;
    const same = (a: DOMRect | null, b: DOMRect | null) => a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);
    const measure = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => {
      const w = innerWidth, h = innerHeight, mobile = matchMedia('(max-width: 639px)').matches;
      setVp((v) => (v.w === w && v.h === h && v.mobile === mobile ? v : { w, h, mobile }));
      const r = run.el && run.el.isConnected ? run.el.getBoundingClientRect() : null;
      setRect((o) => (same(o, r) ? o : r));
    }); };
    measure();
    const t = setInterval(measure, 400); // 화면이 늦게 그려져 버튼이 움직여도 따라감
    addEventListener('resize', measure); addEventListener('scroll', measure, true);
    return () => { clearInterval(t); cancelAnimationFrame(raf); removeEventListener('resize', measure); removeEventListener('scroll', measure, true); };
  }, [run.el]);
  useLayoutEffect(() => {
    const b = box.current; if (!b || !vp.w) return;
    const W = b.offsetWidth, H = b.offsetHeight, m = 12;
    const tabs = document.querySelector('[data-testid="mobile-tabs"]'); const tabTop = tabs && visible(tabs) ? tabs.getBoundingClientRect().top : vp.h;
    const bottomSafe = rect && tabs && tabs.contains(run.el) ? 0 : vp.h - tabTop; // 하단 탭을 가리키는 단계가 아니면 말풍선이 탭을 덮지 않게
    if (!rect) { setPos({ left: Math.max(m, (vp.w - W) / 2), top: Math.max(m, (vp.h - H) / 2) }); return; }
    let top = rect.bottom + 14;
    if (top + H > vp.h - m - bottomSafe) top = rect.top - 14 - H;
    if (top < m) top = Math.max(m, Math.min(vp.h - H - m - bottomSafe, rect.bottom + 14));
    const left = Math.min(Math.max(m, rect.left + rect.width / 2 - W / 2), vp.w - W - m);
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  }, [rect, vp, run.i, run.el]);
  const placed = !!pos;
  useEffect(() => { if (placed) box.current?.querySelector<HTMLButtonElement>('[data-testid="tour-next"]')?.focus({ preventScroll: true }); }, [run.i, placed]);
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); onNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); onPrev(); }
    };
    addEventListener('keydown', k, true);
    return () => { removeEventListener('keydown', k, true); prevFocus?.focus?.({ preventScroll: true }); };
  }, [onClose, onNext, onPrev]);

  const pad = 6;
  const widget = st.widget ? widgetPlugin() : null;
  return (
    <div className="fixed inset-0 z-[65]" data-tour-root data-testid="tour-overlay" data-tour={run.id}>
      {rect
        ? <div key="spot" className="pointer-events-none absolute rounded-[12px] ring-2 ring-white transition-all duration-200 motion-reduce:transition-none" data-testid="tour-spot"
            style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.58)' }} />
        : <div key="dim" className="absolute inset-0 bg-slate-900/60" />}{/* key: 어두운 판 ↔ 강조 구멍이 같은 div 로 재사용되면 화면 전체 크기에서 줄어드는 움직임이 생김 */}
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body" data-testid="tour"
        className="absolute w-[min(330px,calc(100vw-24px))] rounded-card bg-white p-4 shadow-pop motion-safe:transition-[left,top] motion-safe:duration-200"
        style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-brand-700" data-testid="tour-count">{idx} / {n}</span>
          <button type="button" onClick={onClose} aria-label="안내 닫기" className="-mr-1 rounded p-1 text-ink-3 hover:bg-slate-100"><X className="size-4" /></button>
        </div>
        <h2 id="tour-title" className="mt-0.5 text-base font-bold text-ink" data-testid="tour-title">{text(st.title, c)}</h2>
        <p id="tour-body" className="mt-1 text-sm leading-relaxed text-ink-2">{text(st.body, c)}</p>
        {widget && <Button size="sm" variant="secondary" className="mt-2" onClick={() => { Promise.resolve(widget.requestPin?.()).catch(() => {}); }} data-testid="tour-widget">위젯 추가</Button>}
        <div className="mt-3 flex items-center justify-between gap-2">
          <button type="button" onClick={onClose} className="text-xs text-ink-3 underline-offset-2 hover:underline" data-testid="tour-skip">건너뛰기</button>
          <div className="flex gap-1.5">
            {idx > 1 && <Button size="sm" variant="secondary" onClick={onPrev} data-testid="tour-prev">이전</Button>}
            <Button size="sm" onClick={onNext} data-testid="tour-next">{last ? (run.id === 'home' ? '시작하기' : '확인') : '다음'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
