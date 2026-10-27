'use client';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { listen, voiceAvailable, type VoiceResult } from './voice';
import { holdScreen } from './awake';

/**
 * V38 3 음성 대화(운전 중): 소리로 읽어 주기(TTS)·화면 꺼짐 방지·한 번 듣기.
 * 앱 = @capacitor-community/text-to-speech·keep-awake(로컬 7063bea 설치), 웹 = speechSynthesis·Wake Lock. 둘 다 없으면 조용히 건너뜀.
 */
interface TtsPlugin { speak(o: { text: string; lang?: string; rate?: number; pitch?: number; volume?: number; category?: string }): Promise<void>; stop(): Promise<void> }
const Tts = registerPlugin<TtsPlugin>('TextToSpeech');
const nativeTts = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('TextToSpeech');

declare global { interface Window { __spoken?: string[] } }

/** 읽기 끝날 때까지 기다린다(웹은 소리가 안 나는 환경에서도 멈추지 않게 글자 수만큼만 기다림) */
export async function speak(text: string) {
  const t = text.replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!t) return;
  if (typeof window !== 'undefined') (window.__spoken ??= []).push(t); // 시험·기록용
  if (nativeTts()) { try { await Tts.speak({ text: t, lang: 'ko-KR', rate: 1.0, category: 'playback' }); } catch { /* 소리 장치 없음 */ } return; }
  const ss = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
  if (!ss || typeof SpeechSynthesisUtterance === 'undefined') return;
  await new Promise<void>((res) => {
    const u = new SpeechSynthesisUtterance(t); u.lang = 'ko-KR'; u.rate = 1.05;
    const max = setTimeout(res, Math.min(20_000, 1500 + t.length * 110));
    u.onend = () => { clearTimeout(max); res(); }; u.onerror = () => { clearTimeout(max); res(); };
    try { ss.speak(u); } catch { clearTimeout(max); res(); }
  });
}
export function stopSpeaking() {
  if (nativeTts()) { Tts.stop().catch(() => {}); return; }
  try { window.speechSynthesis?.cancel(); } catch { /* 없음 */ }
}

let voiceHold: (() => void) | null = null;
/** 음성 모드 동안 화면이 꺼지지 않게 — 213차: 사진 올리기와 함께 잡아도 서로 풀지 않게 awake.ts 를 같이 씀 */
export async function keepScreenOn(on: boolean) {
  if (on && !voiceHold) { const held = holdScreen(); voiceHold = () => { held.then((release) => release()); }; await held; }
  else if (!on && voiceHold) { voiceHold(); voiceHold = null; }
}

/** 한 번 듣고 글자로(못 들으면 null) */
export function hearOnce(): Promise<string | null> {
  if (!voiceAvailable()) return Promise.resolve(null);
  return new Promise((res) => { listen({ onEnd: (r: VoiceResult | null) => res(r?.text?.trim() || null) }); });
}
/** "보내/네/응" = yes, "취소/아니" = no, 그 밖 = null */
export function yesNo(t: string | null): boolean | null {
  if (!t) return null;
  const s = t.replace(/\s/g, '');
  if (/(취소|아니|그만|하지마|안보내|보내지마|멈춰)/.test(s)) return false;
  if (/(보내|전송|네|예|응|어|좋아|그래|확인|맞아|오케이|ok)/i.test(s)) return true;
  return null;
}
