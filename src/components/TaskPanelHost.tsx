'use client';
import { useCallback, useEffect, useState } from 'react';
import { TaskDetail } from './TaskDetail';

/**
 * 300차 #850(로컬 10/31 16:40 대표 요청): 업무는 어디서 눌러도 오른쪽 패널로.
 * - 앱 어느 화면이든 업무 링크(/tasks/:id)를 누르면 지금 화면 위 오른쪽 패널(휴대폰은 전체 시트)로 열림 — 주소에 ?task=id
 * - 뒤로가기 = 닫기 · Esc · 패널 밖을 누르면(PC) 닫기 · 패널 안의 다른 업무 링크는 패널 내용만 바꿈(기록 한 칸)
 * - 전체 화면은 패널의 [크게 보기](새 탭)만 · Ctrl/⌘·가운데 버튼·새 탭 링크는 그대로 새 탭
 * - 업무 목록(TaskViews)의 줄은 원래 패널을 그대로 씀(data-open-task)
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TASK_LINK = /^\/tasks\/([0-9a-f-]{36})\/?$/i;
const EVENT = 'wos-open-task';
let mounted = false;

/** 코드에서 업무 열기(알림 [열기]·만들기 뒤 [보기] 등) — 패널이 없으면(앱 밖 화면) 전체 화면으로 */
export function openTaskPanel(id: string, fallback?: (href: string) => void) {
  if (mounted && UUID.test(id)) window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
  else if (fallback) fallback(`/tasks/${id}`);
  else window.location.href = `/tasks/${id}`;
}
const SWAP = 'wos-panel-swap';
/** 업무 목록(TaskViews)의 패널이 열려 있으면 그 패널 내용을 바꾸고, 아니면 전역 패널 — 패널 안 [열기]·만들기 뒤 [보기] 등 */
export function showTask(id: string, push?: (href: string) => void) {
  if (typeof document !== 'undefined' && document.querySelector('[data-testid="task-panel"]')) window.dispatchEvent(new CustomEvent(SWAP, { detail: id }));
  else openTaskPanel(id, push);
}
export const PANEL_SWAP_EVENT = SWAP;
/** 링크 주소로 이동 — 업무 링크면 패널, 아니면 그대로 */
export function goLink(href: string, push: (href: string) => void) {
  const m = TASK_LINK.exec(href.split(/[?#]/)[0]);
  if (m && mounted) openTaskPanel(m[1]); else push(href);
}

function withTask(id: string | null) {
  const u = new URL(window.location.href);
  if (id) u.searchParams.set('task', id); else u.searchParams.delete('task');
  return u.pathname + (u.search ? u.search : '') + u.hash;
}
const readTask = () => { const t = new URLSearchParams(window.location.search).get('task'); return t && UUID.test(t) ? t : null; };

export function TaskPanelHost() {
  const [id, setId] = useState<string | null>(null);
  const open = useCallback((next: string) => {
    const st = { ...(window.history.state ?? {}), wosTask: next };
    if (readTask()) window.history.replaceState(st, '', withTask(next)); // 패널이 열린 채 다른 업무 = 내용만 바꿈(뒤로 한 번에 닫힘)
    else window.history.pushState(st, '', withTask(next));
    setId(next);
  }, []);
  const close = useCallback(() => {
    if (window.history.state?.wosTask) window.history.back();
    else { const st = { ...(window.history.state ?? {}) }; delete st.wosTask; window.history.replaceState(st, '', withTask(null)); setId(null); }
  }, []);

  useEffect(() => {
    mounted = true;
    setId(readTask()); // 주소로 바로 들어온 ?task=id(알림 메일·새로 고침)
    const onPop = () => setId(readTask());
    const onOpen = (e: Event) => { const v = (e as CustomEvent<string>).detail; if (typeof v === 'string' && UUID.test(v)) open(v); };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download') || a.hasAttribute('data-open-task') || a.hasAttribute('data-full-task')) return;
      const u = new URL(a.href, window.location.href);
      if (u.origin !== window.location.origin) return;
      const m = TASK_LINK.exec(u.pathname);
      if (!m) return;
      // 기본 이동(Next 링크 포함)만 막음 — 링크에 달린 동작(알림 읽음·메뉴 닫기)은 그대로 실행됨
      e.preventDefault();
      if (a.closest('[data-testid="task-panel"]')) { window.dispatchEvent(new CustomEvent(SWAP, { detail: m[1] })); return; } // 업무 목록 패널 안 = 그 패널 내용만 바꿈
      open(m[1]);
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener(EVENT, onOpen);
    window.addEventListener('click', onClick, true);
    return () => { mounted = false; window.removeEventListener('popstate', onPop); window.removeEventListener(EVENT, onOpen); window.removeEventListener('click', onClick, true); };
  }, [open]);

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('[role=dialog]')) close(); };
    // PC: 패널 밖(빈 곳·사이드바 등)을 누르면 닫힘 — 다른 업무 링크·대화상자·알림 띠·시트는 제외(업무 링크는 패널 내용을 바꿈)
    const onDown = (e: PointerEvent) => {
      if (window.innerWidth < 640) return;
      const el = e.target as HTMLElement | null;
      if (!el?.closest || el.closest('[data-testid="global-task-panel"],a[href^="/tasks/"],[data-open-task],[role=dialog],[data-sheet],[role=status],[role=alert],[role=menu]')) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [id, close]);

  if (!id) return null;
  return (
    <aside className="fixed inset-0 z-[45] animate-slide-in overflow-y-auto bg-white shadow-pop sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[min(560px,100vw-240px)] sm:border-l sm:border-line"
      data-testid="global-task-panel" aria-label="업무 상세 패널">
      <TaskDetail key={id} id={id} inPanel onClose={close} />
    </aside>
  );
}
