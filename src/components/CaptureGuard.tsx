'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from './client';
import { toast } from './ui';
import { onNativeScreenshot, setSecureScreen } from './native';
import { automationSignals } from '@/lib/captureSignals';

/**
 * #626 캡처 차단(대표 10/25 20:05, 설계 docs/research/CAPTURE_BLOCK_DESIGN_2026-10-25.md §2-2) — 정책이 켜진 세션(외부 고객사)에서만 마운트 효과.
 * 웹은 캡처를 '못 하게' 할 수 없다(OS 캡처키·휴대폰 캡처·카메라·녹화는 브라우저가 모름) → 억제 + 출처 추적:
 *  A 워터마크(회사·이름·시각, 7%)  B 인쇄·PDF 저장 차단(html.capture-block + Ctrl/Cmd+P·S)  C PrintScreen 가로채기(클립보드 비움·안내·기록)
 *  D 창 이탈 가림(blur·숨김 → 흐림 + '눌러서 다시 보기')  E 자동화 브라우저 감지 → 화면 대신 안내 + 기록(시험 서버 CAPTURE_BLOCK=noauto 는 판정만 창에 노출)
 * 안드로이드 앱은 FLAG_SECURE 로 실제 차단(setSecureScreen, 네이티브는 로컬 'android-secure-1'), 아이폰은 캡처 감지 이벤트('screenshot')만.
 * 우리 회사·체험·슈퍼관리자는 정책이 꺼져(on=false) 아무것도 안 바뀐다.
 */
const stampOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
function markSvg(text: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="200"><text x="180" y="100" text-anchor="middle" transform="rotate(-24 180 100)" font-family="system-ui, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif" font-size="14" fill="#0f172a">${esc(text)}</text></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}
type Win = Record<string, unknown>;

export function CaptureGuard({ on, automation, company, userName }: { on: boolean; automation: boolean; company: string; userName: string }) {
  const [stamp, setStamp] = useState('');
  const [away, setAway] = useState(false);
  const [blocked, setBlocked] = useState<string[] | null>(null);
  const reported = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!on) return;
    const report = (kind: string) => {
      const now = Date.now(); if (now - (reported.current[kind] ?? 0) < 60_000) return; reported.current[kind] = now;
      api('/api/security/capture-events', { body: { kind, path: location.pathname } }).catch(() => {});
    };
    const notice = (text: string) => toast.info(text);
    const win = window as unknown as Win;
    if (automation) { const s = automationSignals(navigator, win); if (s.length) { setBlocked(s); report('automation'); return; } }
    else win.__wosCaptureSignals = () => automationSignals(navigator, win);
    document.documentElement.classList.add('capture-block');
    const tick = () => setStamp(stampOf(new Date())); tick(); const timer = setInterval(tick, 60_000);
    try { if (localStorage.getItem('wos_capture_notice') !== '1') { localStorage.setItem('wos_capture_notice', '1'); toast.info('이 서비스 화면에는 이용자 식별 워터마크가 표시되며, 인쇄·자동화 접속이 제한됩니다.'); } } catch {}
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') { e.preventDefault(); try { navigator.clipboard?.writeText('').catch(() => {}); } catch {} notice('이 화면은 캡처할 수 없습니다. 캡처 시도가 기록됩니다.'); report('printscreen'); return; }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); notice('이 화면은 인쇄할 수 없습니다.'); report('print'); return; }
      if (e.key === 's' || e.key === 'S') {
        const t = e.target as HTMLElement | null;
        if (t && (/^(INPUT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return; // 글 쓰는 중의 저장 단축키는 그대로
        e.preventDefault(); notice('이 화면은 저장할 수 없습니다.');
      }
    };
    const onPrint = () => report('print');
    const hide = () => setAway(true); const show = () => setAway(false);
    const vis = () => { if (document.hidden) hide(); else show(); };
    window.addEventListener('keydown', onKey, true); window.addEventListener('beforeprint', onPrint);
    window.addEventListener('blur', hide); window.addEventListener('focus', show); document.addEventListener('visibilitychange', vis);
    setSecureScreen(true);
    let offShot: (() => void) | null = null;
    onNativeScreenshot(() => { notice('캡처가 기록되었습니다.'); report('screenshot'); }).then((f) => { offShot = f; });
    return () => {
      clearInterval(timer); document.documentElement.classList.remove('capture-block');
      window.removeEventListener('keydown', onKey, true); window.removeEventListener('beforeprint', onPrint);
      window.removeEventListener('blur', hide); window.removeEventListener('focus', show); document.removeEventListener('visibilitychange', vis);
      setSecureScreen(false); offShot?.();
    };
  }, [on, automation]);
  if (!on) return null;
  if (blocked) {
    return (
      <div className="fixed inset-0 z-[210] flex flex-col items-center justify-center gap-3 bg-white p-6 text-center" role="alert" data-testid="capture-automation-block">
        <p className="text-lg font-bold">자동화된 브라우저에서는 쓸 수 없습니다</p>
        <p className="max-w-md text-sm text-ink-2">이 회사 화면은 사람이 쓰는 브라우저와 워크인 앱에서만 열립니다. 자동화·스크립트 접속은 기록됩니다. (감지: {blocked.join(', ')})</p>
      </div>
    );
  }
  return (
    <>
      <div id="capture-print-notice" className="hidden">인쇄가 제한된 화면입니다 — {company} · {userName}</div>
      <div aria-hidden data-testid="capture-watermark" className="pointer-events-none fixed inset-0 z-[200] select-none" style={{ opacity: 0.07, backgroundImage: markSvg(`${company} · ${userName} · ${stamp}`), backgroundRepeat: 'repeat', backgroundSize: '360px 200px' }} />
      {away && (
        <div className="fixed inset-0 z-[199] flex items-center justify-center bg-white/60 backdrop-blur-md" data-testid="capture-away" onClick={() => setAway(false)}>
          <div className="rounded-input bg-white px-4 py-3 text-sm shadow"><b>다른 창으로 나가 있는 동안 화면을 가립니다</b><div className="mt-1 text-xs text-ink-2">눌러서 다시 보기</div></div>
        </div>
      )}
    </>
  );
}
