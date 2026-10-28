'use client';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Loader2 } from 'lucide-react';
import { holdScreen } from './awake';
import { api } from './client';

const MAX_WAIT_MS = 20 * 60_000;

/** 248차 #780(대표 '김민수 본부장 50장 사진 업로드 불가 — 원인 분석하고 해결'): 사진 고르기 칸 accept 를 'image/*' 대신 명시 목록으로.
 *  아이폰 웹킷은 accept 가 와일드카드면 HEIC 를 '목록에 없음'으로 보고 [추가] 뒤 사진마다 JPEG 로 바꿔 넘김(장수에 비례, 그동안 아무 표시 없음 — WebKit 267277·303803).
 *  HEIC 를 글자 그대로 넣으면 바꾸지 않고 바로 넘김 → 웹에서 한 장씩 줄여 JPEG 로 올림(shrinkImage). 영상은 따로 고르기(영상 변환에 사진이 묶이지 않게) */
export const PHOTO_ACCEPT = 'image/jpeg,image/heic,image/heif,image/png,image/webp,image/gif';
type PickWhere = 'task' | 'chat';
type PickKind = 'photo' | 'video' | 'camera' | 'file';
const KEY = 'wos_pick';
const readMark = (): { at: number; where: PickWhere; kind: PickKind } | null => { try { const v = sessionStorage.getItem(KEY); return v ? JSON.parse(v) : null; } catch { return null; } };
const clearMark = () => { try { sessionStorage.removeItem(KEY); } catch { /* 저장 못 함 */ } };
const secSince = (at?: number) => (at ? Math.round((Date.now() - at) / 100) / 10 : null);
/** 고르기 진단(파일 이름·사진 내용은 안 보냄): 받음(장수·크기·형식별 수·연 뒤 걸린 초) · 취소 · 고르는 중 화면이 다시 열림(웹뷰가 죽음) · 끝(성공·실패) + 기기 */
function diag(event: 'received' | 'cancel' | 'lost' | 'done', extra: Record<string, unknown>) {
  try {
    const app = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
    void api('/api/me/pick-diag', { body: { event, ...extra, ua: navigator.userAgent.slice(0, 200), app } }).catch(() => {});
  } catch { /* 진단은 실패해도 그만 */ }
}
const kindsOf = (files: File[]) => {
  const k = { heic: 0, jpeg: 0, png: 0, video: 0, other: 0 };
  for (const f of files) { const t = (f.type || '').toLowerCase(), n = f.name.toLowerCase();
    if (/heic|heif/.test(t) || /\.(heic|heif)$/.test(n)) k.heic++; else if (/jpe?g/.test(t)) k.jpeg++; else if (/png/.test(t)) k.png++; else if (/^video\//.test(t)) k.video++; else k.other++; }
  return k;
};

/**
 * 대표 10/27(아이폰에서 사진 147장 '안 보내짐'): 아이폰은 사진을 많이 고르면 [추가]를 누른 뒤 휴대폰이 사진을 넘겨줄 준비를 하는 동안
 * (애플 쪽 문제 — 60장에 2분 남짓, 장수에 비례) 화면에 아무 표시가 없어 멈춘 것처럼 보인다.
 * 고르기 창을 열 때 '준비 중' 띠를 깔아 두고(창에 가려 있다가 [추가]를 누르면 보임) 파일이 들어오면(stop) 진행 표시로 넘기고,
 * 고르기를 취소하면(input 'cancel', iOS 16.4+·Chrome 113+) 걷는다. 그동안 화면이 꺼지지 않게 잡는다(꺼지면 앱이 멈춰 준비가 끊길 수 있음).
 * 쓰는 쪽: const pick = usePickWait(); 단추 = pick.open(inputRef) · onChange 맨 앞 pick.stop() · 화면에 {pick.node}
 */
export function usePickWait(where: PickWhere = 'task') {
  const [on, setOn] = useState(false);
  const got = useRef<{ at: number; count: number; kind: PickKind } | null>(null);
  const [since, setSince] = useState(0); const [, tick] = useState(0); // 지난 시간(멈춘 게 아님을 보이게)
  const hold = useRef<Promise<() => void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = useCallback(() => {
    setOn(false);
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const h = hold.current; hold.current = null; h?.then((release) => release());
  }, []);
  const open = useCallback((ref: RefObject<HTMLInputElement | null>, kind: PickKind = 'photo') => {
    if (!ref.current) return;
    setOn(true); setSince(Date.now());
    hold.current ??= holdScreen();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(stop, MAX_WAIT_MS);
    try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), where, kind })); } catch { /* 저장 못 함 */ }
    ref.current.addEventListener('cancel', () => { const m = readMark(); clearMark(); if (m) diag('cancel', { where, kind, sec: secSince(m.at) }); stop(); }, { once: true });
    ref.current.click();
  }, [stop, where]);
  /** 248차 #780: 고르기 창에서 파일이 들어온 순간(onChange 맨 앞) — 띠를 걷고 받은 장수·형식·걸린 초를 기록 */
  const received = useCallback((files: FileList | File[] | null | undefined) => {
    stop();
    const list = Array.from(files ?? []); const m = readMark(); clearMark();
    if (!m || !list.length) return;
    got.current = { at: Date.now(), count: list.length, kind: m.kind };
    diag('received', { where, kind: m.kind, count: list.length, bytes: list.reduce((a, f) => a + f.size, 0), kinds: kindsOf(list), sec: secSince(m.at) });
  }, [stop, where]);
  /** 올리기가 끝나면 — 성공·실패 수와 첫 오류(파일 이름 없이) */
  const done = useCallback((r: { ok: number; fail: number; firstError?: string | null }) => {
    const g = got.current; got.current = null;
    if (!g) return;
    diag('done', { where, kind: g.kind, count: g.count, ok: r.ok, fail: r.fail, firstError: r.firstError?.slice(0, 160) ?? null, sec: secSince(g.at) });
  }, [where]);
  // 고르는 중에 화면이 다시 열렸으면(앱 웹뷰가 메모리 부족 등으로 죽음) — 다음에 화면을 열 때 한 번 기록
  useEffect(() => { const m = readMark(); if (m && Date.now() - m.at > 3000) { clearMark(); diag('lost', { where: m.where, kind: m.kind, sec: secSince(m.at) }); } }, []);
  useEffect(() => stop, [stop]); // 화면을 떠나면 놓음
  useEffect(() => { if (!on) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [on]);
  const sec = on && since ? Math.max(0, Math.floor((Date.now() - since) / 1000)) : 0;
  const node = on ? (
    <div className="flex items-start gap-2 rounded-input border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900" role="status" data-testid="pick-wait">
      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
      <p className="min-w-0 flex-1"><b>고른 사진을 휴대폰이 준비하는 중입니다.</b> 사진이 많으면 몇 분 걸릴 수 있으니 앱을 닫지 말고 기다려 주세요 — 준비가 끝나면 바로 올라가기 시작합니다. 다음부터는 50장씩 나눠 고르면 빨리 올라갑니다.</p>
      <span className="shrink-0 tabular-nums text-sky-700" data-testid="pick-wait-time">{Math.floor(sec / 60)}:{String(sec % 60).padStart(2, '0')}</span>
      <button type="button" className="shrink-0 underline" onClick={stop} data-testid="pick-wait-close">닫기</button>
    </div>
  ) : null;
  return { open, stop, received, done, node, on };
}

/**
 * #749(대표 10/28 아이폰 사진 147장 '[추가]를 눌러도 안 넘어감 · 2장은 됨'): 휴대폰 흉내로 147장은 업무 첨부·메신저 모두 끝까지 올라감(웹 쪽 막힘 없음) —
 * 아이폰은 고른 사진을 넘겨줄 준비(애플 쪽, 장수에 비례)를 고르기 창이 떠 있는 동안 해서 이 화면의 '준비 중' 띠가 안 보일 수 있다. 그래서 고르기 전에 한 줄로 알림(아이폰만)
 */
export function IosPickHint({ className }: { className?: string }) {
  const [ios, setIos] = useState(false);
  useEffect(() => { setIos(/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)); }, []);
  if (!ios) return null;
  return <p className={className} data-testid="ios-pick-hint">아이폰: 사진을 한 번에 많이 고르면 [추가]를 누른 뒤 휴대폰이 사진을 준비하느라 몇 분 동안 멈춘 것처럼 보입니다(60장에 약 2분) — 50장씩 나눠 고르면 빨리 올라갑니다</p>;
}
