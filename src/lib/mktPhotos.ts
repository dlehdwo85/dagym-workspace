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
 * 사람이 고친 판정이 먼저: 태그 '글자없음'(바탕으로 씀) · '글자있음'(바탕에서만 뺌 — 블로그 본문에는 씀) · '쓰지않음'(바탕·본문 모두 뺌). 이름 규칙(썸네일·카드뉴스…)은 그대로 — 둘 중 하나라도 그래픽이면 뺌.
 * 로컬 10/25 11:15: 안내판 글자가 많이 찍힌 현장 실사는 바탕에서만 빼고 블로그 본문에는 씀(본문 순위만 조금 뒤로) — 본문에서 빼는 것은 홍보물·실사가 아닌 것.
 * 171차(로컬 10/26 평가 ⓒ '다짐 스토리 표지에 누운 사람'): pose(자세)·facing(보이는 방향)·light(밝기) 칸 — 누운 사람·뒷모습·어두운 사진은 시안 바탕(표지·장)에서 뺌(photoFlags). 칸이 없는 예전 설명은 설명 문장으로 판정.
 * 언제: 마케팅 사진을 올리면 응답 뒤에 · 정기 실행마다 설명 없는 사진 6장 · 자동 제작 › 사진 AI 설명 [설명하기]. 실패는 세 번까지만 다시.
 */
const KINDS = ['photo', 'graphic', 'screen', 'illustration', 'document'] as const;
const POSES = ['none', 'standing', 'sitting', 'lying'] as const; const FACINGS = ['none', 'front', 'side', 'back'] as const; const LIGHTS = ['bright', 'normal', 'dark'] as const;
export type VisionOk = { v: 1; at: string; caption: string; scene: string; tags: string[]; kind: (typeof KINDS)[number]; text: 'none' | 'little' | 'much'; promo: boolean; seen: string; people: number; faces: boolean; quality: 'good' | 'ok' | 'poor';
  /** 171차: 사람 자세·보이는 방향·사진 밝기(예전 설명에는 없음 → photoFlags 가 문장으로 판정) */
  pose?: (typeof POSES)[number]; facing?: (typeof FACINGS)[number]; light?: (typeof LIGHTS)[number] };
export type VisionErr = { v: 1; at: string; error: string; tries: number };
export const KIND_LABEL: Record<VisionOk['kind'], string> = { photo: '실사', graphic: '글자 그래픽', screen: '화면 캡처', illustration: '그림', document: '문서' };
export const visionOk = (x: unknown): x is VisionOk => !!x && typeof x === 'object' && typeof (x as VisionOk).caption === 'string' && !('error' in (x as object));
const tagOn = (tags: string[] | null | undefined, t: string) => (tags ?? []).some((x) => String(x).replace(/\s+/g, '') === t);
/** 사람이 고친 판정 — 태그 '글자없음' = 바탕으로 씀 · '글자있음' = 바탕에서만 뺌(본문에는 씀) · '쓰지않음' = 바탕·본문 모두 뺌 */
export const markedNoText = (tags: string[] | null | undefined) => tagOn(tags, '글자없음');
export const markedText = (tags: string[] | null | undefined) => tagOn(tags, '글자있음');
export const markedSkip = (tags: string[] | null | undefined) => tagOn(tags, '쓰지않음');
/** AI 판정 글자 든 그래픽(바탕·블로그 본문 모두 안 씀) — 홍보물·실사가 아닌 것. 글자 많은 실사(안내판이 찍힌 현장)는 바탕에서만 빠짐(visionBackdrop) */
export const visionGraphic = (v: VisionOk) => v.promo || v.kind !== 'photo';
/** AI 판정 시안 바탕 후보 — 글자 없는 실사·화질 괜찮음·얼굴을 알아볼 사람 없음(바탕은 크게 쓰여 초상권 조심) */
export const visionBackdrop = (v: VisionOk) => v.kind === 'photo' && v.text === 'none' && !v.promo && v.quality !== 'poor' && !v.faces;
/** 고르기·글 맞추기에 쓰는 설명 글 */
export const visionText = (v: unknown) => (visionOk(v) ? `${v.caption} ${v.scene} ${v.tags.join(' ')} ${v.seen}` : '');
/** 171차(로컬 10/26 평가 ⓒ): 시안 바탕(표지·장)에 안 쓸 사진 — 누운 사람·뒷모습·어두운 사진. 새 설명은 pose·facing·light 칸으로, 칸이 없는 예전 설명은 한 줄·장면·태그 문장으로 판정
 *  (어두움은 '어두운 색 옷' 같은 색 표현에 안 걸리게 조명·실내·분위기 낱말과 같이 있을 때만) */
const LYING = /누워|누운|눕는|눕고|눕기|드러누|엎드리|엎드려|엎드린|lying|lies? (down|on)/i;
const BACK = /뒷모습|뒤에서 (본|찍|촬영)|등을 (보이|돌리|지고)|뒤돌아|등 ?뒤에서|back view|from behind|seen from (the )?back/i;
const DARK = /어두운 (실내|조명|분위기|배경|공간|방|곳|사진|화면|밤|저녁|거리|매장|복도)|(조명|빛|실내|전체|사진|분위기|화면)[이가은는]? ?(어둡|어두워|어두운|약하|약함)|어둑|컴컴|캄캄|야간|밤 ?(에|의|시간|풍경|거리|매장)|저조도|dimly|low light|dark room|at night/i;
export function photoFlags(v: unknown): { lying: boolean; back: boolean; dark: boolean } {
  if (!visionOk(v)) return { lying: false, back: false, dark: false };
  const s = `${v.caption} ${v.scene} ${v.tags.join(' ')}`;
  return { lying: v.pose ? v.pose === 'lying' : LYING.test(s), back: v.facing ? v.facing === 'back' : BACK.test(s), dark: v.light ? v.light === 'dark' : DARK.test(s) };
}

export const PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'];
/**
 * 188차(대표 #685 '폴더명 말고 모든 사진·영상' · #695 '되도록 모든 화면에 실사'): 사진 후보 = 자료실 전체(공간·폴더 무관) — 예전엔 마케팅 공간만.
 * 빼는 것: AI 가 만든 그림·AI 비서 대화 첨부·매출 근거 · 기밀 파일·기밀 폴더(상위 폴더 등급 포함) · 격리 팀 구성원(대표·관리자 제외)이 올린 자료(마케팅 공간에 둔 것은 씀)
 *  · 영상 장면 사진(mktScenes)은 원본 영상이 지워졌거나 기밀·'쓰지않음'이면 뺌. 마케팅 공간 밖 사진은 AI 설명이 '실사·홍보물 아님·얼굴 없음·화질 괜찮음'일 때만 시안·본문에 씀(outsideOk)
 * library_files 를 별칭 없이 읽는 쿼리에 그대로 넣는다(하위 쿼리가 library_files.칸 으로 바깥 줄을 봄)
 */
export const poolCond = (sql: ReturnType<typeof db>, tenant: string) => sql`library_files.tenant = ${tenant} and library_files.deleted_at is null and library_files.upload_status = 'ready'
  and coalesce(library_files.security, 'internal') <> 'confidential' and library_files.mime_type = any(${PHOTO_MIME}::text[]) and coalesce(library_files.source, '') not in ('ai', 'ai_attach', 'revenue')
  and not exists (select 1 from library_folder_security fs where fs.tenant = library_files.tenant and fs.security = 'confidential' and (library_files.folder = fs.folder or left(library_files.folder, length(fs.folder) + 1) = fs.folder || '/'))
  and (library_files.space = 'marketing' or not exists (select 1 from team_members mi join teams ti on ti.id = mi.team_id join users uu on uu.id = mi.user_id
    where mi.user_id = library_files.created_by and ti.isolated and not ti.archived and ti.tenant = library_files.tenant and uu.role not in ('owner', 'admin')))
  and (coalesce(library_files.source, '') <> 'video_frame' or exists (select 1 from library_files pv where pv.id::text = library_files.meta->'video'->>'id' and pv.tenant = library_files.tenant
    and pv.deleted_at is null and coalesce(pv.security, 'internal') <> 'confidential' and not ('쓰지않음' = any(coalesce(pv.tags, '{}')))))`;
const photoCond = poolCond;
/** 188차: 마케팅 공간 밖 사진을 시안·블로그·원고 목록에 쓸 조건 — AI 설명이 실사·홍보물 아님·얼굴 없음·화질 괜찮음(설명 전이면 안 씀) */
export const outsideOk = (v: unknown) => visionOk(v) && v.kind === 'photo' && !v.promo && !v.faces && v.quality !== 'poor';
export const poolUsable = (r: { space?: string | null; vision?: unknown }) => r.space === 'marketing' || outsideOk(r.vision);
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
- quality: good · ok · poor(흐림·너무 어두움·심하게 기울어짐)
- pose: 사람 자세 — none(사람 없음) · standing(서 있음·걷기·운동 중) · sitting(앉음) · lying(누움·엎드림·기대 누움) — 여럿이면 가장 크게 보이는 사람
- facing: 사람이 보이는 방향 — none(사람 없음) · front(얼굴·몸 앞쪽) · side(옆) · back(뒷모습·등)
- light: 사진 밝기 — bright(밝음) · normal · dark(어두움·야간·조명 약함)`;
const SCHEMA = { type: 'object', additionalProperties: false, required: ['caption', 'scene', 'tags', 'kind', 'text', 'promo', 'seen', 'people', 'faces', 'quality', 'pose', 'facing', 'light'], properties: {
  caption: { type: 'string' }, scene: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, kind: { type: 'string', enum: [...KINDS] },
  text: { type: 'string', enum: ['none', 'little', 'much'] }, promo: { type: 'boolean' }, seen: { type: 'string' }, people: { type: 'integer' }, faces: { type: 'boolean' },
  quality: { type: 'string', enum: ['good', 'ok', 'poor'] }, pose: { type: 'string', enum: [...POSES] }, facing: { type: 'string', enum: [...FACINGS] }, light: { type: 'string', enum: [...LIGHTS] } } };

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
    people: Math.max(0, Math.min(20, Math.round(Number(j?.people) || 0))), faces: j?.faces === true, quality: pick(j?.quality, ['good', 'ok', 'poor'] as const, 'ok'),
    // 171차: 자세·방향·밝기 — 답에 없으면(예전 가짜 답·옛 모델) 칸을 비워 두고 문장으로 판정
    ...(POSES.includes(j?.pose) ? { pose: j.pose as VisionOk['pose'] } : {}), ...(FACINGS.includes(j?.facing) ? { facing: j.facing as VisionOk['facing'] } : {}), ...(LIGHTS.includes(j?.light) ? { light: j.light as VisionOk['light'] } : {}) };
}
/** 크레딧·요청 몰림·서버 불안정 = 사진 탓이 아님(다음에 다시) — 그 밖(형식 오류 등)은 사진에 실패로 남김 */
const transient = (e: any) => e?.code === 'ai_credit' || e?.status === 429 || /불안정/.test(String(e?.message ?? ''));

/** 사진 한 장 설명 — 결과를 저장하고 돌려줌(AI 꺼짐·대상 아님 = null). 설명이 비어 있던 자료는 한 줄 설명을 자료실 설명으로도 */
export async function describePhoto(tenant: string, id: string, actorId: string | null = null): Promise<VisionOk | VisionErr | null> {
  const P = await import('./ai/provider');
  if (!P.aiEnabled()) return null;
  const sql = db();
  const [f] = await sql<{ id: string; storage_key: string | null; mime_type: string; title: string; file_name: string; vision: any; created_by: string | null; source: string | null; meta: any }[]>`select id, storage_key, mime_type, coalesce(nullif(title, ''), file_name) as title, file_name, vision, created_by, source, meta
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
  // 188차(#619 '영상 = 화면 설명으로 분류'): 영상 장면 사진이면 설명이 비어 있던 원본 영상에 '영상 장면: …' 한 줄(자료실 검색·정리에 씀)
  const vid = f.source === 'video_frame' ? String(f.meta?.video?.id ?? '') : '';
  if (/^[0-9a-f-]{36}$/i.test(vid)) await sql`update library_files set description = coalesce(nullif(description, ''), ${`영상 장면: ${v.caption}`}) where id = ${vid} and tenant = ${tenant}`;
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
        order by (space = 'marketing') desc, created_at desc limit ${o.limit ?? 6}`; // 188차: 자료실 전체 — 마케팅 공간(영상 장면 포함) 먼저
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

type PhotoRow = { id: string; title: string; file_name: string; folder: string; tags: string[]; description: string | null; vision: any; created_at: Date; space: string; source: string | null; regen?: any };
/** 원고 재료의 사진 목록 — 글자 든 그래픽·다른 브랜드 사진은 빼고 이 브랜드 사진 먼저. AI 설명(없으면 자료실 설명) */
export async function photoLines(tenant: string, brand: string, others: string[], n = 8) {
  const sql = db(); const V = await import('./mktAutoVisual');
  const rows = await sql<PhotoRow[]>`select id, coalesce(nullif(title, ''), file_name) as title, file_name, folder, tags, description, vision, created_at, space, source from library_files where ${photoCond(sql, tenant)}
    order by (space = 'marketing') desc, created_at desc limit 120`;
  const hay = (r: PhotoRow) => `${r.title} ${r.folder} ${(r.tags ?? []).join(' ')} ${r.description ?? ''} ${visionText(r.vision)}`.toLowerCase();
  const mine = (r: PhotoRow) => !!brand && hay(r).includes(brand.toLowerCase());
  const pick = rows.filter((r) => poolUsable(r) && V.bodyOk(r) && !others.some((o) => !!o && hay(r).includes(o.toLowerCase())))
    .map((r, k) => ({ r, k })).sort((a, b) => Number(mine(b.r)) - Number(mine(a.r)) || a.k - b.k).slice(0, n);
  return pick.map(({ r }) => `- ${r.title}: ${visionOk(r.vision) ? `${r.vision.caption}${r.vision.scene ? ` — ${clip(r.vision.scene.split(/(?<=[.!?])\s/)[0], 80)}` : ''}` : clip(r.description, 120) || '(설명 없음)'}`);
}

/** 사진 한 장 원가(원) 어림 — 빠른 모델·입력 1,700·출력 250 토큰 */
async function perPhotoKrw() {
  const P = await import('./ai/provider');
  return Math.round(P.costUsd(P.modelFor('fast'), { input_tokens: 1700, output_tokens: 250 }) * P.usdKrw() * 10) / 10;
}
export type PhotoItem = { id: string; title: string; folder: string; tags: string[]; vision: VisionOk | VisionErr | null; mark: 'none' | 'has' | 'skip' | null; cover: boolean; body: boolean; at: string;
  /** 188차: 공간(마케팅 밖이면 '업무'·'영업' 표시 — AI 설명이 실사·얼굴 없음일 때만 씀) · 영상 장면 사진 */
  space: string; scene: boolean;
  /** 189차: AI 생성(실사 참고) 사진 · [AI로 다시 만들기] 상태(생성 중·완료 → 새 사진 id·실패) */
  gen: boolean; regen: { status: string; fileId: string | null } | null };
/** 자동 제작 › 사진 AI 설명: 숫자(전체·설명·아직·실패·바탕 가능·그래픽) + 최근 60장(설명·판정·쓰임) */
export async function photosView(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u); const V = await import('./mktAutoVisual');
  const rows = await sql<PhotoRow[]>`select id, coalesce(nullif(title, ''), file_name) as title, file_name, folder, tags, description, vision, created_at, space, source, meta->'regen' as regen from library_files where ${photoCond(sql, t)} order by created_at desc limit 600`;
  const items: PhotoItem[] = rows.map((r) => ({ id: r.id, title: r.title, folder: r.folder, tags: r.tags ?? [], vision: r.vision ?? null, mark: markedSkip(r.tags) ? 'skip' : markedNoText(r.tags) ? 'none' : markedText(r.tags) ? 'has' : null,
    cover: poolUsable(r) && V.backdropOk(r), body: poolUsable(r) && V.bodyOk(r), at: new Date(r.created_at).toISOString(), space: r.space, scene: r.source === 'video_frame',
    gen: r.source === 'ai_ref', regen: r.regen?.status ? { status: String(r.regen.status), fileId: r.regen.fileId ?? null } : null }));
  const n = (f: (x: PhotoItem) => boolean) => items.filter(f).length;
  const P = await import('./ai/provider');
  const regen = isAdmin(u) ? await (await import('./mktPhotoGen')).regenInfo().catch(() => null) : null; // 189차 [AI로 다시 만들기] 준비됨·장당 크레딧
  return { total: items.length, described: n((x) => visionOk(x.vision)), pending: n((x) => !x.vision), failed: n((x) => !!x.vision && 'error' in x.vision),
    cover: n((x) => x.cover), graphic: n((x) => !x.body), outside: n((x) => x.space !== 'marketing'), scenes: n((x) => x.scene),
    videos: await (await import('./mktScenes')).scenesView(t), ai: P.aiEnabled(), perPhotoKrw: await perPhotoKrw(), canEdit: isAdmin(u), regen, gens: n((x) => x.gen), items: items.slice(0, 60) };
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

export const markInput = z.object({ text: z.enum(['auto', 'none', 'has', 'skip']) });
/** 사람이 고친 판정: none = 글자 없음(시안 바탕으로 씀) · has = 글자 있음(바탕에서만 뺌 — 블로그 본문에는 씀) · skip = 쓰지 않음(바탕·본문 모두 뺌) · auto = AI 판정대로 — 자료실 태그 '글자없음'·'글자있음'·'쓰지않음'으로 남김 */
export async function markPhoto(u: SessionUser, id: string, i: z.infer<typeof markInput>) {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('사진 판정은 관리자만 바꿀 수 있습니다');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('사진을 찾을 수 없습니다');
  const sql = db();
  const [f] = await sql<{ tags: string[] }[]>`select tags from library_files where id = ${id} and ${photoCond(sql, tenantOf(u))}`;
  if (!f) throw notFound('사진을 찾을 수 없습니다');
  const tags = [...(f.tags ?? []).filter((x) => !['글자없음', '글자있음', '쓰지않음'].includes(String(x).replace(/\s+/g, ''))), ...(i.text === 'none' ? ['글자없음'] : i.text === 'has' ? ['글자있음'] : i.text === 'skip' ? ['쓰지않음'] : [])];
  await sql`update library_files set tags = ${tags}, updated_at = now() where id = ${id}`;
  return { tags };
}
