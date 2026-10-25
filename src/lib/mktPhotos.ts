import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { assertSpace } from './spaces';
import { isAdmin } from './access';
import { forbidden, notFound } from './errors';
import { tenantOf, type SessionUser } from './types';

/**
 * #235 ⓒ(대표 #563 "자료실 사진을 AI가 보고 설명·태그를 단다 — 글자 든 홍보물 판정 포함. 사진 고르기와 블로그 사진 설명에 쓴다")
 * 자료실 마케팅 사진(jpg·png·webp, AI 가 만든 그림 제외)을 빠른 모델이 사진마다 한 번 보고 library_files.vision 에 둔다(1장 1원 안팎):
 *   caption(블로그 사진 아래 한 줄) · scene(장면 2~3문장) · tags · kind(실사/그래픽/화면/그림/문서) · text(글자 양) · promo(글자 든 홍보물) · seen(읽히는 글자) · people · faces · quality
 * 쓰는 곳: 시안 바탕(글자 없는 실사만 — 폴더·태그로 고른 사진에 더해) · 블로그 본문 사진 고르기(홍보물·그래픽 빼기, 설명 낱말로 글과 맞추기) · 원고 재료의 사진 목록.
 * 사람이 고친 판정이 먼저: 태그 '글자없음'(바탕으로 씀) · '글자있음'(바탕·본문에서 뺌). 이름 규칙(썸네일·카드뉴스…)은 그대로 — 둘 중 하나라도 그래픽이면 뺌.
 * 언제: 마케팅 사진을 올리면 응답 뒤에 · 정기 실행마다 설명 없는 사진 6장 · 자동 제작 › 사진 AI 설명 [설명하기]. 실패는 세 번까지만 다시.
 */
const KINDS = ['photo', 'graphic', 'screen', 'illustration', 'document'] as const;
export type VisionOk = { v: 1; at: string; caption: string; scene: string; tags: string[]; kind: (typeof KINDS)[number]; text: 'none' | 'little' | 'much'; promo: boolean; seen: string; people: number; faces: boolean; quality: 'good' | 'ok' | 'poor' };
export type VisionErr = { v: 1; at: string; error: string; tries: number };
export const KIND_LABEL: Record<VisionOk['kind'], string> = { photo: '실사', graphic: '글자 그래픽', screen: '화면 캡처', illustration: '그림', document: '문서' };
export const visionOk = (x: unknown): x is VisionOk => !!x && typeof x === 'object' && typeof (x as VisionOk).caption === 'string' && !('error' in (x as object));
const tagOn = (tags: string[] | null | undefined, t: string) => (tags ?? []).some((x) => String(x).replace(/\s+/g, '') === t);
/** 사람이 고친 판정 — 태그 '글자없음' = 바탕으로 씀 · '글자있음' = 바탕·본문에서 뺌 */
export const markedNoText = (tags: string[] | null | undefined) => tagOn(tags, '글자없음');
export const markedText = (tags: string[] | null | undefined) => tagOn(tags, '글자있음');
/** AI 판정 글자 든 그래픽(바탕·블로그 본문 모두 안 씀) — 홍보물·글자 많음·실사가 아닌 것 */
export const visionGraphic = (v: VisionOk) => v.promo || v.text === 'much' || v.kind !== 'photo';
/** AI 판정 시안 바탕 후보 — 글자 없는 실사·화질 괜찮음·얼굴을 알아볼 사람 없음(바탕은 크게 쓰여 초상권 조심) */
export const visionBackdrop = (v: VisionOk) => v.kind === 'photo' && v.text === 'none' && !v.promo && v.quality !== 'poor' && !v.faces;
/** 고르기·글 맞추기에 쓰는 설명 글 */
export const visionText = (v: unknown) => (visionOk(v) ? `${v.caption} ${v.scene} ${v.tags.join(' ')} ${v.seen}` : '');

const PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const photoCond = (sql: ReturnType<typeof db>, tenant: string) => sql`tenant = ${tenant} and space = 'marketing' and deleted_at is null and upload_status = 'ready'
  and coalesce(security, 'internal') <> 'confidential' and mime_type = any(${PHOTO_MIME}::text[]) and coalesce(source, '') <> 'ai'`;
/** 올린 직후 설명할 사진인지(마케팅 공간 실사 형식·AI 가 만든 그림 아님) */
export const isMarketingPhoto = (f: { space?: string | null; mime_type?: string | null; source?: string | null }) => f.space === 'marketing' && PHOTO_MIME.includes(String(f.mime_type)) && f.source !== 'ai';

const SYSTEM = `회사 마케팅 자료실 사진 한 장을 보고 기록합니다. 보이는 것만 쓰고, 짐작하거나 꾸미지 않습니다. JSON 하나로만 답합니다.
- caption: 블로그 사진 아래에 그대로 쓸 한 줄 설명(15~40자). 무엇이·어디서·어떤 모습인지. 광고 문구·감탄·과장 없이
- scene: 장면 설명 2~3문장(장소·사람 수·하는 일·분위기·밝기·구도)
- tags: 짧은 낱말 3~8개(장소·물건·행동)
- kind: photo(실제로 찍은 사진) · graphic(글자·도형으로 만든 포스터·배너·카드뉴스·썸네일) · screen(휴대폰·컴퓨터 화면 캡처) · illustration(그림·AI 생성 이미지) · document(문서·표·영수증)
- text: 사진 속 글자 양 — none(없음) · little(간판·옷·기구 로고처럼 작게) · much(제목·문장·가격처럼 크거나 많음)
- promo: 글자가 든 홍보물(포스터·배너·전단·카드뉴스·썸네일·이벤트 안내)이면 true
- seen: 읽히는 글자(상호·간판·제목) 60자 안, 없으면 ""
- people: 보이는 사람 수(0~20)
- faces: 얼굴을 알아볼 수 있는 사람이 있으면 true
- quality: good · ok · poor(흐림·너무 어두움·심하게 기울어짐)`;
const SCHEMA = { type: 'object', additionalProperties: false, required: ['caption', 'scene', 'tags', 'kind', 'text', 'promo', 'seen', 'people', 'faces', 'quality'], properties: {
  caption: { type: 'string' }, scene: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, kind: { type: 'string', enum: [...KINDS] },
  text: { type: 'string', enum: ['none', 'little', 'much'] }, promo: { type: 'boolean' }, seen: { type: 'string' }, people: { type: 'integer' }, faces: { type: 'boolean' },
  quality: { type: 'string', enum: ['good', 'ok', 'poor'] } } };

/** AI 에 보내기 전 긴 변 1024px JPEG 로 줄임(토큰·전송량) — sharp 가 없거나 못 읽으면 3.5MB 아래 원본 */
async function shrink(buf: Buffer, mime: string): Promise<{ data: Buffer; mime: string } | null> {
  try {
    const sharp = (await import('sharp')).default;
    return { data: await sharp(buf, { failOn: 'none', limitInputPixels: 80e6 }).rotate().resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(), mime: 'image/jpeg' };
  } catch { return buf.length <= 3_500_000 && PHOTO_MIME.includes(mime) ? { data: buf, mime } : null; }
}
const clip = (s: unknown, n: number) => [...String(s ?? '').replace(/\s+/g, ' ').trim()].slice(0, n).join('');
function normalize(j: any): Omit<VisionOk, 'v' | 'at'> {
  const pick = <T extends string>(x: unknown, ok: readonly T[], d: T) => (ok.includes(x as T) ? (x as T) : d);
  return { caption: clip(j?.caption, 60), scene: clip(j?.scene, 300), tags: [...new Set((Array.isArray(j?.tags) ? j.tags : []).map((t: unknown) => clip(t, 20).replace(/^#/, '')).filter(Boolean))].slice(0, 8) as string[],
    kind: pick(j?.kind, KINDS, 'photo'), text: pick(j?.text, ['none', 'little', 'much'] as const, 'little'), promo: j?.promo === true, seen: clip(j?.seen, 60),
    people: Math.max(0, Math.min(20, Math.round(Number(j?.people) || 0))), faces: j?.faces === true, quality: pick(j?.quality, ['good', 'ok', 'poor'] as const, 'ok') };
}
/** 크레딧·요청 몰림·서버 불안정 = 사진 탓이 아님(다음에 다시) — 그 밖(형식 오류 등)은 사진에 실패로 남김 */
const transient = (e: any) => e?.code === 'ai_credit' || e?.status === 429 || /불안정/.test(String(e?.message ?? ''));

/** 사진 한 장 설명 — 결과를 저장하고 돌려줌(AI 꺼짐·대상 아님 = null). 설명이 비어 있던 자료는 한 줄 설명을 자료실 설명으로도 */
export async function describePhoto(tenant: string, id: string, actorId: string | null = null): Promise<VisionOk | VisionErr | null> {
  const P = await import('./ai/provider');
  if (!P.aiEnabled()) return null;
  const sql = db();
  const [f] = await sql<{ id: string; storage_key: string | null; mime_type: string; title: string; file_name: string; vision: any; created_by: string | null }[]>`select id, storage_key, mime_type, coalesce(nullif(title, ''), file_name) as title, file_name, vision, created_by
    from library_files where id = ${id} and ${photoCond(sql, tenant)}`;
  if (!f?.storage_key) return null;
  const tries = (f.vision && 'error' in f.vision ? Number(f.vision.tries) || 1 : 0) + 1;
  const fail = async (error: string) => { const v: VisionErr = { v: 1, at: new Date().toISOString(), error: clip(error, 200), tries }; await sql`update library_files set vision = ${sql.json(v as never)} where id = ${id}`; return v; };
  let img: { data: Buffer; mime: string } | null;
  try { img = await shrink(await (await import('./storage')).getObject(f.storage_key), f.mime_type); } catch (e: any) { return fail(`사진 읽기 실패: ${e?.message ?? e}`); }
  if (!img) return fail('사진이 너무 크거나 읽을 수 없는 형식입니다');
  const p = P.anthropicProvider({ tier: 'fast' });
  let r: Awaited<ReturnType<typeof p.chat>>;
  try {
    r = await p.chat({ system: SYSTEM, tools: [], format: SCHEMA, messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: img.mime as 'image/jpeg', data: img.data.toString('base64') } }, { type: 'text', text: `파일 이름: ${f.title}` }] }] });
  } catch (e: any) { if (transient(e)) throw e; return fail(`AI 설명 실패: ${e?.message ?? e}`); }
  await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
    values (${tenant}, ${actorId ?? f.created_by}, ${randomUUID()}, ${p.name}, ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, ${r.usage.cache_read_input_tokens ?? 0}, ${r.usage.cache_creation_input_tokens ?? 0},
      ${P.costUsd(r.model ?? p.model, r.usage)}, 'marketing_vision')`;
  let j: any;
  try { j = JSON.parse((r.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('')); } catch { return fail('AI 답을 읽지 못했습니다'); }
  const v: VisionOk = { v: 1, at: new Date().toISOString(), ...normalize(j) };
  if (!v.caption) return fail('AI 가 설명을 비워 답했습니다');
  await sql`update library_files set vision = ${sql.json(v as never)}, description = coalesce(nullif(description, ''), ${v.caption}) where id = ${id}`;
  return v;
}

/** 설명 없는 사진(실패는 1시간 뒤·세 번까지) 묶음 — 회사마다 한 번에 하나. ids = 이 사진들만(다시 설명 포함) */
export async function describeBatch(tenant: string, o: { limit?: number; budgetMs?: number; ids?: string[]; actorId?: string | null } = {}) {
  const P = await import('./ai/provider');
  if (!P.aiEnabled()) return { done: 0, failed: 0, left: 0, stopped: 'AI 가 꺼져 있습니다' };
  const L = await import('./later'); const sql = db();
  const r = await L.withLock(`mktVision:${tenant}`, async () => {
    const t0 = Date.now(); const budget = o.budgetMs ?? 25e3;
    const rows = o.ids?.length ? await sql<{ id: string }[]>`select id from library_files where id = any(${o.ids}::uuid[]) and ${photoCond(sql, tenant)} order by created_at desc limit ${o.limit ?? 20}`
      : await sql<{ id: string }[]>`select id from library_files where ${photoCond(sql, tenant)}
          and (vision is null or (vision ? 'error' and coalesce((vision->>'tries')::int, 1) < 3 and (vision->>'at')::timestamptz < now() - interval '1 hour'))
        order by created_at desc limit ${o.limit ?? 6}`;
    let done = 0; let failed = 0; let stopped: string | null = null;
    if (rows.length) {
      try { await (await import('./mktAuto')).assertMktAi(tenant); } catch (e: any) { stopped = String(e?.message ?? e); }
      for (const x of stopped ? [] : rows) {
        if ((done || failed) && Date.now() - t0 > budget) break;
        try { const v = await describePhoto(tenant, x.id, o.actorId ?? null); if (v && 'error' in v) failed++; else if (v) done++; } catch (e: any) { stopped = String(e?.message ?? e); break; }
      }
    }
    const [{ left }] = await sql<{ left: number }[]>`select count(*)::int as left from library_files where ${photoCond(sql, tenant)} and (vision is null or (vision ? 'error' and coalesce((vision->>'tries')::int, 1) < 3))`;
    return { done, failed, left, stopped };
  });
  return L.isBusy(r) ? { done: 0, failed: 0, left: 0, stopped: '다른 설명 작업이 돌고 있습니다 — 잠시 뒤 다시', busy: true } : r;
}

type PhotoRow = { id: string; title: string; file_name: string; folder: string; tags: string[]; description: string | null; vision: any; created_at: Date };
/** 원고 재료의 사진 목록 — 글자 든 그래픽·다른 브랜드 사진은 빼고 이 브랜드 사진 먼저. AI 설명(없으면 자료실 설명) */
export async function photoLines(tenant: string, brand: string, others: string[], n = 8) {
  const sql = db(); const V = await import('./mktAutoVisual');
  const rows = await sql<PhotoRow[]>`select id, coalesce(nullif(title, ''), file_name) as title, file_name, folder, tags, description, vision, created_at from library_files where ${photoCond(sql, tenant)} order by created_at desc limit 80`;
  const hay = (r: PhotoRow) => `${r.title} ${r.folder} ${(r.tags ?? []).join(' ')} ${r.description ?? ''} ${visionText(r.vision)}`.toLowerCase();
  const mine = (r: PhotoRow) => !!brand && hay(r).includes(brand.toLowerCase());
  const pick = rows.filter((r) => !V.textGraphic(r) && !others.some((o) => !!o && hay(r).includes(o.toLowerCase())))
    .map((r, k) => ({ r, k })).sort((a, b) => Number(mine(b.r)) - Number(mine(a.r)) || a.k - b.k).slice(0, n);
  return pick.map(({ r }) => `- ${r.title}: ${visionOk(r.vision) ? `${r.vision.caption}${r.vision.scene ? ` — ${clip(r.vision.scene.split(/(?<=[.!?])\s/)[0], 80)}` : ''}` : clip(r.description, 120) || '(설명 없음)'}`);
}

/** 사진 한 장 원가(원) 어림 — 빠른 모델·입력 1,700·출력 250 토큰 */
async function perPhotoKrw() {
  const P = await import('./ai/provider');
  return Math.round(P.costUsd(P.modelFor('fast'), { input_tokens: 1700, output_tokens: 250 }) * P.usdKrw() * 10) / 10;
}
export type PhotoItem = { id: string; title: string; folder: string; tags: string[]; vision: VisionOk | VisionErr | null; mark: 'none' | 'has' | null; cover: boolean; body: boolean; at: string };
/** 자동 제작 › 사진 AI 설명: 숫자(전체·설명·아직·실패·바탕 가능·그래픽) + 최근 60장(설명·판정·쓰임) */
export async function photosView(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u); const V = await import('./mktAutoVisual');
  const rows = await sql<PhotoRow[]>`select id, coalesce(nullif(title, ''), file_name) as title, file_name, folder, tags, description, vision, created_at from library_files where ${photoCond(sql, t)} order by created_at desc limit 400`;
  const items: PhotoItem[] = rows.map((r) => ({ id: r.id, title: r.title, folder: r.folder, tags: r.tags ?? [], vision: r.vision ?? null, mark: markedNoText(r.tags) ? 'none' : markedText(r.tags) ? 'has' : null,
    cover: V.backdropOk(r), body: !V.textGraphic(r), at: new Date(r.created_at).toISOString() }));
  const n = (f: (x: PhotoItem) => boolean) => items.filter(f).length;
  const P = await import('./ai/provider');
  return { total: items.length, described: n((x) => visionOk(x.vision)), pending: n((x) => !x.vision), failed: n((x) => !!x.vision && 'error' in x.vision),
    cover: n((x) => x.cover), graphic: n((x) => !x.body), ai: P.aiEnabled(), perPhotoKrw: await perPhotoKrw(), canEdit: isAdmin(u), items: items.slice(0, 60) };
}

export const describeInput = z.object({ ids: z.array(z.string().uuid()).max(20).optional(), redo: z.boolean().optional() });
/** [설명하기]: 설명 없는 사진을 25초만큼(남으면 화면이 이어서 다시 부름) · ids + redo = 그 사진을 다시 설명 */
export async function describeNow(u: SessionUser, i: z.infer<typeof describeInput>) {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('사진 설명은 관리자만 돌릴 수 있습니다');
  const sql = db(); const t = tenantOf(u);
  if (i.ids?.length && i.redo) await sql`update library_files set vision = null where id = any(${i.ids}::uuid[]) and ${photoCond(sql, t)}`;
  return describeBatch(t, { ids: i.ids, limit: i.ids?.length ? 20 : 12, budgetMs: 25e3, actorId: u.id });
}

export const markInput = z.object({ text: z.enum(['auto', 'none', 'has']) });
/** 사람이 고친 판정: none = 글자 없음(시안 바탕으로 씀) · has = 글자 있음(바탕·본문에서 뺌) · auto = AI 판정대로 — 자료실 태그 '글자없음'·'글자있음'으로 남김 */
export async function markPhoto(u: SessionUser, id: string, i: z.infer<typeof markInput>) {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('사진 판정은 관리자만 바꿀 수 있습니다');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('사진을 찾을 수 없습니다');
  const sql = db();
  const [f] = await sql<{ tags: string[] }[]>`select tags from library_files where id = ${id} and ${photoCond(sql, tenantOf(u))}`;
  if (!f) throw notFound('사진을 찾을 수 없습니다');
  const tags = [...(f.tags ?? []).filter((x) => !['글자없음', '글자있음'].includes(String(x).replace(/\s+/g, ''))), ...(i.text === 'none' ? ['글자없음'] : i.text === 'has' ? ['글자있음'] : [])];
  await sql`update library_files set tags = ${tags}, updated_at = now() where id = ${id}`;
  return { tags };
}
