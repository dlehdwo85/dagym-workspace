import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from './db';
import { HF_TERMINAL, hfStatus, hfSubmit, type HfState } from './higgsfield';
import { KIND_SPEC, actorFor } from './mktStudio';
import { END_XFADE, XFADE, dimOf, type ComposeScene } from './video/compose';
import type { SceneQa } from './video/qa';

/**
 * #454 영상 제작 파이프라인 v2(대표 10/23 "우리나라 대기업 광고와 유사한 수준으로").
 * 의뢰 1편 = 장면 3~5개(각 3~5초)를 Higgsfield 에 따로 만들고 → 장면마다 비전 AI 검수(걸리면 1번 다시) → 서버 ffmpeg 로
 * 이어 붙이기·실제 화면 합성·한국어 자막·내레이션·배경음·끝 화면 → 자료실 → 새 버전 → 승인함('사람 검수 필요' 표시).
 * 단계(result.stage): clips(장면 생성) → qa(검수) → render(합성) → done. 합성·검수는 ffmpeg 가 실린 합성 함수(/api/marketing/studio/render, 최대 300초)에서,
 * 생성 상태 확인은 기존처럼 화면 열 때·정기 실행에서. Vercel 시간 안에 못 끝내면 편(variant) 단위로 다음 호출이 이어받는다.
 */
export const END_SEC = 2.5;
export const QA_REGEN = 1; // 검수에 걸린 장면 자동 재생성 횟수(그 뒤엔 사람 검수)
const TIMEOUT_MIN = 30;
const NEGATIVE = 'western-style houses, foreign-language signs, English UI text, non-Korean people, distorted hands, extra fingers, warped faces, glitches, low resolution';
const LOOK = 'Photorealistic Korean TV commercial footage, cinematic 35mm look, natural soft light, shallow depth of field, clean premium color grade, smooth subtle camera movement. Set in South Korea; all people are Korean (East Asian).';
const NO_TEXT = 'No text anywhere in frame: no letters, words, numbers, captions, subtitles, logos, watermarks, signage or on-screen UI text. Any phone or monitor screen shows only soft abstract light.';
const FIX_EN: Record<string, string> = { '화면 안 글자': 'remove every visible letter, sign and UI text', '한국인이 아닌 사람': 'cast only Korean (East Asian) people', '서양식 배경': 'use a clearly Korean location', '깨진 화면': 'keep hands, faces and bodies anatomically clean and stable' };

export type V2Scene = { k: number; seconds: number; line: string; visualEn: string; screen: { mediaId: string; device: 'phone' | 'laptop' } | null;
  status: HfState | 'pending' | 'timeout'; requestId?: string; statusUrl?: string; submittedAt?: string; key?: string | null; prevKey?: string | null;
  tries: number; generated?: number; failRetries?: number; regens?: number; error?: string | null; qa?: SceneQa | null; lastIssues?: string[] };
export type V2Variant = { n: number; scenes: V2Scene[]; mediaId?: string | null; duration?: number | null; notes?: string[]; error?: string | null; renderTries?: number; renderError?: string | null };
type PlanScene = Pick<V2Scene, 'k' | 'seconds' | 'line' | 'visualEn' | 'screen'>;

/** 장면 계획: AI 장면(3~5초 정수, 3~5개) → 규격 길이(끝 화면 2.5초·겹침 포함)에 맞춘다. AI 가 없으면 메시지로 4장면 */
export function planScenes(p: any, total: number, message: string): PlanScene[] {
  let src: any[] = Array.isArray(p?.scenes) ? p.scenes.filter((x: any) => x?.line || x?.visualEn) : [];
  const visual = String(p?.promptEn ?? '').slice(0, 400) || `A Korean professional in a bright modern Korean office. ${message}`;
  if (!src.length) {
    const lines = String(p?.caption || message).split(/\n+|(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    src = [{ line: lines[0] ?? message, visualEn: `Opening hook, medium close-up. ${visual}` }, { line: lines[1] ?? '', visualEn: `Close-up of hands and details, natural window light. ${visual}` },
      { line: lines[2] ?? '', visualEn: `Medium shot, the person relaxes with a small smile, warm light. ${visual}` }, { line: lines[3] ?? '', visualEn: `Wide shot of a bright Korean workspace, calm mood. ${visual}` }];
  }
  src = src.slice(0, 5);
  while (src.length < 3) src.push({ line: '', visualEn: src[src.length - 1]?.visualEn ?? visual });
  const n = src.length; const target = Math.round(total - END_SEC + END_XFADE + (n - 1) * XFADE);
  const secs = src.map((x) => Math.min(5, Math.max(3, Math.round(Number(x.seconds) || target / n))));
  let sum = secs.reduce((a, b) => a + b, 0);
  for (let g = 0; sum !== target && g < 20; g++) {
    if (sum < target) { const i = secs.indexOf(Math.min(...secs)); if (secs[i] >= 5) break; secs[i]++; sum++; } else { const i = secs.indexOf(Math.max(...secs)); if (secs[i] <= 3) break; secs[i]--; sum--; }
  }
  return src.map((x, k) => ({ k, seconds: secs[k], line: String(x.line ?? '').trim().slice(0, 120), visualEn: String(x.visualEn ?? '').trim().slice(0, 700) || visual,
    screen: x.screen?.mediaId ? { mediaId: String(x.screen.mediaId), device: x.screen.device === 'laptop' ? 'laptop' : 'phone' } : null }));
}
/** 장면 프롬프트: 공통 룩(한국 TV 광고 실사) + 출연진 + 장면 지시 + 글자 금지 + 피할 것(+ 검수에서 걸린 점 고치기) */
export function scenePrompt(sc: { visualEn: string; screen?: unknown }, p: any, fix?: string[]) {
  return [LOOK, p?.look ? `Look: ${p.look}` : '', p?.character ? `Cast: ${p.character}` : '', `Shot: ${sc.visualEn}`,
    sc.screen ? 'This shot is a calm background plate: uncluttered composition, soft subject, gentle motion.' : '', NO_TEXT,
    `Avoid: ${[p?.negativeEn, NEGATIVE].filter(Boolean).join(', ')}`, fix?.length ? `Fix from the previous attempt: ${fix.join('; ')}` : ''].filter(Boolean).join('\n').slice(0, 2400);
}
async function submitScene(sc: V2Scene, p: any, aspect: string, model: string, errors: string[], fix?: string[]) {
  const r = await hfSubmit({ kind: 'video', model, prompt: scenePrompt(sc, p, fix), negative: [p?.negativeEn, NEGATIVE].filter(Boolean).join(', '), aspect, seconds: sc.seconds, idempotencyKey: randomUUID() });
  sc.tries += 1; sc.submittedAt = new Date().toISOString();
  if (r.ok) { sc.requestId = r.requestId; sc.statusUrl = r.statusUrl; sc.status = 'queued'; sc.error = null; }
  else { sc.status = 'failed'; sc.error = r.error; errors.push(`장면 ${sc.k + 1}: ${r.error}`.slice(0, 300)); }
}
const save = (id: string, r: any, extra: Record<string, unknown> = {}) => db()`update mkt_briefs set result = ${db().json(r as never)} ${extra.status ? db()`, status = ${extra.status as string}, updated_at = now()` : db()``}
  ${extra.error !== undefined ? db()`, error = ${extra.error as string | null}` : db()``} where id = ${id}`;

/** [생성] 영상: 장면별 제출 → 상태 확인 */
export async function startV2(b: any, contentId: string, model: string) {
  const sql = db(); const spec = KIND_SPEC[b.kind]; const p = b.prompt ?? {};
  const plan = planScenes(p, spec.seconds ?? 15, b.message);
  const variants: V2Variant[] = Array.from({ length: b.quantity }, (_, n) => ({ n, scenes: plan.map((sc) => ({ ...sc, status: 'pending' as const, tries: 0 })) }));
  const errors: string[] = [];
  for (const v of variants) for (const sc of v.scenes) await submitScene(sc, p, spec.aspect, model, errors);
  if (!variants.some((v) => v.scenes.some((s) => s.status === 'queued'))) {
    await sql`update mkt_briefs set status = 'failed', content_id = ${contentId}, error = ${errors.join(' / ').slice(0, 500)}, result = ${sql.json({ provider: 'higgsfield', pipeline: 'v2', model, stage: 'failed', variants, errors } as never)}, updated_at = now() where id = ${b.id}`;
    return { status: 'failed', contentId, errors };
  }
  await sql`update mkt_briefs set status = 'generating', content_id = ${contentId}, error = null, result = ${sql.json({ provider: 'higgsfield', pipeline: 'v2', model, stage: 'clips', variants, errors, notes: [], mediaIds: [] } as never)}, updated_at = now() where id = ${b.id}`;
  return { ...(await pollV2(b.id, { waitMs: 5000 })), contentId };
}

async function saveClip(b: any, n: number, sc: V2Scene, url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`장면 내려받기 실패 ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > 80 * 1024 * 1024) throw new Error('장면 파일이 80MB 를 넘습니다');
  const key = `render/${b.tenant}/${b.id}/v${n}-s${sc.k}-${sc.tries}.mp4`;
  const { putObject } = await import('./storage'); await putObject(key, data, 'video/mp4');
  return key;
}

/** 장면 생성 상태 확인(clips 단계). 다 끝나면 검수·합성 단계로 넘기고 합성 함수를 부른다 */
export async function pollV2(briefId: string, opt: { waitMs?: number } = {}): Promise<{ status: string; stage?: string; mediaIds?: string[]; errors?: string[] }> {
  const sql = db(); const until = Date.now() + (opt.waitMs ?? 0); let delay = 2000;
  for (;;) {
    const [b] = await sql<any[]>`update mkt_briefs set result = result || jsonb_build_object('pollAt', now()) where id = ${briefId} and status = 'generating' and result->>'pipeline' = 'v2' and result->>'stage' = 'clips'
      and coalesce((result->>'pollAt')::timestamptz, 'epoch') < now() - interval '3 minutes' returning *`;
    if (!b) { const [x] = await sql<any[]>`select status, result from mkt_briefs where id = ${briefId}`; return { status: x?.status ?? 'missing', stage: x?.result?.stage, mediaIds: x?.result?.mediaIds, errors: x?.result?.errors }; }
    const r = b.result; const spec = KIND_SPEC[b.kind]; const errors: string[] = [...(r.errors ?? [])];
    for (const v of r.variants as V2Variant[]) for (const sc of v.scenes) {
      if (sc.status !== 'queued' && sc.status !== 'in_progress') continue;
      const old = !!sc.submittedAt && Date.now() - new Date(sc.submittedAt).getTime() > TIMEOUT_MIN * 60000;
      const st = await hfStatus(sc.requestId!, sc.statusUrl);
      if (!st.ok) { if (!st.retry || old) { sc.status = st.retry ? 'timeout' : 'failed'; sc.error = st.error; } continue; }
      if (st.status === 'completed') {
        if (!st.urls[0]) { sc.status = 'failed'; sc.error = '완료됐지만 결과 주소가 없음'; continue; }
        try { sc.key = await saveClip(b, v.n, sc, st.urls[0]); sc.status = 'completed'; sc.error = null; sc.qa = null; sc.generated = (sc.generated ?? 0) + 1; } catch (e: any) { sc.status = 'failed'; sc.error = String(e?.message ?? e).slice(0, 200); }
      } else if (HF_TERMINAL.has(st.status)) { sc.status = st.status; sc.error = st.error ?? `생성 ${st.status}`; }
      else if (old) { sc.status = 'timeout'; sc.error = `${TIMEOUT_MIN}분 안에 끝나지 않음`; }
      else sc.status = st.status;
    }
    // 실패한 장면: 검수 재생성이었으면 앞 클립으로 되돌리고(사람 검수), 아니면 한 번 다시 만든다
    for (const v of r.variants as V2Variant[]) for (const sc of v.scenes) {
      if (!['failed', 'timeout', 'nsfw', 'canceled'].includes(sc.status)) continue;
      if (sc.prevKey) { sc.key = sc.prevKey; sc.prevKey = null; sc.status = 'completed'; sc.qa = { checked: true, ok: false, issues: [...(sc.lastIssues ?? []), `다시 만들기 실패(${sc.error ?? sc.status})`].slice(0, 6) }; continue; }
      if ((sc.failRetries ?? 0) < 1) { sc.failRetries = (sc.failRetries ?? 0) + 1; errors.push(`장면 ${sc.k + 1} 다시 만듦: ${sc.error ?? sc.status}`.slice(0, 200)); await submitScene(sc, b.prompt ?? {}, spec.aspect, r.model, errors); }
    }
    r.errors = errors.slice(-30);
    const busy = (r.variants as V2Variant[]).some((v) => v.scenes.some((s) => s.status === 'queued' || s.status === 'in_progress'));
    if (busy) {
      await save(briefId, { ...r, pollAt: null });
      if (Date.now() + delay > until) return { status: 'generating', stage: 'clips' };
      await new Promise((ok) => setTimeout(ok, delay)); delay = Math.min(delay * 1.5, 10000); continue;
    }
    for (const v of r.variants as V2Variant[]) { const bad = v.scenes.filter((s) => s.status !== 'completed'); v.error = bad.length ? `장면 ${bad.map((s) => s.k + 1).join('·')} 생성 실패(${bad[0].error ?? bad[0].status})` : null; }
    if ((r.variants as V2Variant[]).every((v) => v.error)) {
      const msg = (r.variants as V2Variant[]).map((v) => v.error).join(' / ').slice(0, 500);
      await save(briefId, { ...r, stage: 'failed', pollAt: null }, { status: 'failed', error: msg });
      return { status: 'failed', stage: 'failed', errors: [msg] };
    }
    await save(briefId, { ...r, stage: 'qa', pollAt: null });
    await kickRender(briefId);
    const [x] = await sql<any[]>`select status, result from mkt_briefs where id = ${briefId}`;
    return { status: x.status, stage: x.result?.stage, mediaIds: x.result?.mediaIds, errors: x.result?.errors };
  }
}

/** 합성 함수 부르기: Vercel 이면 /api/marketing/studio/render(최대 300초, 응답 뒤 처리)를 부르고 기다리지 않음, 아니면 여기서 바로(시험·로컬) */
export async function kickRender(briefId?: string | null) {
  if (process.env.VERCEL && process.env.CRON_SECRET) {
    const { appUrl } = await import('./mail');
    try { await fetch(`${appUrl()}/api/marketing/studio/render`, { method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify({ briefId: briefId ?? null }), signal: AbortSignal.timeout(8000) }); } catch { /* 다음 정기 실행이 다시 부름 */ }
    return { via: 'render-route' };
  }
  return renderNext(briefId);
}
export async function renderNext(briefId?: string | null) {
  if (briefId) return renderStep(briefId);
  const [x] = await db()<{ id: string }[]>`select id from mkt_briefs where status = 'generating' and result->>'pipeline' = 'v2' and result->>'stage' in ('qa', 'render')
    and coalesce((result->>'renderAt')::timestamptz, 'epoch') < now() - interval '6 minutes' order by updated_at limit 1`;
  return x ? renderStep(x.id) : { idle: true };
}
/** 정기 실행: 검수·합성 기다리는 의뢰를 합성 함수로(한 번에 2건) */
export async function renderTick() {
  const rows = await db()<{ id: string }[]>`select id from mkt_briefs where status = 'generating' and result->>'pipeline' = 'v2' and result->>'stage' in ('qa', 'render')
    and coalesce((result->>'renderAt')::timestamptz, 'epoch') < now() - interval '6 minutes' order by updated_at limit 2`;
  for (const r of rows) await kickRender(r.id);
  return { kicked: rows.length };
}

/** 자료실 파일 바이트(기밀 제외) — 브랜드 키트 로고·글꼴, #499-5 카드뉴스도 씀 */
export async function libBytes(tenant: string, id: string | null | undefined, mime: RegExp) {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [f] = await db()<{ storage_key: string; mime_type: string; file_name: string; title: string }[]>`select storage_key, mime_type, file_name, title from library_files
    where id = ${id} and tenant = ${tenant} and deleted_at is null and upload_status = 'ready' and coalesce(security, 'internal') <> 'confidential'`;
  if (!f?.storage_key || !(mime.test(f.mime_type) || mime.test(f.file_name))) return null;
  const { getObject } = await import('./storage');
  return { data: await getObject(f.storage_key), name: f.file_name, title: f.title || f.file_name };
}
/** 자료실 폴더 '영상 배경음'·'영상 화면 캡처'(하위 폴더 포함) 후보 */
export async function videoAssets(tenant: string, folder: '영상 배경음' | '영상 화면 캡처') {
  return db()<{ id: string; title: string; description: string | null; folder: string; tags: string[]; mime_type: string; file_name: string }[]>`select id, coalesce(nullif(title, ''), file_name) as title, description, folder, tags, mime_type, file_name
    from library_files where tenant = ${tenant} and deleted_at is null and upload_status = 'ready' and coalesce(security, 'internal') <> 'confidential'
      and ${folder === '영상 배경음' ? db()`mime_type like 'audio/%'` : db()`mime_type like 'image/%'`}
      and (folder = ${folder} or folder like ${folder + '/%'} or folder like ${'%/' + folder} or folder like ${'%/' + folder + '/%'}) order by created_at desc limit 30`;
}

/** 장면 대사 → 내레이션 mp3(같은 문장은 저장소에 두고 다시 씀 — 재시도 때 두 번 과금하지 않게) */
async function narrate(b: any, v: V2Variant, dir: string, notes: string[]) {
  const { ttsSettings, synthesize } = await import('./video/tts');
  const s = await ttsSettings();
  if (!s.ready) { notes.push(s.provider ? '내레이션 키·음성 확인 필요 — 자막만 넣었습니다' : '내레이션 키 필요(플랫폼 운영 › 영상 내레이션) — 자막만 넣었습니다'); return { list: v.scenes.map(() => null), chars: 0, provider: null as string | null }; }
  const { getObject, putObject } = await import('./storage'); const { mediaInfo } = await import('./video/ffmpeg');
  const list: ({ file: string; duration: number } | null)[] = []; let chars = 0;
  for (const sc of v.scenes) {
    if (!sc.line.trim()) { list.push(null); continue; }
    const key = `render/${b.tenant}/${b.id}/tts-${createHash('sha1').update(`${s.provider}|${s.voice}|${s.model}|${sc.line}`).digest('hex').slice(0, 16)}.mp3`;
    let data: Buffer | null = null;
    try { data = await getObject(key); } catch { data = null; }
    if (!data) {
      try { const r = await synthesize(sc.line); data = r.data; chars += r.chars; await putObject(key, data, 'audio/mpeg'); } catch (e: any) { notes.push(`장면 ${sc.k + 1} 내레이션 실패 — 자막만(${String(e?.message ?? e).slice(0, 120)})`); list.push(null); continue; }
    }
    const f = `n${v.n}-${sc.k}.mp3`; await writeFile(join(dir, f), data);
    list.push({ file: f, duration: (await mediaInfo(join(dir, f))).duration ?? 0 });
  }
  return { list, chars, provider: s.provider as string | null };
}
/** 배경음: 자료실 '영상 배경음' 폴더의 음원만(AI 가 고른 것 → 브랜드 이름이 든 폴더·태그 → 의뢰마다 돌려 가며) */
async function pickBgm(b: any, brandName: string | null, chosen: string | null | undefined, dir: string, notes: string[]) {
  const rows = await videoAssets(b.tenant, '영상 배경음');
  if (!rows.length) { notes.push("배경음 없음 — 자료실 '영상 배경음' 폴더에 음원을 넣으면 깔립니다"); return null; }
  const mine = brandName ? rows.filter((x) => x.folder.includes(brandName) || (x.tags ?? []).includes(brandName)) : [];
  const pool = mine.length ? mine : rows;
  const pick = rows.find((x) => x.id === chosen) ?? pool[parseInt(createHash('sha1').update(b.id).digest('hex').slice(0, 6), 16) % pool.length];
  const f = await libBytes(b.tenant, pick.id, /^audio\//);
  if (!f) return null;
  const file = `bgm.${(/\.(\w{2,4})$/.exec(f.name)?.[1] ?? 'mp3').toLowerCase()}`; await writeFile(join(dir, file), f.data);
  return { file, title: pick.title, id: pick.id };
}

/** 한 편 합성 → 자료실 저장 */
async function renderVariant(b: any, r: any, v: V2Variant, dir: string) {
  const sql = db(); const spec = KIND_SPEC[b.kind]; const p = b.prompt ?? {}; const d = dimOf(spec.aspect); const notes: string[] = [];
  const { getObject } = await import('./storage'); const C = await import('./video/compose');
  const [brand] = b.brand_id ? await sql<{ name: string; color: string; video: any }[]>`select name, color, video from mkt_brands where id = ${b.brand_id}` : [];
  const kit = brand?.video ?? {};
  const scenes: ComposeScene[] = [];
  for (const s of v.scenes) {
    const file = `c${v.n}-${s.k}.mp4`; await writeFile(join(dir, file), await getObject(s.key!));
    let screenPng: string | null = null;
    if (s.screen?.mediaId) {
      const img = await libBytes(b.tenant, s.screen.mediaId, /^image\//);
      if (img) { screenPng = `dev${v.n}-${s.k}.png`; await writeFile(join(dir, screenPng), await C.deviceMock(img.data, s.screen.device, d)); } else notes.push(`장면 ${s.k + 1} 화면 캡처를 찾지 못해 합성하지 않았습니다`);
    }
    scenes.push({ file, seconds: s.seconds, line: s.line, screenPng });
  }
  await mkdir(join(dir, 'fonts'), { recursive: true }); let family = 'Noto Sans KR';
  const font = await libBytes(b.tenant, kit.fontFileId, /font|\.(otf|ttf)$/i);
  if (font) {
    try { const fk: any = (await import('@pdf-lib/fontkit')).default; const name = fk.create(font.data)?.familyName; if (!name) throw new Error('이름 없음'); family = String(name).replace(/,/g, ' '); await writeFile(join(dir, 'fonts', /\.ttf$/i.test(font.name) ? 'brand.ttf' : 'brand.otf'), font.data); }
    catch { notes.push('브랜드 글꼴 파일을 읽지 못해 기본 글꼴(Noto Sans KR)로 넣었습니다'); family = 'Noto Sans KR'; }
  }
  if (family === 'Noto Sans KR') await copyFile(join(process.cwd(), 'assets', 'fonts', 'NotoSansKR-Bold.otf'), join(dir, 'fonts', 'NotoSansKR-Bold.otf'));
  let logo: string | null = null;
  const lg = await libBytes(b.tenant, kit.logoFileId, /^image\//);
  if (lg) { logo = 'logo.png'; await writeFile(join(dir, logo), await C.logoPng(lg.data, d)); } else if (kit.logoFileId) notes.push('끝 화면 로고 파일을 찾지 못했습니다');
  const nar = await narrate(b, v, dir, notes);
  const bgm = await pickBgm(b, brand?.name ?? null, p.bgmId, dir, notes);
  const out = await C.composeVideo({ dir, aspect: spec.aspect, scenes, narration: nar.list, bgm, font: { dir: 'fonts', family }, out: `out-${v.n}.mp4`,
    end: { seconds: END_SEC, color: kit.endColor || brand?.color || '#111111', headline: kit.headline || p.endCard?.headline || brand?.name || '', cta: kit.cta || p.endCard?.cta || '', logoPng: logo } });
  const data = await readFile(join(dir, out.file));
  const actor = await actorFor(b.created_by);
  const { saveGeneratedFile } = await import('./library');
  const title = `${spec.label} 영상${b.quantity > 1 ? ` ${v.n + 1}` : ''} — ${String(b.message).slice(0, 30)}`;
  const f = await saveGeneratedFile(actor, { fileName: `${title.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80)}.mp4`, mime: 'video/mp4', data, title, folder: '마케팅', tags: ['제작의뢰실', 'AI 생성', '합성'], source: 'ai', space: 'marketing',
    meta: { video: { pipeline: 'v2', scenes: v.scenes.length, duration: out.duration, narration: nar.provider, bgm: bgm?.title ?? null, font: family } } });
  return { mediaId: f.id, duration: out.duration, notes: [...notes, ...out.notes], audio: { narration: nar.provider, chars: nar.chars, bgm: bgm?.title ?? null } };
}

/** 검수·합성 한 걸음(합성 함수에서). 잠금(renderAt 6분)으로 동시에 둘이 돌지 않게, 시간이 모자라면 다음 호출이 남은 편을 이어받는다 */
export async function renderStep(briefId: string, budgetMs = Number(process.env.VIDEO_RENDER_BUDGET_MS ?? 230_000)): Promise<{ status: string; stage?: string; mediaIds?: string[]; errors?: string[] }> {
  const t0 = Date.now(); const sql = db();
  const [b] = await sql<any[]>`update mkt_briefs set result = result || jsonb_build_object('renderAt', now()) where id = ${briefId} and status = 'generating' and result->>'pipeline' = 'v2' and result->>'stage' in ('qa', 'render')
    and coalesce((result->>'renderAt')::timestamptz, 'epoch') < now() - interval '6 minutes' returning *`;
  if (!b) { const [x] = await sql<any[]>`select status, result from mkt_briefs where id = ${briefId}`; return { status: x?.status ?? 'missing', stage: x?.result?.stage, mediaIds: x?.result?.mediaIds }; }
  const r = b.result; const spec = KIND_SPEC[b.kind]; const dir = await mkdtemp(join(tmpdir(), 'mkt-v2-'));
  let finished = false;
  try {
    const { getObject } = await import('./storage');
    if (r.stage === 'qa') {
      const { qaScenes } = await import('./video/qa'); const errors: string[] = [...(r.errors ?? [])]; let again = 0;
      for (const v of r.variants as V2Variant[]) {
        if (v.error) continue;
        const todo = v.scenes.filter((s) => s.status === 'completed' && !s.qa);
        if (!todo.length) continue;
        const clips = [];
        for (const s of todo) { const file = `q${v.n}-${s.k}.mp4`; await writeFile(join(dir, file), await getObject(s.key!)); clips.push({ k: s.k, file, seconds: s.seconds, visual: s.visualEn }); }
        const res = await qaScenes(b.tenant, b.created_by, dir, clips);
        for (const s of todo) {
          s.qa = res.get(s.k) ?? { checked: false, ok: false, issues: ['검수 결과 없음'] };
          if (s.qa.checked && !s.qa.ok && (s.regens ?? 0) < QA_REGEN) {
            s.regens = (s.regens ?? 0) + 1; s.lastIssues = s.qa.issues; s.prevKey = s.key; s.key = null; s.qa = null;
            await submitScene(s, b.prompt ?? {}, spec.aspect, r.model, errors, (s.lastIssues ?? []).map((x) => FIX_EN[x] ?? x));
            again++;
          }
        }
        r.errors = errors.slice(-30); await save(briefId, r);
      }
      if (again) { await save(briefId, { ...r, stage: 'clips', renderAt: null, pollAt: null }); finished = true; return { status: 'generating', stage: 'clips' }; }
      r.stage = 'render'; await save(briefId, r);
    }
    for (const v of r.variants as V2Variant[]) {
      if (v.error || v.mediaId) continue;
      if (Date.now() - t0 > budgetMs - 90_000) break; // 남은 편은 다음 호출에서
      try { const o = await renderVariant(b, r, v, dir); v.mediaId = o.mediaId; v.duration = o.duration; v.notes = o.notes; v.renderError = null; r.audio = o.audio; }
      catch (e: any) { v.renderTries = (v.renderTries ?? 0) + 1; v.renderError = String(e?.message ?? e).slice(0, 300); if (v.renderTries >= 2) v.error = `합성 실패: ${v.renderError}`; }
      await save(briefId, r);
    }
    if ((r.variants as V2Variant[]).every((v) => v.error || v.mediaId)) { finished = true; return await finalize(b, r); }
    return { status: 'generating', stage: r.stage };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    if (!finished) await sql`update mkt_briefs set result = result - 'renderAt' where id = ${briefId}`.catch(() => {});
  }
}

/** 마무리: 새 버전(영상 n편) → 승인 대기, 검수에서 걸린 장면은 '사람 검수 필요'로 콘텐츠 근거에 남김, 크레딧 원장(재생성 포함 실제 초) */
async function finalize(b: any, r: any) {
  const sql = db(); const p = b.prompt ?? {};
  const variants = r.variants as V2Variant[]; const mediaIds = variants.map((v) => v.mediaId).filter((x): x is string => !!x);
  if (!mediaIds.length) {
    const msg = variants.map((v) => v.error).filter(Boolean).join(' / ').slice(0, 500) || '합성 실패';
    await save(b.id, { ...r, stage: 'failed', renderAt: null }, { status: 'failed', error: msg });
    return { status: 'failed', stage: 'failed', errors: [msg] };
  }
  const review = variants.flatMap((v) => v.mediaId ? v.scenes.filter((s) => s.qa && !s.qa.ok).map((s) => `${variants.length > 1 ? `${v.n + 1}편 ` : ''}장면 ${s.k + 1}: ${(s.qa!.issues ?? []).join(', ') || '검수 못 함'}`) : []);
  const notes = [...new Set(variants.flatMap((v) => v.notes ?? []))];
  const actor = await actorFor(b.created_by);
  const { addVersion } = await import('./marketing');
  const scenesN = variants[0]?.scenes.length ?? 0;
  const ver = await addVersion(actor, b.content_id, { body: p.caption ?? b.message, mediaIds, note: `제작의뢰실 영상 ${mediaIds.length}편(장면 ${scenesN}개 합성 · ${r.model}) · ${review.length ? `사람 검수 필요 ${review.length}곳` : 'AI 검수 통과'}` });
  await sql`update mkt_contents set rationale = coalesce(rationale, '{}'::jsonb) || ${sql.json({ qa: { needsHuman: review.length > 0, issues: review.slice(0, 12), notes: notes.slice(0, 8), at: new Date().toISOString() } } as never)} where id = ${b.content_id}`;
  const planned = variants.reduce((a, v) => a + v.scenes.reduce((x, s) => x + s.seconds, 0), 0);
  const used = variants.reduce((a, v) => a + v.scenes.reduce((x, s) => x + s.seconds * Math.max(1, s.generated ?? 1), 0), 0); // 실패·검수 거절(nsfw)은 과금 안 됨 → 완성된 클립만 셈
  const credits = Math.round(Number(b.est_credits) * (planned ? used / planned : 1) * 10) / 10;
  const [c] = await sql<{ title: string }[]>`select title from mkt_contents where id = ${b.content_id}`;
  await sql`insert into mkt_credit_ledger (tenant, content_id, version, kind, credits, note, created_by, title) values (${b.tenant}, ${b.content_id}, ${(ver as any)?.version ?? 2}, 'generate_video', ${credits},
    ${`제작의뢰실 영상 · ${r.model} · 생성 ${used}초${used > planned ? `(다시 만든 ${used - planned}초 포함)` : ''}`}, ${b.created_by}, ${c?.title ?? ''})`;
  await save(b.id, { ...r, stage: 'done', mediaIds, review, notes, renderAt: null, usedSeconds: used }, { status: 'review', error: variants.some((v) => v.error) ? variants.map((v) => v.error).filter(Boolean).join(' / ').slice(0, 500) : null });
  return { status: 'review', stage: 'done', mediaIds };
}

/** 제작의뢰실 화면용 진행 요약 */
export function v2Progress(r: any) {
  if (r?.pipeline !== 'v2') return null;
  const vs: V2Variant[] = r.variants ?? []; const scenes = vs.flatMap((v) => v.scenes ?? []);
  const done = scenes.filter((s) => s.status === 'completed').length; const again = scenes.filter((s) => (s.regens ?? 0) > 0 && s.status !== 'completed').length;
  const label = ({ clips: `장면 만드는 중 ${done}/${scenes.length}${again ? ` · 검수에 걸려 다시 만드는 장면 ${again}` : ''}`, qa: 'AI 검수 중(외국어 글자·외국인·깨진 화면)', render: '합성 중(이어 붙이기·자막·소리·끝 화면)', done: '완료', failed: '실패' } as Record<string, string>)[r.stage] ?? r.stage;
  return { stage: r.stage, label, done, total: scenes.length, review: r.review ?? [], notes: r.notes ?? [], audio: r.audio ?? null,
    variants: vs.map((v) => ({ n: v.n, mediaId: v.mediaId ?? null, duration: v.duration ?? null, error: v.error ?? null, renderError: v.renderError ?? null,
      scenes: v.scenes.map((s) => ({ k: s.k, seconds: s.seconds, line: s.line, status: s.status, screen: !!s.screen, regens: s.regens ?? 0, qa: s.qa ?? null })) })) };
}
