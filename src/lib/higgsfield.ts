import { db } from './db';
import { decrypt, encrypt } from './crypto';

/**
 * Higgsfield 생성 연동(대표 10/20 19:00 제작의뢰실 3): 키는 플랫폼 운영(/platform)에서 대표가 넣고 암호화해 app_settings 에 보관, 모델 표(이미지·영상, 크레딧)는 운영자가 숫자만 바꿈.
 * API 호출 어댑터는 키가 발급돼 실제 응답을 볼 때 맞춘다(지금은 enabled=false 기본 → 제작 요청 카드로 로컬 도우미에 전달). 돈이 드는 생성은 월 한도·주 크레딧 검사를 거친다.
 */
export type HfModel = { id: string; kind: 'image' | 'video'; name: string; credits: number; enabled: boolean; note?: string };
export type HfSettings = { enabled: boolean; hasKey: boolean; base: string; models: HfModel[]; updatedAt: string | null };
export const DEFAULT_MODELS: HfModel[] = [
  { id: 'gpt_image', kind: 'image', name: 'GPT Image(실사·글자)', credits: 6.5, enabled: true, note: '실사 + 글자 렌더 기본' },
  { id: 'recraft', kind: 'image', name: 'Recraft(일러스트·아이콘)', credits: 4, enabled: true },
  { id: 'kling', kind: 'video', name: 'Kling(15초 영상)', credits: 80, enabled: true, note: '릴스·쇼츠 기본' },
  { id: 'seedance', kind: 'video', name: 'Seedance(짧은 컷)', credits: 40, enabled: false },
];
const KEY = 'higgsfield';
export async function hfSettings(): Promise<HfSettings & { apiKey?: string }> {
  const [r] = await db()<{ value: any }[]>`select value from app_settings where key = ${KEY}`;
  const v = r?.value ?? {};
  let apiKey: string | undefined;
  if (v.keyEnc) { try { apiKey = decrypt(v.keyEnc); } catch { apiKey = undefined; } }
  if (!apiKey && process.env.HIGGSFIELD_API_KEY) apiKey = process.env.HIGGSFIELD_API_KEY;
  const models: HfModel[] = Array.isArray(v.models) && v.models.length ? v.models : DEFAULT_MODELS;
  return { enabled: !!v.enabled && !!apiKey, hasKey: !!apiKey, base: v.base || process.env.HIGGSFIELD_API_BASE || 'https://platform.higgsfield.ai', models, updatedAt: v.updatedAt ?? null, apiKey };
}
export async function saveHfSettings(i: { apiKey?: string | null; enabled?: boolean; base?: string | null; models?: HfModel[] }, actorId: string) {
  const [r] = await db()<{ value: any }[]>`select value from app_settings where key = ${KEY}`;
  const v = { ...(r?.value ?? {}) };
  if (i.apiKey !== undefined) { if (i.apiKey) v.keyEnc = encrypt(i.apiKey); else delete v.keyEnc; }
  if (i.enabled !== undefined) v.enabled = i.enabled;
  if (i.base !== undefined) v.base = i.base || null;
  if (i.models) v.models = i.models;
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
