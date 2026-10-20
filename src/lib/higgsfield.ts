import { db } from './db';
import { decrypt, encrypt } from './crypto';

/**
 * Higgsfield 생성 연동(대표 10/20 19:00 제작의뢰실 3): 키는 플랫폼 운영(/platform)에서 대표가 넣고 암호화해 app_settings 에 보관, 모델 표(이미지·영상, 크레딧)는 운영자가 숫자만 바꿈.
 * API 호출 어댑터는 키가 발급돼 실제 응답을 볼 때 맞춘다(지금은 enabled=false 기본 → 제작 요청 카드로 로컬 도우미에 전달). 돈이 드는 생성은 월 한도·주 크레딧 검사를 거친다.
 */
/** 로컬 10/20 22:30 ⑤: 구독 크레딧은 API 에 못 씀(console.higgsfield.ai 별도 선불, 달러 종량제) → 모델마다 usd(이미지 장당 / 영상 초당)도 두고 표시 단위를 고름 */
export type HfModel = { id: string; kind: 'image' | 'video'; name: string; credits: number; usd?: number | null; enabled: boolean; note?: string };
export type HfPricing = 'credits' | 'usd';
export type HfSettings = { enabled: boolean; hasKey: boolean; base: string; models: HfModel[]; pricing: HfPricing; usdKrw: number; updatedAt: string | null };
export const DEFAULT_MODELS: HfModel[] = [
  { id: 'gpt_image', kind: 'image', name: 'GPT Image(실사·글자)', credits: 6.5, usd: 0.006, enabled: true, note: '실사 + 글자 렌더 기본' },
  { id: 'recraft', kind: 'image', name: 'Recraft(일러스트·아이콘)', credits: 4, usd: 0.003, enabled: true },
  { id: 'kling', kind: 'video', name: 'Kling(15초 영상)', credits: 80, usd: 0.09, enabled: true, note: '릴스·쇼츠 기본 · 초당' },
  { id: 'seedance', kind: 'video', name: 'Seedance(짧은 컷)', credits: 40, usd: 0.07, enabled: false, note: '초당' },
];
const KEY = 'higgsfield';
export async function hfSettings(): Promise<HfSettings & { apiKey?: string }> {
  const [r] = await db()<{ value: any }[]>`select value from app_settings where key = ${KEY}`;
  const v = r?.value ?? {};
  let apiKey: string | undefined;
  if (v.keyEnc) { try { apiKey = decrypt(v.keyEnc); } catch { apiKey = undefined; } }
  if (!apiKey && process.env.HIGGSFIELD_API_KEY) apiKey = process.env.HIGGSFIELD_API_KEY;
  const models: HfModel[] = Array.isArray(v.models) && v.models.length ? v.models : DEFAULT_MODELS;
  return { enabled: !!v.enabled && !!apiKey, hasKey: !!apiKey, base: v.base || process.env.HIGGSFIELD_API_BASE || 'https://platform.higgsfield.ai', models, pricing: v.pricing === 'usd' ? 'usd' : 'credits', usdKrw: Number(v.usdKrw) || Number(process.env.USD_KRW) || 1400, updatedAt: v.updatedAt ?? null, apiKey };
}
export async function saveHfSettings(i: { apiKey?: string | null; enabled?: boolean; base?: string | null; models?: HfModel[]; pricing?: HfPricing; usdKrw?: number }, actorId: string) {
  const [r] = await db()<{ value: any }[]>`select value from app_settings where key = ${KEY}`;
  const v = { ...(r?.value ?? {}) };
  if (i.apiKey !== undefined) { if (i.apiKey) v.keyEnc = encrypt(i.apiKey); else delete v.keyEnc; }
  if (i.enabled !== undefined) v.enabled = i.enabled;
  if (i.base !== undefined) v.base = i.base || null;
  if (i.models) v.models = i.models;
  if (i.pricing) v.pricing = i.pricing;
  if (i.usdKrw) v.usdKrw = i.usdKrw;
  v.updatedAt = new Date().toISOString(); v.updatedBy = actorId;
  await db()`insert into app_settings (key, value) values (${KEY}, ${db().json(v)}) on conflict (key) do update set value = excluded.value`;
  return hfSettings();
}
export const modelFor = (models: HfModel[], kind: 'image' | 'video', id?: string | null) => models.find((m) => m.enabled && m.kind === kind && (!id || m.id === id)) ?? models.find((m) => m.enabled && m.kind === kind) ?? null;

/** 생성 호출 — 키·연동이 켜져 있을 때만. 응답 형식은 실제 키로 확인한 뒤 맞춘다(실패하면 호출자가 제작 요청 카드로 넘김) */
export async function hfGenerate(opt: { kind: 'image' | 'video'; model: string; prompt: string; negative?: string; aspect: string; seconds?: number }): Promise<{ ok: true; url: string; mime: string } | { ok: false; error: string }> {
  const s = await hfSettings();
  if (!s.enabled || !s.apiKey) return { ok: false, error: 'not_configured' };
  try {
    const res = await fetch(`${s.base.replace(/\/$/, '')}/v1/${opt.kind === 'video' ? 'videos' : 'images'}/generations`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${s.apiKey}` },
      body: JSON.stringify({ model: opt.model, prompt: opt.prompt, negative_prompt: opt.negative ?? '', aspect_ratio: opt.aspect, ...(opt.kind === 'video' ? { duration: opt.seconds ?? 15 } : {}) }), signal: AbortSignal.timeout(120000) });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${String(j?.error?.message ?? j?.message ?? '').slice(0, 200)}` };
    const url = j?.data?.[0]?.url ?? j?.url ?? j?.output?.[0] ?? null;
    if (!url) return { ok: false, error: 'no_url' };
    return { ok: true, url, mime: opt.kind === 'video' ? 'video/mp4' : 'image/png' };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e).slice(0, 200) }; }
}

/** 예상 비용 표시: 크레딧 또는 달러(이미지 장당, 영상 초당 × 초) + 원 환산 */
export function hfEstimate(m: HfModel | null, quantity: number, seconds: number, s: Pick<HfSettings, 'pricing' | 'usdKrw'>) {
  const credits = (m?.credits ?? (m?.kind === 'video' ? 80 : 6.5)) * quantity;
  const usd = m?.usd != null ? Math.round(m.usd * (m.kind === 'video' ? seconds : 1) * quantity * 1000) / 1000 : null;
  const label = s.pricing === 'usd' && usd != null ? `약 $${usd} (≈${Math.round(usd * s.usdKrw).toLocaleString('ko-KR')}원)` : `${credits}크레딧`;
  return { credits, usd, label };
}
