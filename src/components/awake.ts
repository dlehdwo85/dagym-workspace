'use client';
import { Capacitor, registerPlugin } from '@capacitor/core';

interface AwakePlugin { keepAwake(): Promise<void>; allowSleep(): Promise<void> }
const Awake = registerPlugin<AwakePlugin>('KeepAwake');
const native = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('KeepAwake');
let holds = 0;
let wake: { release(): Promise<void> } | null = null;
function letSleep() {
  if (native()) { Awake.allowSleep().catch(() => {}); return; }
  const w = wake; wake = null; w?.release().catch(() => {});
}

/**
 * 화면 꺼짐 막기 — 앱은 keep-awake 플러그인(아이폰 앱 화면은 웹 Wake Lock 이 없을 수 있음), 웹은 Wake Lock. 지원하지 않으면 조용히 건너뜀.
 * 음성 모드·사진 고르기·여러 장 올리기가 함께 잡아도 마지막으로 놓을 때만 풀린다. 돌려준 함수를 부르면 놓음(두 번 불러도 한 번)
 */
export async function holdScreen(): Promise<() => void> {
  holds++;
  let held = true;
  const release = () => { if (!held) return; held = false; holds = Math.max(0, holds - 1); if (!holds) letSleep(); };
  if (holds === 1) {
    try {
      if (native()) await Awake.keepAwake();
      else { const wl = (navigator as any).wakeLock; if (wl && !wake) wake = await wl.request('screen'); }
    } catch { /* 지원 안 함 */ }
    if (!holds) letSleep(); // 잡는 사이에 이미 놓았으면
  }
  return release;
}
