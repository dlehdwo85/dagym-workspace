'use client';
import { useEffect, useState } from 'react';
import { api, useApi } from './client';
import { Button, Field, cx, inputCls, toast } from './ui';

type P = 'openai' | 'elevenlabs' | 'clova';
type S = { provider: P | null; hasKey: boolean; ready: boolean; voice: string; model: string; base: string; keyHint: string | null; updatedAt: string | null; lastTest: { ok: boolean; message: string; at: string } | null;
  providers: Record<P, { label: string; base: string; voice: string; model: string; keyHint: string; voiceHint: string }> };
/** #454 플랫폼 운영 — 영상 내레이션(TTS). Higgsfield API 에는 TTS 모델이 없어 공급자를 따로 연결한다(대표가 고름). 키가 없으면 영상은 자막만으로 완성 */
export function PlatformTts() {
  const { data, reload } = useApi<S>('/api/platform/tts');
  const [provider, setProvider] = useState<P | ''>(''); const [key, setKey] = useState(''); const [voice, setVoice] = useState(''); const [model, setModel] = useState(''); const [testing, setTesting] = useState(false);
  useEffect(() => { if (data) { setProvider(data.provider ?? ''); setVoice(data.voice); setModel(data.model); } }, [data]);
  if (!data) return null;
  const d = provider ? data.providers[provider] : null;
  async function save() {
    try {
      await api('/api/platform/tts', { method: 'PUT', body: { provider: provider || null, ...(key ? { apiKey: key } : {}), ...(provider ? { voice: voice || null, model: model || null } : {}) } });
      toast.ok('저장했습니다'); setKey(''); reload();
    } catch (e: any) { toast.error(e.message); }
  }
  async function test() { setTesting(true); try { const r = await api<{ ok: boolean; message: string }>('/api/platform/tts', { method: 'POST' }); (r.ok ? toast.ok : toast.error)(r.message); reload(); } catch (e: any) { toast.error(e.message); } finally { setTesting(false); } }
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="platform-tts">
      <h2 className="text-base font-bold">영상 내레이션(TTS) <span className={cx('ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', data.ready ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900')} data-testid="tts-state">{data.ready ? `켜짐 · ${data.providers[data.provider!].label}` : '키 필요 — 영상은 자막만'}</span></h2>
      <p className="mt-1 text-xs text-ink-2">제작의뢰실 영상의 장면 대사를 한국어로 읽어 넣습니다. Higgsfield API 에는 음성 모델이 없어 따로 연결합니다. 키가 없으면 내레이션 없이 자막(+배경음)으로 완성됩니다. 비용은 고른 공급자 콘솔에서 결제됩니다.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-[12rem_1fr_1fr_1fr_auto]">
        <Field label="공급자"><select className={inputCls} value={provider} onChange={(e) => { const v = e.target.value as P | ''; setProvider(v); setVoice(v ? data.providers[v].voice : ''); setModel(v ? data.providers[v].model : ''); }} aria-label="TTS 공급자" data-testid="tts-provider">
          <option value="">(없음 — 자막만)</option>{(Object.keys(data.providers) as P[]).map((k) => <option key={k} value={k}>{data.providers[k].label}</option>)}</select></Field>
        <Field label="키(바꿀 때만)"><input className={inputCls} type="password" value={key} onChange={(e) => setKey(e.target.value.trim())} disabled={!provider} placeholder={data.hasKey && provider === data.provider ? `저장됨(${data.keyHint ?? ''}) — 바꾸려면 입력` : d?.keyHint ?? '공급자를 먼저 고르세요'} aria-label="TTS 키" data-testid="tts-key" /></Field>
        <Field label="음성"><input className={inputCls} value={voice} onChange={(e) => setVoice(e.target.value)} disabled={!provider} placeholder={d?.voiceHint ?? ''} aria-label="TTS 음성" data-testid="tts-voice" /></Field>
        <Field label="모델"><input className={inputCls} value={model} onChange={(e) => setModel(e.target.value)} disabled={!provider || provider === 'clova'} placeholder={d?.model || '—'} aria-label="TTS 모델" /></Field>
        <div className="flex items-end"><Button size="sm" onClick={save} data-testid="tts-save">저장</Button></div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <Button size="sm" variant="secondary" onClick={test} disabled={!data.hasKey || testing} data-testid="tts-test">{testing ? '확인 중…' : '연결 시험'}</Button>
        {data.lastTest && <span className={cx('rounded-full px-2 py-0.5', data.lastTest.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800')} data-testid="tts-test-result">{data.lastTest.ok ? '✓' : '✕'} {data.lastTest.message}</span>}
        <span className="text-ink-3">OpenAI·ElevenLabs 연결 시험은 돈이 들지 않습니다(목록 조회). 클로바는 두 글자를 실제로 읽어 확인합니다.</span>
      </div>
    </section>
  );
}
