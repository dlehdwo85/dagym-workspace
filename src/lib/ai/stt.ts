/**
 * 대표 10/20 17:00 (#109) 영상 음성 트랙 → 글자(STT).
 * 화면(브라우저)이 영상에서 음성만 WAV(16kHz·모노)로 뽑아 올리고, 서버는 그 음성 파일만 STT 공급자에 보낸다(영상 자체는 보내지 않음).
 * 공급자: OpenAI 음성 인식(OPENAI_API_KEY · OPENAI_BASE_URL · STT_MODEL, 기본 gpt-4o-mini-transcribe). 키가 없으면 음성 없이 프레임만 요약한다.
 * 마이크 음성 등록(V24)은 기기 음성 인식이라 파일에는 못 쓴다 — 그래서 서버 STT 가 따로 필요.
 */
export const sttConfigured = () => !!process.env.OPENAI_API_KEY;
export const sttModel = () => process.env.STT_MODEL || 'gpt-4o-mini-transcribe';
/** 분당 원가(달러) — gpt-4o-mini-transcribe $0.003/분, whisper-1 $0.006/분 */
export const sttCostUsd = (seconds: number) => (seconds / 60) * (sttModel() === 'whisper-1' ? 0.006 : 0.003);

export async function transcribeAudio(data: Buffer, fileName: string, mime: string, opt: { language?: string; signal?: AbortSignal } = {}): Promise<{ text: string; model: string }> {
  if (!sttConfigured()) throw new Error('STT 미설정');
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(data)], { type: mime || 'audio/wav' }), fileName || 'audio.wav');
  form.append('model', sttModel());
  form.append('language', opt.language ?? 'ko');
  form.append('response_format', 'json');
  const r = await fetch(`${base}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form, signal: opt.signal ?? AbortSignal.timeout(90_000) });
  const body = await r.text();
  if (!r.ok) throw new Error(`STT ${r.status}: ${body.slice(0, 200)}`);
  let j: any; try { j = JSON.parse(body); } catch { throw new Error('STT 응답을 해석하지 못했습니다'); }
  return { text: String(j.text ?? '').trim(), model: sttModel() };
}
