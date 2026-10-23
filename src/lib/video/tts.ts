import { db } from '../db';
import { decrypt, encrypt } from '../crypto';

/**
 * #454 영상 내레이션(한국어 TTS). Higgsfield API(console 키)에는 TTS 모델이 없어(문서 기준 이미지 17·영상 67) 공급자를 따로 둔다.
 * 공급자는 대표가 고른다(OpenAI · ElevenLabs · 네이버 클로바 보이스). 키는 플랫폼 운영에서 넣고 암호화 보관, 다시 보여 주지 않음.
 * 키가 없으면 영상은 자막만으로 완성한다(합성 단계가 '내레이션 키 필요'를 남김).
 */
export type TtsProvider = 'openai' | 'elevenlabs' | 'clova';
export const TTS_PROVIDERS: Record<TtsProvider, { label: string; base: string; voice: string; model: string; keyHint: string; voiceHint: string }> = {
  openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', voice: 'nova', model: 'gpt-4o-mini-tts', keyHint: 'sk-… (platform.openai.com › API keys)', voiceHint: '음성 이름(예: nova·alloy·shimmer)' },
  elevenlabs: { label: 'ElevenLabs', base: 'https://api.elevenlabs.io/v1', voice: '', model: 'eleven_multilingual_v2', keyHint: 'xi-api-key (elevenlabs.io › API Keys)', voiceHint: '음성 ID(Voice Library 에서 한국어 음성 골라 ID 복사)' },
  clova: { label: '네이버 클로바 보이스', base: 'https://naveropenapi.apigw.ntruss.com/tts-premium/v1', voice: 'nara', model: '', keyHint: 'Client ID:Client Secret (NCP 콘솔 › AI·NAVER API › Application)', voiceHint: '화자(예: nara·vara·nminsang)' },
};
const KEY = 'tts';
type Test = { ok: boolean; message: string; at: string };
export type TtsView = { provider: TtsProvider | null; hasKey: boolean; ready: boolean; voice: string; model: string; base: string; keyHint: string | null; updatedAt: string | null; lastTest: Test | null; providers: typeof TTS_PROVIDERS };

export async function ttsSettings(): Promise<TtsView & { apiKey?: string }> {
  const [r] = await db()<{ value: any }[]>`select value from app_settings where key = ${KEY}`;
  const v = r?.value ?? {};
  const provider: TtsProvider | null = v.provider && v.provider in TTS_PROVIDERS ? v.provider : null;
  let apiKey: string | undefined;
  if (v.keyEnc) { try { apiKey = decrypt(v.keyEnc); } catch { apiKey = undefined; } }
  if (!apiKey && provider === 'openai' && process.env.OPENAI_API_KEY) apiKey = process.env.OPENAI_API_KEY; // 회의록 받아쓰기용 키가 들어오면 같이 씀
  const d = provider ? TTS_PROVIDERS[provider] : null;
  const voice = String(v.voice ?? '') || d?.voice || '';
  const keyOk = !!apiKey && (provider !== 'clova' || /^[^:\s]+:[^:\s]+$/.test(apiKey));
  return { provider, hasKey: !!apiKey, ready: !!provider && keyOk && !!voice, voice, model: String(v.model ?? '') || d?.model || '', base: String(v.base ?? '') || d?.base || '',
    keyHint: apiKey ? `${apiKey.slice(0, 4)}…` : null, updatedAt: v.updatedAt ?? null, lastTest: v.lastTest ?? null, providers: TTS_PROVIDERS, apiKey };
}
export async function saveTtsSettings(i: { provider?: TtsProvider | null; apiKey?: string | null; voice?: string | null; model?: string | null; base?: string | null }, actorId: string) {
  const [r] = await db()<{ value: any }[]>`select value from app_settings where key = ${KEY}`;
  const v = { ...(r?.value ?? {}) };
  if (i.provider !== undefined) { if (i.provider !== v.provider) { delete v.keyEnc; delete v.voice; delete v.model; delete v.base; delete v.lastTest; } v.provider = i.provider; }
  if (i.apiKey !== undefined) { if (i.apiKey?.trim()) v.keyEnc = encrypt(i.apiKey.trim()); else delete v.keyEnc; delete v.lastTest; }
  for (const k of ['voice', 'model', 'base'] as const) if (i[k] !== undefined) v[k] = i[k]?.trim() || null;
  v.updatedAt = new Date().toISOString(); v.updatedBy = actorId;
  await db()`insert into app_settings (key, value) values (${KEY}, ${db().json(v)}) on conflict (key) do update set value = excluded.value`;
  return ttsSettings();
}
export const ttsView = (s: Awaited<ReturnType<typeof ttsSettings>>): TtsView => { const { apiKey: _k, ...rest } = s; void _k; return rest; };

const STATUS_KO: Record<number, string> = { 400: '요청 거절(문장·음성 값 확인)', 401: '인증 실패 — 키를 확인하세요', 402: '잔액·요금제 한도 부족', 403: '권한 없음 — 키 권한·이용 신청 확인', 404: '주소·음성 ID 가 없음', 429: '요청이 너무 많음(잠시 뒤 다시)' };
async function errText(res: Response) {
  const t = await res.text().catch(() => '');
  let msg = t.slice(0, 200);
  try { const j = JSON.parse(t); msg = j?.error?.message ?? j?.detail?.message ?? j?.detail ?? j?.errorMessage ?? j?.error?.errorMessage ?? msg; } catch { /* 글자 그대로 */ }
  return `HTTP ${res.status} ${STATUS_KO[res.status] ?? (res.status >= 500 ? '공급자 서버 오류' : '')}${msg ? ` · ${String(msg).slice(0, 160)}` : ''}`.trim();
}

/** 문장 → mp3. 광고 내레이션 말투(또렷·따뜻·과장 없이)는 OpenAI 만 지시문을 받는다 */
export async function synthesize(text: string, opt: { voice?: string } = {}): Promise<{ data: Buffer; chars: number }> {
  const s = await ttsSettings();
  if (!s.provider || !s.apiKey) throw new Error('내레이션 키 필요 — 플랫폼 운영 › 영상 내레이션(TTS)');
  const voice = opt.voice || s.voice; const base = s.base.replace(/\/$/, ''); const input = text.trim().slice(0, 600);
  if (!voice) throw new Error('내레이션 음성 ID 가 없습니다 — 플랫폼 운영 › 영상 내레이션(TTS)');
  let res: Response;
  if (s.provider === 'openai') {
    res = await fetch(`${base}/audio/speech`, { method: 'POST', headers: { authorization: `Bearer ${s.apiKey}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ model: s.model, voice, input, response_format: 'mp3', instructions: '한국어 광고 내레이션. 또렷하고 따뜻하게, 과장 없이 자연스러운 속도로 읽는다.' }) });
  } else if (s.provider === 'elevenlabs') {
    res = await fetch(`${base}/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, { method: 'POST', headers: { 'xi-api-key': s.apiKey, 'content-type': 'application/json', accept: 'audio/mpeg' }, signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ text: input, model_id: s.model || TTS_PROVIDERS.elevenlabs.model }) });
  } else {
    const [id, secret] = s.apiKey.split(':');
    res = await fetch(`${base}/tts`, { method: 'POST', headers: { 'X-NCP-APIGW-API-KEY-ID': id, 'X-NCP-APIGW-API-KEY': secret, 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(60_000),
      body: new URLSearchParams({ speaker: voice, volume: '0', speed: '0', pitch: '0', format: 'mp3', text: input }).toString() });
  }
  if (!res.ok) throw new Error(`내레이션 실패: ${await errText(res)}`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length < 200 || /^\s*[{<]/.test(data.subarray(0, 20).toString())) throw new Error('내레이션 실패: 소리 파일이 아닌 응답');
  return { data, chars: input.length };
}

/** [연결 시험] OpenAI·ElevenLabs = 돈이 들지 않는 목록 조회, 클로바 = 두 글자('시험') 합성(아주 적은 비용) */
export async function ttsTest(actorId: string) {
  const s = await ttsSettings();
  let out: { ok: boolean; message: string };
  if (!s.provider) out = { ok: false, message: '공급자를 먼저 고르세요' };
  else if (!s.apiKey) out = { ok: false, message: '키가 없습니다 — 키를 넣고 저장하세요' };
  else {
    try {
      const base = s.base.replace(/\/$/, '');
      if (s.provider === 'clova') { await synthesize('시험'); out = { ok: true, message: '연결됨 — 두 글자 합성 성공' }; }
      else {
        const res = await fetch(s.provider === 'openai' ? `${base}/models` : `${base}/voices`, { headers: s.provider === 'openai' ? { authorization: `Bearer ${s.apiKey}` } : { 'xi-api-key': s.apiKey }, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) out = { ok: false, message: await errText(res) };
        else if (s.provider === 'elevenlabs') {
          const j: any = await res.json().catch(() => ({}));
          const has = !s.voice || (Array.isArray(j?.voices) && j.voices.some((x: any) => x?.voice_id === s.voice));
          out = has ? { ok: true, message: s.voice ? '연결됨 — 키와 음성 ID 가 맞습니다' : '연결됨 — 음성 ID 를 넣어 주세요' } : { ok: false, message: '키는 맞지만 음성 ID 가 이 계정 목록에 없습니다' };
        } else out = { ok: true, message: '연결됨 — 키가 맞습니다' };
      }
    } catch (e: any) { out = { ok: false, message: String(e?.message ?? e).slice(0, 200) }; }
  }
  const [r] = await db()<{ value: any }[]>`select value from app_settings where key = ${KEY}`;
  const v = { ...(r?.value ?? {}), lastTest: { ...out, at: new Date().toISOString(), by: actorId } };
  await db()`insert into app_settings (key, value) values (${KEY}, ${db().json(v)}) on conflict (key) do update set value = excluded.value`;
  return out;
}
