import { db } from './db';
import { decrypt, encrypt } from './crypto';

/**
 * Higgsfield 생성 연동(대표 10/20 19:00 제작의뢰실 3): 키는 플랫폼 운영(/platform)에서 대표가 넣고 암호화해 app_settings 에 보관, 모델 표(이미지·영상, 크레딧)는 운영자가 숫자만 바꿈.
 * 로컬 10/22 실제 API 대조(docs.higgsfield.ai): 주소 https://api.higgsfield.ai, 인증 `Authorization: Key 키ID:시크릿`, 모델마다 경로(= 모델 id),
 * 비동기 — 제출하면 {status:'queued', request_id, status_url} → status_url 폴링 → completed 에서 images[].url / video.url. 실패·nsfw 는 과금 안 됨.
 */
/** 로컬 10/20 22:30 ⑤: 구독 크레딧은 API 에 못 씀(console.higgsfield.ai 별도 선불, 달러 종량제) → 모델마다 usd(이미지 장당 / 영상 초당)도 두고 표시 단위를 고름 */
export type HfModel = { id: string; kind: 'image' | 'video'; name: string; credits: number; usd?: number | null; enabled: boolean; note?: string };
export type HfPricing = 'credits' | 'usd';
export type HfKeyIssue = 'missing_secret' | null;
export type HfSettings = { enabled: boolean; hasKey: boolean; keyIssue: HfKeyIssue; keyIdHint: string | null; base: string; models: HfModel[]; pricing: HfPricing; usdKrw: number; updatedAt: string | null; lastTest: { ok: boolean; message: string; at: string } | null };
export const HF_BASE = 'https://api.higgsfield.ai';
/** 모델 id = Higgsfield 엔드포인트 경로(문서의 Endpoint ID). 단가는 콘솔 모델 페이지 가격으로 운영자가 고친다 */
export const DEFAULT_MODELS: HfModel[] = [
  { id: 'higgsfield-ai/soul/v2/standard', kind: 'image', name: 'SOUL V2(실사·사람)', credits: 6.5, usd: 0.01, enabled: true, note: '실사 기본 · 1080p · 10/22 실측 $0.01/장' },
  { id: 'ideogram/v4.0', kind: 'image', name: 'Ideogram 4(글자 들어간 시안)', credits: 6.5, usd: 0.006, enabled: true, note: '포스터·글자 렌더' },
  { id: 'recraft/v4.1/text-to-image', kind: 'image', name: 'Recraft 4.1(일러스트·아이콘)', credits: 4, usd: 0.003, enabled: true },
  { id: 'kling-video/v3.0-turbo/text-to-video', kind: 'video', name: 'Kling 3 Turbo(3~15초)', credits: 80, usd: 0.09, enabled: true, note: '릴스·쇼츠 기본 · 초당' },
  { id: 'bytedance/seedance-2.5/text-to-video', kind: 'video', name: 'Seedance 2.5(4~30초·소리)', credits: 40, usd: 0.07, enabled: false, note: '초당' },
];
/** 10/20 판(실제 API 확인 전)에 쓰던 이름 → 실제 경로. 저장된 모델 표·의뢰 프롬프트에 남은 옛 이름을 읽을 때 바꾼다 */
const LEGACY: Record<string, string> = { gpt_image: 'higgsfield-ai/soul/v2/standard', recraft: 'recraft/v4.1/text-to-image', kling: 'kling-video/v3.0-turbo/text-to-video', seedance: 'bytedance/seedance-2.5/text-to-video' };
export const modelId = (id?: string | null) => (id ? LEGACY[id] ?? id : id ?? null);
function normalizeModels(list: HfModel[]): HfModel[] {
  const seen = new Set<string>(); const out: HfModel[] = [];
  for (const m of list) { const id = modelId(m.id)!; if (seen.has(id)) continue; seen.add(id); const d = DEFAULT_MODELS.find((x) => x.id === id);
    out.push(id === m.id ? m : { ...m, id, name: d?.name ?? m.name, note: d?.note ?? m.note }); }
  return out;
}
/** 엔드포인트별 입력 규칙(문서 입력 스키마) — 화면 비율은 가장 가까운 허용값으로, 길이는 허용 범위로 맞춘다. 표에 없는 경로는 prompt·aspect_ratio(+duration)만 보냄 */
const SOUL_AR = ['9:16', '16:9', '4:3', '3:4', '1:1', '2:3', '3:2'];
const ENDPOINTS: Record<string, { aspects?: string[]; dur?: [number, number]; durs?: number[]; negative?: boolean; noAspect?: boolean; extra?: Record<string, unknown> }> = {
  'higgsfield-ai/soul/v2/standard': { aspects: SOUL_AR, extra: { resolution: '1080p', batch_size: 1 } },
  'higgsfield-ai/soul/standard': { aspects: SOUL_AR, extra: { resolution: '1080p', batch_size: 1 } },
  'ideogram/v4.0': { aspects: ['1:1', '1:2', '2:1', '2:3', '3:2', '4:5', '5:4', '9:16', '16:9', '5:8', '8:5', '3:4', '4:3'] },
  'recraft/v4.1/text-to-image': { aspects: ['1:1', '2:1', '1:2', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16'], extra: { output_format: 'png' } },
  'kling-video/v3.0-turbo/text-to-video': { aspects: ['16:9', '9:16', '1:1'], dur: [3, 15], extra: { resolution: '1080p' } },
  'kling-video/v3.0/std/text-to-video': { aspects: ['16:9', '9:16', '1:1'], dur: [3, 15] },
  'kling-video/v2.5-turbo/pro/text-to-video': { noAspect: true, durs: [5, 10], negative: true },
  'bytedance/seedance-2.5/text-to-video': { aspects: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'], dur: [4, 30], extra: { resolution: '1080p' } },
};
const ratio = (a: string) => { const [w, h] = a.split(':').map(Number); return w > 0 && h > 0 ? w / h : 1; };
export function hfBody(model: string, opt: { kind: 'image' | 'video'; prompt: string; negative?: string; aspect: string; seconds?: number }) {
  const e = ENDPOINTS[model] ?? {};
  const body: Record<string, unknown> = { prompt: opt.prompt, ...e.extra };
  if (!e.noAspect) body.aspect_ratio = e.aspects && !e.aspects.includes(opt.aspect) ? e.aspects.reduce((b, a) => (Math.abs(Math.log(ratio(a) / ratio(opt.aspect))) < Math.abs(Math.log(ratio(b) / ratio(opt.aspect))) ? a : b)) : opt.aspect;
  if (opt.kind === 'video') {
    const s = Math.round(opt.seconds ?? 15);
    body.duration = e.durs ? e.durs.reduce((b, d) => (Math.abs(d - s) < Math.abs(b - s) ? d : b)) : e.dur ? Math.min(e.dur[1], Math.max(e.dur[0], s)) : s;
  }
  if (e.negative && opt.negative) body.negative_prompt = opt.negative;
  return body;
}

const KEY = 'higgsfield';
export async function hfSettings(): Promise<HfSettings & { apiKey?: string }> {
  const [r] = await db()<{ value: any }[]>`select value from app_settings where key = ${KEY}`;
  const v = r?.value ?? {};
  let apiKey: string | undefined;
  if (v.keyEnc) { try { apiKey = decrypt(v.keyEnc); } catch { apiKey = undefined; } }
  if (!apiKey && process.env.HIGGSFIELD_API_KEY) apiKey = process.env.HIGGSFIELD_API_KEY;
  const models = normalizeModels(Array.isArray(v.models) && v.models.length ? v.models : DEFAULT_MODELS);
  const keyIssue: HfKeyIssue = apiKey && !/^[^:\s]+:[^:\s]+$/.test(apiKey) ? 'missing_secret' : null;
  const keyIdHint = apiKey ? `${apiKey.split(':')[0].slice(0, 4)}…` : null; // 키 ID 앞 4자만(시크릿은 절대 안 보임) — 어떤 키가 들어갔는지 대표가 콘솔과 맞춰 보게
  const stored = v.base && !/platform\.higgsfield\.ai/.test(v.base) ? v.base : null; // 10/20 판 기본값(platform.…)은 버림
  return { enabled: !!v.enabled && !!apiKey && !keyIssue, hasKey: !!apiKey, keyIssue, keyIdHint, base: stored || process.env.HIGGSFIELD_API_BASE || HF_BASE, models, pricing: v.pricing === 'usd' ? 'usd' : 'credits',
    usdKrw: Number(v.usdKrw) || Number(process.env.USD_KRW) || 1400, updatedAt: v.updatedAt ?? null, lastTest: v.lastTest ?? null, apiKey };
}
export async function saveHfSettings(i: { apiKey?: string | null; keyId?: string | null; keySecret?: string | null; enabled?: boolean; base?: string | null; models?: HfModel[]; pricing?: HfPricing; usdKrw?: number }, actorId: string) {
  const [r] = await db()<{ value: any }[]>`select value from app_settings where key = ${KEY}`;
  const v = { ...(r?.value ?? {}) };
  // 키 ID·시크릿 두 칸(또는 'ID:시크릿' 한 칸) — 둘 다 오면 합쳐 'ID:시크릿' 으로 암호화 보관
  const key = i.keyId?.trim() && i.keySecret?.trim() ? `${i.keyId.trim()}:${i.keySecret.trim()}` : i.apiKey === undefined ? undefined : i.apiKey?.trim() ?? null;
  if (key !== undefined) { if (key) v.keyEnc = encrypt(key); else delete v.keyEnc; delete v.lastTest; }
  if (i.enabled !== undefined) v.enabled = i.enabled;
  if (i.base !== undefined) v.base = i.base || null;
  if (i.models) v.models = normalizeModels(i.models);
  if (i.pricing) v.pricing = i.pricing;
  if (i.usdKrw) v.usdKrw = i.usdKrw;
  v.updatedAt = new Date().toISOString(); v.updatedBy = actorId;
  await db()`insert into app_settings (key, value) values (${KEY}, ${db().json(v)}) on conflict (key) do update set value = excluded.value`;
  return hfSettings();
}
export const modelFor = (models: HfModel[], kind: 'image' | 'video', id?: string | null) => { const want = modelId(id);
  return models.find((m) => m.enabled && m.kind === kind && (!want || m.id === want)) ?? models.find((m) => m.enabled && m.kind === kind) ?? null; };

/** 응답 오류를 화면에 그대로 보일 한 줄로(대표가 원인을 바로 알게) */
const STATUS_KO: Record<number, string> = { 400: '요청 거절(입력값·동시 실행 한도)', 401: '인증 실패 — 키 ID·시크릿을 확인하세요', 403: '잔액 부족 — console.higgsfield.ai 에서 충전', 404: '모델 경로가 없거나 이 계정에서 쓸 수 없음', 422: '입력값 검사 실패', 423: '모델 일시 차단', 429: '요청이 너무 많음', 503: '모델 꺼짐·준비 안 됨' };
function errText(status: number, j: any) {
  const d = j?.detail; const msg = typeof d === 'string' ? d : Array.isArray(d) ? d.map((x: any) => `${(x?.loc ?? []).slice(1).join('.')} ${x?.msg ?? ''}`.trim()).join('; ') : j?.message ?? j?.error ?? '';
  return `HTTP ${status} ${STATUS_KO[status] ?? (status >= 500 ? 'Higgsfield 서버 오류' : '')}${msg ? ` · ${String(msg).slice(0, 200)}` : ''}`.trim();
}
async function creds(): Promise<{ s: HfSettings; err: string | null; auth: string; base: string }> {
  const s = await hfSettings(); const base = s.base.replace(/\/$/, '');
  if (!s.apiKey) return { s, err: 'not_configured', auth: '', base };
  if (s.keyIssue) return { s, err: '키 형식 오류 — 키 ID 와 시크릿이 모두 필요합니다(ID:시크릿)', auth: '', base };
  return { s, err: null, auth: `Key ${s.apiKey}`, base };
}
/** status_url 은 응답 값을 쓰되 같은 API 주소일 때만(키가 다른 곳으로 새지 않게) — 아니면 request_id 로 만든다 */
function statusUrlFor(base: string, requestId: string, given?: string | null) {
  try { if (given && new URL(given).origin === new URL(base).origin) return given; } catch { /* 아래 */ }
  return `${base}/requests/${encodeURIComponent(requestId)}/status`;
}

export type HfSubmit = { ok: true; requestId: string; statusUrl: string } | { ok: false; error: string };
/** 생성 제출(과금 시작) — 연동이 켜져 있을 때만. 결과는 hfStatus 로 받는다 */
export async function hfSubmit(opt: { kind: 'image' | 'video'; model: string; prompt: string; negative?: string; aspect: string; seconds?: number; idempotencyKey: string }): Promise<HfSubmit> {
  const c = await creds();
  if (c.err) return { ok: false, error: c.err };
  if (!c.s.enabled) return { ok: false, error: 'not_configured' };
  const model = modelId(opt.model)!;
  if (!/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)+$/i.test(model)) return { ok: false, error: `모델 경로 형식이 아닙니다: ${model}` };
  try {
    const res = await fetch(`${c.base}/${model}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', authorization: c.auth, 'idempotency-key': opt.idempotencyKey },
      body: JSON.stringify(hfBody(model, opt)), signal: AbortSignal.timeout(60000) });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: errText(res.status, j) };
    if (!j?.request_id) return { ok: false, error: `응답에 request_id 가 없습니다(${String(j?.status ?? '')})` };
    return { ok: true, requestId: String(j.request_id), statusUrl: statusUrlFor(c.base, String(j.request_id), j.status_url) };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e).slice(0, 200) }; }
}

export type HfState = 'queued' | 'in_progress' | 'completed' | 'failed' | 'nsfw' | 'canceled';
export type HfStatus = { ok: true; status: HfState; urls: string[]; error?: string } | { ok: false; error: string; retry: boolean };
export const HF_TERMINAL = new Set<HfState>(['completed', 'failed', 'nsfw', 'canceled']);
export async function hfStatus(requestId: string, statusUrl?: string | null): Promise<HfStatus> {
  const c = await creds();
  if (c.err) return { ok: false, error: c.err, retry: false };
  try {
    const res = await fetch(statusUrlFor(c.base, requestId, statusUrl), { headers: { accept: 'application/json', authorization: c.auth }, signal: AbortSignal.timeout(30000) });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: errText(res.status, j), retry: res.status >= 500 || res.status === 429 };
    const urls = [...(Array.isArray(j.images) ? j.images.map((x: any) => x?.url) : []), j.video?.url, j.image?.url].filter((x): x is string => typeof x === 'string' && /^https?:\/\//.test(x));
    return { ok: true, status: j.status as HfState, urls, error: j.status === 'nsfw' ? '콘텐츠 검수에 걸림(과금 없음)' : j.error ? String(j.error).slice(0, 200) : undefined };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e).slice(0, 200), retry: true }; }
}

/** [연결 시험] — 돈이 들지 않는 호출: 없는 요청 id 의 상태 조회. 404 = 키 맞음(그런 요청 없음), 401 = 키 틀림. 결과는 설정에 남겨 화면에 보임 */
export async function hfTest(actorId: string) {
  const c = await creds();
  let out: { ok: boolean; message: string };
  if (c.err === 'not_configured') out = { ok: false, message: '키가 없습니다 — 키 ID·시크릿을 넣고 저장하세요' };
  else if (c.err) out = { ok: false, message: c.err };
  else {
    try {
      const res = await fetch(`${c.base}/requests/00000000-0000-4000-8000-000000000000/status`, { headers: { accept: 'application/json', authorization: c.auth }, signal: AbortSignal.timeout(15000) });
      const j: any = await res.json().catch(() => ({}));
      out = res.status === 404 || res.ok ? { ok: true, message: `연결됨 — 키가 맞습니다(${c.base.replace(/^https?:\/\//, '')})` } : { ok: false, message: errText(res.status, j) };
    } catch (e: any) { out = { ok: false, message: `연결 실패 — ${String(e?.message ?? e).slice(0, 160)}` }; }
  }
  const [r] = await db()<{ value: any }[]>`select value from app_settings where key = ${KEY}`;
  const v = { ...(r?.value ?? {}), lastTest: { ...out, at: new Date().toISOString(), by: actorId } };
  await db()`insert into app_settings (key, value) values (${KEY}, ${db().json(v)}) on conflict (key) do update set value = excluded.value`;
  return out;
}

/** 예상 비용 표시: 크레딧 또는 달러(이미지 장당, 영상 초당 × 초) + 원 환산 */
export function hfEstimate(m: HfModel | null, quantity: number, seconds: number, s: Pick<HfSettings, 'pricing' | 'usdKrw'>) {
  const credits = (m?.credits ?? (m?.kind === 'video' ? 80 : 6.5)) * quantity;
  const usd = m?.usd != null ? Math.round(m.usd * (m.kind === 'video' ? seconds : 1) * quantity * 1000) / 1000 : null;
  const label = s.pricing === 'usd' && usd != null ? `약 $${usd} (≈${Math.round(usd * s.usdKrw).toLocaleString('ko-KR')}원)` : `${credits}크레딧`;
  return { credits, usd, label };
}
