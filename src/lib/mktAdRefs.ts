import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { badRequest, forbidden, notFound } from './errors';
import { zUuid } from './api';
import { tenantOf, type SessionUser } from './types';
import { aiJson } from './mktOps';
import { ymd } from './mktGoals';

/**
 * #499-6 경쟁 광고 보관함(테크트리 L4·EP.3 — docs/handoff/TECHTREE_VIDEOS_2026-10-23.md 3장 6번). 수집은 사람이, 분석은 AI 가.
 * Meta 광고 라이브러리 API 는 한국 일반 광고를 주지 않고, 화면을 긁는 방식은 워크인 정책(크롤링 금지)과 맞지 않는다 →
 * ① 직원이 광고 라이브러리·게시물 링크를 붙이거나(서버는 링크를 열어 보지 않음) 영상·이미지를 자료실에 올린다
 * ② 영상은 화면이 음성만 뽑아 올리고 서버가 받아쓰기(STT, 쓰고 나면 음성 파일은 지움) — 대본은 직접 붙여도 됨
 * ③ 첫 문장 → 훅 유형(질문·가격·상황극·비교·숫자·공감) 규칙 분류(무료), [AI 분석]은 한 편씩 뼈대(훅→문제→제안→행동)·제안·각도
 * ④ 2~12개를 묶어 [공통 구조 분석] → 공통점·공통 구조·우리 브랜드 광고 대본 3안(광고형 점수) — 월요일마다 지난 7일 새 광고 3개 이상이면 자동(주 1회)
 * 오래 돌린 광고(시작일 → n일째)·같은 업체가 비슷한 소재를 돌린 수도 함께 기록(오래·많이 = 팔리는 광고일 가능성).
 */
export const HOOK_TYPES = { question: '질문형', price: '가격·혜택형', skit: '상황극형', compare: '비교형', number: '숫자형', empathy: '공감형', other: '기타' } as const;
export const PLATFORMS = { meta: 'Meta 광고 라이브러리', instagram: '인스타그램', youtube: '유튜브', tiktok: '틱톡', naver: '네이버', other: '기타' } as const;
export const FORMATS = { video: '영상', image: '이미지', carousel: '캐러셀', text: '글' } as const;
type HookType = keyof typeof HOOK_TYPES;
const HOOK_KEYS = Object.keys(HOOK_TYPES) as HookType[];
const LONG_RUN_DAYS = 30; // 이만큼 넘게 돌린 광고 = 효과가 있었을 가능성

const SKIT = /^[“"'‘「『]|^[가-힣A-Za-z]{1,8}\s?[:：]\s|["“”「」『』]/;
const QUESTION = /[?？]|(?:나요|까요|을까|ㄹ까|는지|인가요|일까|아세요|있나요|되나요)\s*[.!…]*$/;
const PRICE = /\d[\d,]*\s?(?:만\s?)?원|\d+\s?%|할인|무료|특가|이벤트|쿠폰|혜택|증정|최저가|가격|1\s?\+\s?1/;
const COMPARE = /\bvs\b|대신|보다|차이|비교|말고|와\s?다른|과\s?다른/i;
const NUMBER = /^\D{0,6}\d|\d+\s?(?:가지|개|초|분|일|주|개월|년|배|단계|명)|TOP\s?\d/i;
const EMPATHY = /죠[.!…]*$|잖아요|힘드|힘들|고민|지치|불안|걱정|답답|막막|저만|나만/;
/** 첫 문장 훅 유형(규칙) — 대화·따옴표면 상황극, 그다음 질문 > 가격 > 비교 > 숫자 > 공감 */
export function hookTypeOf(text: string | null | undefined): HookType | null {
  const t = String(text ?? '').trim(); if (!t) return null;
  if (SKIT.test(t)) return 'skit'; if (QUESTION.test(t)) return 'question'; if (PRICE.test(t)) return 'price';
  if (COMPARE.test(t)) return 'compare'; if (NUMBER.test(t)) return 'number'; if (EMPATHY.test(t)) return 'empathy';
  return 'other';
}
/** 대본 첫 문장(마침표·물음표·느낌표·줄바꿈까지) */
export const firstSentence = (s: string) => (String(s ?? '').split(/(?<=[.!?？…])\s+|\n+/).map((x) => x.trim()).find(Boolean) ?? '').slice(0, 200);
export function platformOf(url: string | null | undefined): keyof typeof PLATFORMS {
  if (!url) return 'other';
  let h = ''; try { h = new URL(url).hostname.toLowerCase(); } catch { return 'other'; }
  if (/(^|\.)instagram\.com$/.test(h)) return 'instagram';
  if (/(^|\.)(facebook\.com|fb\.com|fb\.watch)$/.test(h)) return 'meta';
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(h)) return 'youtube';
  if (/(^|\.)tiktok\.com$/.test(h)) return 'tiktok';
  if (/(^|\.)naver\.(com|me)$/.test(h)) return 'naver';
  return 'other';
}
/** ISO 주(서울 날짜 기준) — 주간 분석은 회사마다 한 주 한 번 */
export function isoWeek(day: string) {
  const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3); // 그 주 목요일
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const wk = 1 + Math.round(((d.getTime() - jan4.getTime()) / 864e5 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD');
const zUrl = z.string().trim().max(500).refine((s) => !s || /^https?:\/\/\S+$/i.test(s), '링크는 http(s):// 로 시작해야 합니다');
const fields = { brandId: zUuid.nullable().optional(), advertiser: z.string().trim().min(1, '업체·페이지 이름을 적어 주세요').max(80), url: zUrl.optional(),
  format: z.enum(['video', 'image', 'carousel', 'text']).default('video'), startedOn: dateStr.nullable().optional(), variants: z.number().int().min(1).max(999).nullable().optional(),
  transcript: z.string().max(8000).optional(), hook: z.string().trim().max(200).optional(), note: z.string().trim().max(500).optional() };
export const adRefInput = z.object({ ...fields, mediaId: zUuid.nullable().optional(), audioFileId: zUuid.optional(), duration: z.number().min(0).max(3600).optional() });
export const adRefPatch = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save'), ...fields, advertiser: fields.advertiser.optional(), format: z.enum(['video', 'image', 'carousel', 'text']).optional(), hookType: z.enum(HOOK_KEYS as [HookType, ...HookType[]]).optional() }),
  z.object({ action: z.literal('star'), starred: z.boolean() }), z.object({ action: z.literal('analyze') }), z.object({ action: z.literal('remove') })]);
export const adRefReportInput = z.object({ ids: z.array(zUuid).min(2, '보관함에서 2개 이상 골라 주세요').max(12, '한 번에 12개까지 묶습니다'), brandId: zUuid.nullable().optional(), product: z.string().trim().max(120).optional() });

type Ref = { id: string; tenant: string; brand_id: string | null; advertiser: string; url: string | null; platform: string; format: keyof typeof FORMATS; media_id: string | null; started_on: string | null; variants: number | null;
  transcript: string | null; hook: string | null; hook_type: HookType | null; analysis: any; note: string | null; starred: boolean; stt_note: string | null; analyzed_at: string | null; created_by: string | null; created_at: string; updated_at: string };
const daysSince = (d: string | null, today = ymd(new Date())) => (d ? Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`)) / 864e5)) : null);

/** 영상 음성(화면이 뽑아 올린 WAV) → 글자. 쓰고 나면 음성 파일은 자료실에서 지운다. 키·한도가 없으면 이유만 남김 */
async function transcribe(u: SessionUser, audioFileId: string, duration?: number) {
  const { loadLibraryFile } = await import('./library');
  const a = await loadLibraryFile(u, audioFileId, 'ai').catch(() => null);
  if (!a || a.created_by !== u.id || !/^audio\//.test(a.mime_type)) throw badRequest('음성 파일을 찾을 수 없습니다');
  const sql = db(); const t = tenantOf(u);
  let text: string | null = null; let note: string | null = null;
  try {
    const S = await import('./ai/stt');
    if (!S.sttConfigured()) note = '받아쓰기 미설정(STT 키 없음) — 대본을 직접 붙여 주세요';
    else {
      await (await import('./mktAuto')).assertMktAi(t);
      const r = await S.transcribeAudio(await (await import('./storage')).getObject(a.storage_key), a.file_name, a.mime_type);
      text = r.text || null; if (!text) note = '음성에서 말을 찾지 못했습니다';
      const secs = duration ?? Math.max(1, Number(a.size_bytes) / 32000); // WAV 16kHz·16bit·모노 = 32KB/초
      await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
        values (${t}, ${u.id}, ${randomUUID()}, 'openai', ${r.model}, 0, 0, 0, 0, ${S.sttCostUsd(secs)}, 'marketing_adref_stt')`;
    }
  } catch (e) { note = `받아쓰기 실패: ${clip((e as Error)?.message ?? e, 150)}`; }
  await sql`update library_files set deleted_at = now(), updated_at = now() where id = ${a.id} and tenant = ${t}`.catch(() => {});
  return { text, note };
}
async function mediaCheck(u: SessionUser, id: string) {
  const { loadLibraryFile } = await import('./library');
  const f = await loadLibraryFile(u, id, 'meta');
  if (!/^(video|image)\//.test(f.mime_type)) throw badRequest(`영상·이미지가 아닌 자료입니다: ${f.title}`);
  return f;
}
async function brandOk(t: string, brandId: string | null | undefined) {
  if (!brandId) return;
  const [b] = await db()`select id from mkt_brands where id = ${brandId} and tenant = ${t}`;
  if (!b) throw notFound('브랜드를 찾을 수 없습니다');
}

// ---------------- 보기 ----------------
async function viewRows(t: string, id?: string) {
  const sql = db(); const today = ymd(new Date());
  const rows = await sql<(Ref & { brand_name: string | null; created_by_name: string | null; media_mime: string | null; media_title: string | null })[]>`
    select r.*, b.name as brand_name, cu.name as created_by_name, f.mime_type as media_mime, coalesce(nullif(f.title, ''), f.file_name) as media_title
    from mkt_ad_refs r left join mkt_brands b on b.id = r.brand_id left join users cu on cu.id = r.created_by left join library_files f on f.id = r.media_id and f.deleted_at is null
    where r.tenant = ${t} ${id ? sql`and r.id = ${id}` : sql`and true`} order by r.starred desc, r.created_at desc limit 100`;
  return rows.map((r) => ({ ...r, started_on: r.started_on ? String(r.started_on).slice(0, 10) : null, days: daysSince(r.started_on, today) }));
}
export async function adRefView(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const t = tenantOf(u); const sql = db();
  const reports = await sql`select r.id, r.kind, r.week, r.brand_id, b.name as brand_name, r.product, r.result, r.source, r.ref_ids, r.created_at, cu.name as created_by_name,
      (select coalesce(array_agg(x.advertiser order by x.created_at), '{}') from mkt_ad_refs x where x.id = any(r.ref_ids) and x.tenant = r.tenant) as advertisers
    from mkt_ad_ref_reports r left join mkt_brands b on b.id = r.brand_id left join users cu on cu.id = r.created_by where r.tenant = ${t} order by r.created_at desc limit 10`;
  const brands = await sql<{ id: string; name: string }[]>`select id, name from mkt_brands where tenant = ${t} order by name`;
  return { items: await viewRows(t), reports, brands, hookTypes: HOOK_TYPES, platforms: PLATFORMS, formats: FORMATS, longRunDays: LONG_RUN_DAYS, canDecide: isAdmin(u), userId: u.id,
    aiEnabled: (await import('./ai/provider')).aiEnabled(), sttEnabled: (await import('./ai/stt')).sttConfigured() };
}
async function load(u: SessionUser, id: string) {
  await assertSpace(u, 'marketing');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('보관함에 없는 광고입니다');
  const [r] = await db()<Ref[]>`select * from mkt_ad_refs where id = ${id} and tenant = ${tenantOf(u)}`;
  if (!r) throw notFound('보관함에 없는 광고입니다'); // 다른 회사 것은 없는 것처럼
  return r;
}

// ---------------- 넣기·고치기 ----------------
/** [보관함에 넣기](마케팅 공간 누구나): 링크·영상/이미지·대본 중 하나 이상 → 받아쓰기(영상 음성) → 첫 문장·훅 유형(규칙) */
export async function createAdRef(u: SessionUser, i: z.infer<typeof adRefInput>) {
  await assertSpace(u, 'marketing');
  const t = tenantOf(u); await brandOk(t, i.brandId);
  if (i.mediaId) await mediaCheck(u, i.mediaId);
  if (!i.url && !i.mediaId && !i.transcript?.trim() && !i.hook?.trim()) throw badRequest('링크·영상(이미지)·대본 중 하나는 넣어 주세요');
  const stt = i.audioFileId ? await transcribe(u, i.audioFileId, i.duration) : { text: null, note: null };
  const transcript = (i.transcript?.trim() || stt.text || '').slice(0, 8000) || null;
  const hook = (i.hook?.trim() || firstSentence(transcript ?? '')).slice(0, 200) || null;
  const [r] = await db()<{ id: string }[]>`insert into mkt_ad_refs (tenant, brand_id, advertiser, url, platform, format, media_id, started_on, variants, transcript, hook, hook_type, note, stt_note, created_by)
    values (${t}, ${i.brandId ?? null}, ${i.advertiser}, ${i.url || null}, ${platformOf(i.url)}, ${i.format}, ${i.mediaId ?? null}, ${i.startedOn ?? null}, ${i.variants ?? null}, ${transcript}, ${hook}, ${hookTypeOf(hook)},
      ${i.note || null}, ${stt.note}, ${u.id}) returning id`;
  return { item: (await viewRows(t, r.id))[0], sttNote: stt.note };
}
/** 고치기·삭제 = 넣은 사람·관리자 · ★ 참고 표시·[AI 분석] = 마케팅 공간 누구나 */
export async function patchAdRef(u: SessionUser, id: string, i: z.infer<typeof adRefPatch>) {
  const r = await load(u, id); const sql = db();
  const own = r.created_by === u.id || isAdmin(u);
  if (i.action === 'star') { await sql`update mkt_ad_refs set starred = ${i.starred}, updated_at = now() where id = ${id}`; return { item: (await viewRows(r.tenant, id))[0] }; }
  if (i.action === 'remove') {
    if (!own) throw forbidden('넣은 사람이나 관리자만 뺍니다');
    await sql`delete from mkt_ad_refs where id = ${id}`; return { ok: true };
  }
  if (i.action === 'analyze') return analyzeAdRef(u, r);
  if (!own) throw forbidden('넣은 사람이나 관리자만 고칩니다');
  await brandOk(r.tenant, i.brandId);
  const transcript = i.transcript !== undefined ? i.transcript.trim().slice(0, 8000) || null : r.transcript;
  const hook = i.hook !== undefined ? i.hook.trim() || firstSentence(transcript ?? '') || null : i.transcript !== undefined && !r.hook ? firstSentence(transcript ?? '') || null : r.hook;
  const hookType = i.hookType ?? (hook !== r.hook ? hookTypeOf(hook) : r.hook_type);
  const url = i.url !== undefined ? i.url || null : r.url;
  await sql`update mkt_ad_refs set advertiser = ${i.advertiser ?? r.advertiser}, url = ${url}, platform = ${platformOf(url)}, format = ${i.format ?? r.format},
    brand_id = ${i.brandId !== undefined ? i.brandId : r.brand_id}, started_on = ${i.startedOn !== undefined ? i.startedOn : r.started_on}, variants = ${i.variants !== undefined ? i.variants : r.variants},
    transcript = ${transcript}, hook = ${hook}, hook_type = ${hookType}, note = ${i.note !== undefined ? i.note || null : r.note}, updated_at = now() where id = ${id}`;
  return { item: (await viewRows(r.tenant, id))[0] };
}

// ---------------- AI 분석(한 편) ----------------
const SCRIPT_SYS = `당신은 경력 30년의 퍼포먼스 마케터입니다. 경쟁사 광고 한 편의 대본을 뜯어봅니다. JSON 만.
- hook: 첫 문장(대본 그대로, 없으면 빈 문자열)
- hookType: question(질문)·price(가격·혜택)·skit(상황극·대화)·compare(비교)·number(숫자)·empathy(공감)·other 중 하나
- beats: 순서대로 3~6개 {part(훅·문제·제안·근거·장점·행동 중 하나), text(한 줄 요약)}
- offer: 무엇을 주는가(무료 상담·체험·할인 등, 없으면 빈 문자열) · cta: 마지막 행동 요청 · angle: 노리는 고객·상황 한 줄
- why: 오래·많이 돌렸다면 왜 먹혔을지 '추정:'으로 시작하는 한 줄(근거가 없으면 빈 문자열)
대본·메모에 없는 내용은 지어내지 않습니다. 업체를 깎아내리는 평가는 하지 않습니다.`;
async function analyzeAdRef(u: SessionUser, r: Ref) {
  const body = r.transcript || r.hook || r.note;
  if (!body) throw badRequest('대본이나 첫 문장이 없어 분석할 수 없습니다 — 대본을 붙이거나 영상을 올려 주세요');
  const days = daysSince(r.started_on);
  let o: any;
  try {
    o = await aiJson(r.tenant, u.id, SCRIPT_SYS, `업체: ${r.advertiser}\n형식: ${FORMATS[r.format] ?? r.format}\n게재: ${days !== null ? `${r.started_on}부터 ${days}일째` : '모름'}${r.variants ? ` · 비슷한 소재 ${r.variants}개` : ''}${r.note ? `\n메모: ${r.note}` : ''}\n\n[대본]\n${String(body).slice(0, 6000)}`,
      { type: 'object', additionalProperties: false, required: ['hook', 'hookType', 'beats', 'offer', 'cta', 'angle', 'why'], properties: { hook: { type: 'string' }, hookType: { type: 'string' }, offer: { type: 'string' }, cta: { type: 'string' }, angle: { type: 'string' }, why: { type: 'string' },
        beats: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['part', 'text'], properties: { part: { type: 'string' }, text: { type: 'string' } } } } } }, 'marketing_adrefs');
  } catch (e) { throw badRequest(`AI 분석을 하지 못했습니다 — ${clip((e as Error)?.message ?? e, 150)}`); }
  if (!o) throw badRequest('AI 가 꺼져 있어 분석할 수 없습니다');
  const analysis = { beats: (Array.isArray(o.beats) ? o.beats : []).slice(0, 6).map((b: any) => ({ part: clip(b?.part, 10), text: clip(b?.text, 120) })).filter((b: { text: string }) => b.text),
    offer: clip(o.offer, 120), cta: clip(o.cta, 120), angle: clip(o.angle, 160), why: clip(o.why, 200) };
  const hook = r.hook || clip(o.hook, 200) || null;
  const hookType = HOOK_KEYS.includes(o.hookType) ? (o.hookType as HookType) : r.hook_type ?? hookTypeOf(hook);
  await db()`update mkt_ad_refs set analysis = ${db().json(analysis as never)}, hook = ${hook}, hook_type = ${hookType}, analyzed_at = now(), updated_at = now() where id = ${r.id}`;
  return { item: (await viewRows(r.tenant, r.id))[0] };
}

// ---------------- 공통 구조 → 우리 대본 3안 ----------------
type Result = { hookTypes: Partial<Record<HookType, number>>; facts: string[]; common: string[]; structure: string[]; scripts: { title: string; hook: string; lines: string[]; cta: string; score: number; pass: boolean }[]; note?: string };
async function buildReport(tenant: string, actorId: string | null, refs: Ref[], opts: { brandId?: string | null; product?: string }): Promise<{ result: Result; source: 'ai' | 'template' }> {
  const hookTypes: Partial<Record<HookType, number>> = {};
  for (const r of refs) { const k = r.hook_type ?? hookTypeOf(r.hook) ?? 'other'; hookTypes[k] = (hookTypes[k] ?? 0) + 1; }
  const top = Object.entries(hookTypes).sort((a, b) => b[1] - a[1])[0];
  const fmt = Object.entries(refs.reduce<Record<string, number>>((m, r) => ({ ...m, [r.format]: (m[r.format] ?? 0) + 1 }), {})).map(([k, n]) => `${FORMATS[k as keyof typeof FORMATS] ?? k} ${n}`).join(' · ');
  const long = refs.filter((r) => (daysSince(r.started_on) ?? 0) >= LONG_RUN_DAYS);
  const many = refs.filter((r) => (r.variants ?? 0) >= 3);
  const facts = [`${refs.length}개 중 가장 많은 첫 문장: ${top ? `${HOOK_TYPES[top[0] as HookType]} ${top[1]}개` : '없음'}`, `형식: ${fmt}`,
    long.length ? `${LONG_RUN_DAYS}일 넘게 돌린 광고 ${long.length}개: ${long.map((r) => r.advertiser).slice(0, 5).join(', ')}` : '',
    many.length ? `비슷한 소재를 3개 이상 돌린 업체: ${[...new Set(many.map((r) => r.advertiser))].slice(0, 5).join(', ')}` : ''].filter(Boolean);
  const base: Result = { hookTypes, facts, common: [], structure: [], scripts: [] };
  const { material } = await import('./mktCarousel');
  const m = await material(tenant, opts.brandId ?? null);
  const mem = await (await import('./mktTeam')).memoryText(tenant, 'researcher', opts.brandId ?? null).catch(() => ''); // #499-7 광고 리서처 기억(대표 메모)
  const Q = await import('./mktQuality');
  try {
    const list = refs.map((r, k) => `${k + 1}) ${r.advertiser} · ${FORMATS[r.format] ?? r.format}${r.started_on ? ` · ${daysSince(r.started_on)}일째` : ''}${r.variants ? ` · 비슷한 소재 ${r.variants}개` : ''} · 첫 문장(${HOOK_TYPES[r.hook_type ?? 'other']}): ${r.hook ?? '없음'}
   ${r.analysis?.beats?.length ? `뼈대: ${r.analysis.beats.map((b: { part: string; text: string }) => `${b.part}-${b.text}`).join(' → ')}` : `대본: ${clip(r.transcript ?? r.note ?? '', 500)}`}`).join('\n');
    const o = await aiJson(tenant, actorId, `당신은 경력 30년의 퍼포먼스 마케터입니다. 경쟁사 광고 여러 편에서 공통 구조를 뽑고, 그 구조로 우리 브랜드 광고 대본 3안을 씁니다. JSON 만.
- common: 공통점 3~5개(첫 문장 방식·제안·길이·화면 등, 한 줄씩)
- structure: 공통 구조 4~6단계(예: 대상 지목 → 문제 → 제안 → 근거 → 행동, 단계마다 무엇을 하는지 한 줄)
- scripts: 우리 브랜드용 15~30초 광고 대본 3안 {title(한 줄), hook(첫 문장), lines(이어지는 3~5줄), cta(행동 1개)} — 경쟁사 문장을 베끼지 말고 구조만 빌립니다
- ${Q.MODE_GUIDE.ad}
- 숫자·실적·가격은 [우리 재료]에 있는 것만, 없으면 {{ }}. 다른 업체 이름·로고·문구를 쓰지 않습니다. 과장·최상급 금지.`,
      `[우리 재료]\n${m.text}${opts.product ? `\n광고할 제품·서비스: ${opts.product}` : ''}${m.banned.length ? `\n금지어: ${m.banned.join(', ')}` : ''}\n\n[경쟁 광고 ${refs.length}개]\n${list}${mem ? `\n\n${mem}` : ''}`,
      { type: 'object', additionalProperties: false, required: ['common', 'structure', 'scripts'], properties: { common: { type: 'array', items: { type: 'string' } }, structure: { type: 'array', items: { type: 'string' } },
        scripts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'hook', 'lines', 'cta'], properties: { title: { type: 'string' }, hook: { type: 'string' }, cta: { type: 'string' }, lines: { type: 'array', items: { type: 'string' } } } } } } }, 'marketing_adrefs');
    if (o) {
      const rules = await Q.qualityRules();
      const scripts = (Array.isArray(o.scripts) ? o.scripts : []).slice(0, 3).map((s: any) => {
        const hook = clip(s?.hook, 120); const sc = Q.scoreHook(hook, rules, [], 'ad');
        return { title: clip(s?.title, 60), hook, lines: (Array.isArray(s?.lines) ? s.lines : []).slice(0, 6).map((l: unknown) => clip(l, 120)).filter(Boolean), cta: clip(s?.cta, 80), score: sc.score, pass: sc.pass };
      }).filter((s: { hook: string }) => s.hook);
      return { result: { ...base, common: (Array.isArray(o.common) ? o.common : []).slice(0, 5).map((x: unknown) => clip(x, 160)).filter(Boolean), structure: (Array.isArray(o.structure) ? o.structure : []).slice(0, 6).map((x: unknown) => clip(x, 160)).filter(Boolean), scripts }, source: 'ai' };
    }
    return { result: { ...base, note: 'AI 가 꺼져 있어 숫자 정리만 했습니다 — 공통 구조·대본 3안은 AI 가 켜지면' }, source: 'template' };
  } catch (e) { return { result: { ...base, note: `AI 분석을 하지 못해 숫자 정리만 했습니다 — ${clip((e as Error)?.message ?? e, 120)}` }, source: 'template' }; }
}
/** [공통 구조 분석](마케팅 공간 누구나): 고른 2~12개 → 공통점·공통 구조·우리 대본 3안 */
export async function adRefReport(u: SessionUser, i: z.infer<typeof adRefReportInput>) {
  await assertSpace(u, 'marketing');
  const t = tenantOf(u); await brandOk(t, i.brandId);
  const refs = await db()<Ref[]>`select * from mkt_ad_refs where tenant = ${t} and id = any(${[...new Set(i.ids)]}::uuid[]) order by created_at`;
  if (refs.length < 2) throw badRequest('보관함에서 2개 이상 골라 주세요');
  const { result, source } = await buildReport(t, u.id, refs, { brandId: i.brandId, product: i.product });
  const [r] = await db()<{ id: string }[]>`insert into mkt_ad_ref_reports (tenant, brand_id, kind, ref_ids, product, result, source, created_by)
    values (${t}, ${i.brandId ?? null}, 'manual', ${refs.map((x) => x.id)}, ${i.product || null}, ${db().json(result as never)}, ${source}, ${u.id}) returning id`;
  return { id: r.id, result, source };
}
/** 정기(월요일 09시 이후, opsTick): 지난 7일 새로 넣은 광고가 3개 이상이면 묶어서 분석 → 보고서 1건(회사마다 한 주 한 번) + 마케팅 공간 알림 */
export async function adRefWeekly(tenant: string, now = new Date()) {
  const sql = db(); const week = isoWeek(ymd(now));
  const [ex] = await sql<{ id: string }[]>`select id from mkt_ad_ref_reports where tenant = ${tenant} and week = ${week}`;
  if (ex) return { skipped: 'done', week };
  const refs = await sql<Ref[]>`select * from mkt_ad_refs where tenant = ${tenant} and created_at >= ${now}::timestamptz - interval '7 days' order by created_at desc limit 12`;
  if (refs.length < 3) return { skipped: 'few', n: refs.length, week };
  const { result, source } = await buildReport(tenant, null, refs, {});
  const [r] = await sql<{ id: string }[]>`insert into mkt_ad_ref_reports (tenant, kind, ref_ids, result, source, week) values (${tenant}, 'weekly', ${refs.map((x) => x.id)}, ${sql.json(result as never)}, ${source}, ${week})
    on conflict (tenant, week) where week is not null do nothing returning id`;
  if (!r) return { skipped: 'done', week };
  const to = await (await import('./mktAuto')).approvers(tenant).catch(() => [] as string[]); // 담당 브랜드가 없는 회사 단위 보고 → 승인자(대표·관리자)에게, 나머지는 각자 알림 설정대로
  await (await import('./spaceNotify')).notifySpace(sql, { tenant, space: 'marketing', userIds: to, type: 'weekly_report', title: `경쟁 광고 주간 분석 (${week}) — ${refs.length}개`,
    body: result.scripts[0] ? `우리 대본 안: ${result.scripts[0].hook}` : result.facts[0] ?? '', link: '/s/marketing/ops#adrefs', entityType: 'mkt_ad_ref_report', entityId: r.id, dedupeKey: `adrefs:weekly:${tenant}:${week}` }).catch(() => {});
  return { created: r.id, n: refs.length, source, week };
}
/** [주간 분석 지금](관리자) — 월요일 자동 분석과 같은 규칙 */
export async function adRefWeeklyNow(u: SessionUser) {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('주간 분석은 대표·관리자가 바로 돌립니다(월요일에는 자동)');
  return adRefWeekly(tenantOf(u));
}
