'use client';
import { useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { Loader2, Mic, Square } from 'lucide-react';
import { api } from './client';
import { Button, cx, toast } from './ui';

/**
 * V24 음성 등록 공통 — voice.listen() 하나로 앱/웹 자동 선택.
 * - 앱(Android·iOS): 휴대폰 자체 음성 인식(@capgo/capacitor-speech-recognition, ko-KR, 중간 결과, 후보 5개). 처음 쓸 때 권한 요청, 거부하면 설정 안내.
 *   (앱 WebView 에서는 브라우저 음성 인식이 사실상 동작하지 않는다)
 * - 웹: 브라우저 음성 인식(Web Speech API). 없으면 키보드 🎤 음성 입력 안내.
 * - 끝나면 회사 단어장 보정(/api/voice/correct) — 고친 곳(fixes)은 화면에서 밑줄·되돌리기.
 * - engine 은 2단계(서버 STT, 대표 결정) 대비로만 열어 둠: 지금은 'device' 만.
 */
export type VoiceResult = { text: string; alternatives: string[] };
export type VoiceFix = { from: string; to: string; how: string };
export type VoiceEnd = (r: VoiceResult | null, err?: 'unsupported' | 'denied' | 'no-speech' | 'error') => void;
type SR = {
  available(): Promise<{ available: boolean }>; checkPermissions(): Promise<{ speechRecognition: string }>; requestPermissions(): Promise<{ speechRecognition: string }>;
  start(o: Record<string, unknown>): Promise<{ matches?: string[] }>; stop(): Promise<void>;
  addListener(e: 'partialResults', f: (ev: { matches?: string[]; accumulatedText?: string }) => void): Promise<PluginListenerHandle>;
  addListener(e: 'listeningState', f: (ev: { state?: string; status?: string }) => void): Promise<PluginListenerHandle>;
  addListener(e: 'error', f: (ev: { code: string; message: string }) => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
};
const Native = registerPlugin<SR>('SpeechRecognition');
const nativeOk = () => typeof window !== 'undefined' && Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('SpeechRecognition');
const webSR = () => (typeof window === 'undefined' ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null);
export const voiceAvailable = () => nativeOk() || (!Capacitor.isNativePlatform() && !!webSR());
const MAX_MS = 90_000;
/** 말이 멈추고 이만큼 조용하면 끝 — 휴대폰 인식기는 1초 남짓 쉬면 혼자 끝나 버려서, 우리가 다시 켜 이어 듣는다 */
export const SILENCE_MS = 3500;
/** 눌러 놓고 아무 말이 없을 때 기다리는 시간 */
const FIRST_WAIT_MS = 8000;

/**
 * 듣기 시작. 돌려준 함수를 부르면 멈춤(그때까지 들은 말로 끝남).
 * 대표 실기기: "한마디 하자마자 끊긴다" — 인식기가 짧게 쉬면 끝내는 것을 우리가 다시 켜서 이어 붙이고,
 * [멈춤]을 누르거나 SILENCE_MS 동안 조용하거나 MAX_MS 가 되면 끝낸다.
 */
export function listen(o: { onPartial?: (t: string) => void; onEnd: VoiceEnd; engine?: 'device'; contextual?: string[] }): () => void {
  let ended = false, done = false;
  const t0 = Date.now();
  let heard = 0; // 마지막으로 새 글자가 들어온 시각(0 = 아직 말 없음)
  const acc: string[] = []; // 끝난 구간들
  let cur: string[] = []; // 지금 구간의 후보들
  let firstAlts: string[] = []; // 한 구간만 말했을 때 그 구간의 다른 후보(단어장 보정용)
  const joined = () => [...acc, cur[0] ?? ''].map((x) => x.trim()).filter(Boolean).join(' ');
  const result = (): VoiceResult | null => {
    const text = joined();
    if (!text) return null;
    const segs = acc.length + (cur[0]?.trim() ? 1 : 0);
    const alts = acc.length ? firstAlts : cur.slice(1);
    return { text, alternatives: segs === 1 ? alts.map((x) => x.trim()).filter(Boolean) : [] };
  };
  let cleanup = () => {};
  const end: VoiceEnd = (r, e) => { if (!ended) { ended = true; done = true; clearInterval(watch); cleanup(); o.onEnd(r, e); } };
  const partial = (alts: string[]) => {
    if (!alts.length) return;
    if ((alts[0] ?? '') !== (cur[0] ?? '')) heard = Date.now();
    cur = alts; o.onPartial?.(joined());
  };
  const commit = () => { if (cur[0]?.trim()) { if (!acc.length) firstAlts = cur.slice(1); acc.push(cur[0]); } cur = []; };
  let stopEngine = () => {};
  const finish = (e?: 'no-speech' | 'error' | 'denied') => { done = true; commit(); const r = result(); end(r, r ? undefined : e ?? 'no-speech'); };
  // 조용함·최대 시간 감시
  const watch = setInterval(() => {
    if (done) return;
    const now = Date.now();
    if ((heard && now - heard > SILENCE_MS) || (!heard && now - t0 > FIRST_WAIT_MS) || now - t0 > MAX_MS) { done = true; stopEngine(); setTimeout(() => finish(), 400); }
  }, 300);

  if (nativeOk()) {
    cleanup = () => { Native.removeAllListeners().catch(() => {}); };
    stopEngine = () => { Native.stop().catch(() => {}); };
    const startOnce = () => Native.start({ language: 'ko-KR', maxResults: 5, partialResults: true, popup: false, addPunctuation: false, allowForSilence: SILENCE_MS, contextualStrings: o.contextual?.slice(0, 100) })
      .then((r) => { if (r?.matches?.length) partial(r.matches); }).catch(() => {});
    // 인식기가 혼자 끝나면(짧은 쉼) 지금까지 말을 붙여 두고 다시 켠다
    const segmentEnded = () => { if (done) { finish(); return; } commit(); setTimeout(() => { if (!done) startOnce(); }, 150); };
    (async () => {
      let p = (await Native.checkPermissions().catch(() => ({ speechRecognition: 'prompt' }))).speechRecognition;
      if (p !== 'granted') p = (await Native.requestPermissions().catch(() => ({ speechRecognition: 'denied' }))).speechRecognition;
      if (p !== 'granted') return end(null, 'denied');
      await Native.addListener('partialResults', (ev) => { if (ev.matches?.length) partial(ev.matches); });
      await Native.addListener('listeningState', (ev) => { if ((ev.state ?? ev.status) === 'stopped') segmentEnded(); });
      await Native.addListener('error', (ev) => {
        const m = `${ev.code} ${ev.message}`;
        if (/permission|denied|not.?allowed|insufficient/i.test(m)) return end(null, 'denied');
        if (/no.?match|speech.?timeout|no.?speech|busy|client/i.test(m)) return segmentEnded(); // 쉼·잡음 = 다시 듣기(끝내는 건 감시가 정함)
        done = true; finish('error');
      });
      await startOnce();
    })().catch(() => finish('error'));
    return () => { if (done) return; done = true; stopEngine(); setTimeout(() => finish(), 400); };
  }
  const SRc = webSR();
  if (!SRc || Capacitor.isNativePlatform()) { end(null, 'unsupported'); return () => {}; }
  let r: any = null;
  stopEngine = () => { try { r?.stop(); } catch { /* 끝남 */ } };
  cleanup = () => { stopEngine(); };
  const startWeb = () => {
    r = new SRc();
    r.lang = 'ko-KR'; r.interimResults = true; r.maxAlternatives = 5; r.continuous = true; // 한 문장 뒤에도 계속 듣기
    r.onresult = (e: any) => {
      let text = '';
      let alts: string[] = [];
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        text += res[0].transcript;
        if (e.results.length === 1) alts = Array.from({ length: res.length }, (_: unknown, k: number) => String(res[k].transcript)).slice(1);
      }
      partial([text, ...alts]);
    };
    r.onerror = (e: any) => {
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') return end(null, 'denied');
      if (e?.error === 'no-speech' || e?.error === 'aborted') return; // onend 에서 이어 듣기/끝내기
      done = true; finish('error');
    };
    // 브라우저가 혼자 끝내면(쉼) 지금까지 말을 붙여 두고 다시 켠다
    r.onend = () => { if (done) { finish(); return; } commit(); setTimeout(() => { if (!done) { try { startWeb(); } catch { finish('error'); } } }, 150); };
    r.start();
  };
  try { startWeb(); } catch { end(null, 'error'); }
  return () => { if (done) return; done = true; stopEngine(); setTimeout(() => finish(), 400); };
}

/** 회사 단어장 보정(실패하면 원문 그대로) */
export async function correctVoice(r: VoiceResult): Promise<{ text: string; fixes: VoiceFix[] }> {
  try { return await api('/api/voice/correct', { body: r }); } catch { return { text: r.text, fixes: [] }; }
}
/** 보정 받아들임(등록·보내기)/되돌림 학습 */
export function learnVoice(fixes: VoiceFix[], accepted: boolean) {
  for (const f of fixes) if (f.how !== 'learned' || !accepted) api('/api/voice/learn', { body: { from: f.from, to: f.to, accepted } }).catch(() => {});
}

/** 오류 안내 — 권한 거부는 설정 경로 안내(iOS 는 설정 열기) */
export function voiceErrorToast(err?: string) {
  if (!err || err === 'no-speech') { if (err) toast.info('말소리를 듣지 못했습니다 — 다시 눌러 말해 주세요'); return; }
  if (err === 'denied') {
    const ios = Capacitor.getPlatform() === 'ios';
    toast.info(Capacitor.isNativePlatform()
      ? `마이크 권한이 꺼져 있습니다 — ${ios ? '설정 > 워크인 > 마이크·음성 인식' : '설정 > 애플리케이션 > 워크인 > 권한 > 마이크'}을 켜 주세요`
      : '마이크 권한이 막혀 있습니다 — 주소창 왼쪽 자물쇠 > 마이크 허용 후 다시 눌러 주세요',
      ios ? { label: '설정 열기', run: () => { window.location.href = 'app-settings:'; } } : undefined);
    return;
  }
  if (err === 'unsupported') {
    // 앱인데 음성 인식 플러그인이 없으면 = 옛 버전 앱 → 업데이트 안내(브라우저 문구는 웹에서만)
    if (Capacitor.isNativePlatform()) toast.info(`앱을 최신 버전으로 업데이트해 주세요 (${Capacitor.getPlatform() === 'ios' ? 'TestFlight·App Store' : 'Play 스토어'}) — 그동안은 키보드의 🎤(음성 입력)로 말하면 됩니다`);
    else toast.info('이 브라우저는 음성 인식을 지원하지 않습니다 — 키보드의 🎤(음성 입력)로 말해 주세요 (크롬·엣지·사파리는 지원)');
  }
  else toast.info('음성을 알아듣지 못했습니다 — 다시 눌러 말해 주세요');
}

/**
 * AI 비서·입력창용 마이크 버튼: 말하는 동안 입력창에 실시간 글자 → 끝나면 보정한 문장을 입력창에 남김(바로 보내지 않음)
 * value/onChange 는 입력창 값. 기존 글 뒤에 이어 붙인다.
 */
export function VoiceButton({ value, onChange, small, label = '음성 입력' }: { value: string; onChange: (v: string) => void; small?: boolean; label?: string }) {
  const [state, setState] = useState<'idle' | 'listening' | 'fixing'>('idle');
  const [ok, setOk] = useState(false);
  const stop = useRef<() => void>(() => {});
  const base = useRef('');
  useEffect(() => setOk(voiceAvailable()), []);
  useEffect(() => () => stop.current(), []);
  if (!ok) return null;
  const join = (t: string) => (base.current ? `${base.current} ${t}` : t);
  function start() {
    base.current = value.trim();
    setState('listening');
    stop.current = listen({
      onPartial: (t) => onChange(join(t)),
      onEnd: async (r, err) => {
        if (!r) { onChange(base.current); setState('idle'); voiceErrorToast(err); return; }
        setState('fixing');
        const c = await correctVoice(r);
        onChange(join(c.text)); setState('idle');
        if (c.fixes.length) { learnVoice(c.fixes, true); toast.info(`단어장으로 고쳤습니다: ${c.fixes.map((f) => `${f.from} → ${f.to}`).join(', ')}`); }
      },
    });
  }
  return (
    <Button type="button" variant="secondary" size={small ? 'sm' : undefined} onClick={state === 'listening' ? () => stop.current() : start} disabled={state === 'fixing'}
      aria-label={state === 'listening' ? '음성 입력 멈추기' : label} aria-pressed={state === 'listening'} data-testid="voice-button"
      className={cx(state === 'listening' && 'border-red-300 bg-red-50 text-red-600')}>
      {state === 'fixing' ? <Loader2 className="animate-spin" /> : state === 'listening' ? <Square className="fill-current" /> : <Mic />}
    </Button>
  );
}
