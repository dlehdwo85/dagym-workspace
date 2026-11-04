'use client';
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useReportWebVitals } from 'next/web-vitals';
import { isInApp } from './inApp';

/**
 * #948(대표 11/04) 실제 사용자 화면 속도 — 로그인한 화면마다 '첫 표시'·'목록 표시' 시간을 재어 /api/public/perf 로 보낸다(웹·앱 구분).
 * - 처음 열 때: 첫 표시 = 브라우저가 재는 가장 큰 내용 표시 시각(LCP) · 목록 표시 = 그 뒤 시작된 /api/ 요청들이 조용해진 시각
 * - 화면 사이 이동: 첫 표시 = 링크를 누른 때부터 새 화면 틀이 그려진 때 · 목록 표시 = 누른 때부터 /api/ 요청들이 조용해진 때(0.7초 조용 · 최대 15초)
 * 사람·회사·브라우저 식별값은 보내지 않는다. 화면 이름은 주소에서 id 를 :id 로 바꾼 것(/tasks/:id).
 */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
export function screenOf(path: string) {
  const p = path.replace(UUID, ':id').replace(/\/\d{2,}(?=\/|$)/g, '/:id').replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, '/:id').toLowerCase();
  const segs = p.split('/').filter(Boolean).slice(0, 4);
  return (('/' + segs.join('/')).replace(/[^a-z0-9/_:.-]/g, '').slice(0, 60)) || '/';
}
type Item = { s: string; f?: number; l?: number };
const IGNORE = /\/api\/public\/perf|\/api\/notifications|\/api\/chat\/unread|\/api\/auth\/me|\/api\/cron\//;

export function PerfBeacon() {
  const path = usePathname();
  const buf = useRef<Item[]>([]); const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navStart = useRef<number | null>(null); // 링크를 누른 시각(화면 사이 이동)
  const firstPath = useRef<string | null>(null);
  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const items = buf.current.splice(0, 20); if (!items.length) return;
    try {
      const body = JSON.stringify({ c: isInApp() ? 'app' : 'web', items });
      if (!(navigator.sendBeacon && navigator.sendBeacon('/api/public/perf', new Blob([body], { type: 'text/plain' })))) fetch('/api/public/perf', { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(() => {});
    } catch {}
  };
  const push = (it: Item) => { buf.current.push(it); if (buf.current.length >= 20) flush(); else if (!timer.current) timer.current = setTimeout(flush, 3000); };
  useEffect(() => {
    const onClick = (e: MouseEvent) => { if ((e.target as Element | null)?.closest?.('a[href]')) navStart.current = performance.now(); };
    const onPop = () => { navStart.current = performance.now(); };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('click', onClick, true); window.addEventListener('popstate', onPop);
    document.addEventListener('visibilitychange', onHide); window.addEventListener('pagehide', flush);
    return () => { document.removeEventListener('click', onClick, true); window.removeEventListener('popstate', onPop); document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', flush); };
  }, []);
  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return;
    const s = screenOf(path);
    const hard = firstPath.current === null; if (hard) firstPath.current = path;
    const start = hard ? 0 : navStart.current; navStart.current = null;
    if (!hard && (start === null || performance.now() - start > 30_000)) return; // 링크 누름 없이 바뀐 주소(프로그램 이동)는 셈 안 함
    const item: Item = { s };
    if (!hard) item.f = Math.round(performance.now() - (start as number));
    let lastEnd = start as number; let seen = 0; let done = false; let quiet: ReturnType<typeof setTimeout> | null = null;
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as PerformanceResourceTiming[]) {
        if (!/\/api\//.test(e.name) || IGNORE.test(e.name) || e.startTime < (start as number)) continue;
        seen++; lastEnd = Math.max(lastEnd, e.responseEnd); schedule();
      }
    });
    const finish = () => {
      if (done) return; done = true; po.disconnect(); if (quiet) clearTimeout(quiet); clearTimeout(cap);
      if (seen) item.l = Math.round(lastEnd - (start as number));
      if (item.f !== undefined || item.l !== undefined) push(item);
    };
    const schedule = () => { if (quiet) clearTimeout(quiet); quiet = setTimeout(finish, 700); };
    const cap = setTimeout(finish, 15_000);
    try { po.observe({ type: 'resource', buffered: true }); } catch { return; }
    schedule();
    return finish; // 다음 이동이 오면 지금까지로 마감
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  useReportWebVitals((m) => { if (m.name === 'LCP') push({ s: screenOf(firstPath.current ?? location.pathname), f: Math.round(m.value) }); });
  return null;
}
