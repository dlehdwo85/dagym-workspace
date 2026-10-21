'use client';
/**
 * 대표 10/20 17:00 (#109) 영상 첨부 — 브라우저에서 영상 자체는 보내지 않고 ① 장면 프레임 ② 음성 트랙만 뽑는다.
 * 프레임: 1초 간격(긴 영상은 최대 120 표본)으로 훑으며 작은 회색 그림(32×18)의 차이가 큰 곳 = 장면 전환으로 보고 최대 20장(640px JPEG). 처음 장면은 항상 포함.
 * 음성: decodeAudioData 로 영상 컨테이너의 음성 트랙을 풀어 16kHz·모노 WAV 로(최대 10분, 약 19MB). 음성이 없거나 풀 수 없으면 프레임만.
 */
import { api } from './client';
import { uploadToLibrary } from './libraryUpload';

export type DigestFrames = { duration: number; frames: { t: number; data: string }[] };
const SIG_W = 32, SIG_H = 18, MAX_FRAMES = 20, MAX_SAMPLES = 120, OUT_W = 640, AUDIO_MAX_SEC = 600;

const until = <T,>(run: (ok: (v: T) => void, no: (e: unknown) => void) => void, ms = 15000) => new Promise<T>((ok, no) => { const t = setTimeout(() => no(new Error('영상을 읽는 데 시간이 너무 걸립니다')), ms); run((v) => { clearTimeout(t); ok(v); }, (e) => { clearTimeout(t); no(e); }); });

/** 장면 프레임 뽑기 */
export async function extractFrames(file: Blob, onProgress?: (pct: number) => void): Promise<DigestFrames> {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  try {
    await until<void>((ok, no) => { v.onloadedmetadata = () => ok(); v.onerror = () => no(new Error('이 영상 형식은 브라우저가 열지 못합니다')); });
    const duration = Number.isFinite(v.duration) ? v.duration : 0;
    const step = Math.max(1, duration / MAX_SAMPLES);
    const times: number[] = []; for (let t = 0; t < Math.max(duration, 0.1); t += step) times.push(Math.min(t, Math.max(0, duration - 0.05)));
    if (!times.length) times.push(0);
    const sig = document.createElement('canvas'); sig.width = SIG_W; sig.height = SIG_H; const sc = sig.getContext('2d', { willReadFrequently: true })!;
    const out = document.createElement('canvas'); const oc = out.getContext('2d')!;
    const scored: { t: number; diff: number; data: string }[] = [];
    let prev: Uint8ClampedArray | null = null;
    for (const [k, t] of times.entries()) {
      await until<void>((ok, no) => { v.onseeked = () => ok(); v.onerror = () => no(new Error('영상을 읽지 못했습니다')); v.currentTime = t; }, 8000);
      sc.drawImage(v, 0, 0, SIG_W, SIG_H);
      const px = sc.getImageData(0, 0, SIG_W, SIG_H).data;
      const gray = new Uint8ClampedArray(SIG_W * SIG_H);
      for (let i = 0; i < gray.length; i++) gray[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;
      let diff = 1; if (prev) { let s = 0; for (let i = 0; i < gray.length; i++) s += Math.abs(gray[i] - prev[i]); diff = s / gray.length / 255; }
      prev = gray;
      // 장면이 바뀐 곳(차이 12% 이상)이나 처음은 큰 그림으로
      if (k === 0 || diff >= 0.12) {
        const scale = Math.min(1, OUT_W / Math.max(1, v.videoWidth)); out.width = Math.max(1, Math.round(v.videoWidth * scale)); out.height = Math.max(1, Math.round(v.videoHeight * scale));
        oc.drawImage(v, 0, 0, out.width, out.height);
        scored.push({ t, diff: k === 0 ? 2 : diff, data: out.toDataURL('image/jpeg', 0.7).split(',')[1] });
      }
      onProgress?.(Math.round(((k + 1) / times.length) * 100));
    }
    // 너무 많으면 차이가 큰 순으로 20장, 다시 시각 순. 너무 적으면(3장 미만) 고르게 채움
    let pick = scored.length > MAX_FRAMES ? [...scored].sort((a, b) => b.diff - a.diff).slice(0, MAX_FRAMES).sort((a, b) => a.t - b.t) : scored;
    if (pick.length < 3 && times.length > pick.length) {
      const want = Math.min(6, times.length);
      for (let i = 1; i < want && pick.length < want; i++) {
        const t = times[Math.floor((i / want) * times.length)];
        if (pick.some((p) => Math.abs(p.t - t) < step / 2)) continue;
        await until<void>((ok, no) => { v.onseeked = () => ok(); v.onerror = () => no(new Error('영상을 읽지 못했습니다')); v.currentTime = t; }, 8000);
        const scale = Math.min(1, OUT_W / Math.max(1, v.videoWidth)); out.width = Math.max(1, Math.round(v.videoWidth * scale)); out.height = Math.max(1, Math.round(v.videoHeight * scale));
        oc.drawImage(v, 0, 0, out.width, out.height);
        pick.push({ t, diff: 0, data: out.toDataURL('image/jpeg', 0.7).split(',')[1] });
      }
      pick = pick.sort((a, b) => a.t - b.t);
    }
    return { duration, frames: pick.map((p) => ({ t: Math.round(p.t * 10) / 10, data: p.data })) };
  } finally { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); }
}

/** 음성 트랙 → 16kHz 모노 WAV (없거나 못 풀면 null) */
export async function extractAudioWav(file: Blob): Promise<Blob | null> {
  const AC: typeof AudioContext | undefined = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) return null;
  let ctx: AudioContext | null = null;
  try {
    ctx = new AC();
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    const secs = Math.min(decoded.duration, AUDIO_MAX_SEC);
    if (secs < 0.5) return null;
    const rate = 16000, len = Math.ceil(secs * rate);
    const off = new OfflineAudioContext(1, len, rate);
    const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start(0);
    const mono = (await off.startRendering()).getChannelData(0);
    // 소리가 거의 없으면(무음) 보내지 않음
    let peak = 0; for (let i = 0; i < mono.length; i += 16) peak = Math.max(peak, Math.abs(mono[i]));
    if (peak < 0.005) return null;
    const buf = new ArrayBuffer(44 + len * 2); const dv = new DataView(buf);
    const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + len * 2, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, len * 2, true);
    for (let i = 0; i < len; i++) { const s = Math.max(-1, Math.min(1, mono[i] ?? 0)); dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return new Blob([buf], { type: 'audio/wav' });
  } catch { return null; } finally { ctx?.close().catch(() => {}); }
}

export type VideoDigestResult = { fileId: string; digest: { summary: string; scenes: { t: number; text: string }[]; todos: { title: string; detail: string; due: string | null }[]; review: string[]; transcript: string | null; sttNote: string | null; frames: number; duration: number | null }; text: string };
/**
 * 영상 파일(이미 자료실에 올린 fileId) → 프레임·음성 추출 → 서버 요약. onStatus 로 진행 문구.
 * 음성은 "AI 요청 첨부/영상 음성" 파일로 잠깐 올리고 서버가 녹취 뒤 지운다.
 */
export async function runVideoDigest(file: Blob, fileId: string, opt: { mode?: 'summary' | 'review'; hint?: string; onStatus?: (s: string) => void } = {}): Promise<VideoDigestResult> {
  const say = opt.onStatus ?? (() => {});
  say('영상 장면 뽑는 중…');
  const fr = await extractFrames(file, (pct) => say(`영상 장면 뽑는 중… ${pct}%`));
  say('음성 트랙 뽑는 중…');
  const wav = await extractAudioWav(file).catch(() => null);
  let audioFileId: string | undefined;
  if (wav) {
    say(`음성 올리는 중… (${Math.round(wav.size / 1024 / 1024)}MB)`);
    const up = await uploadToLibrary(new File([wav], `영상 음성 ${fileId.slice(0, 8)}.wav`, { type: 'audio/wav' }), 'AI 요청 첨부', (pct) => say(`음성 올리는 중… ${pct}%`), ['영상 음성']).catch(() => null);
    audioFileId = up?.id;
  }
  say(`AI 가 영상을 요약하는 중… (장면 ${fr.frames.length}장${audioFileId ? ' + 음성' : ''})`);
  return api<VideoDigestResult>('/api/ai/video-digest', { body: { fileId, duration: Math.round(fr.duration), frames: fr.frames, ...(audioFileId ? { audioFileId } : {}), mode: opt.mode ?? 'summary', ...(opt.hint ? { hint: opt.hint } : {}) } });
}
export const isVideoFile = (f: { type?: string; name?: string }) => /^video\//.test(f.type ?? '') || /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(f.name ?? '');
