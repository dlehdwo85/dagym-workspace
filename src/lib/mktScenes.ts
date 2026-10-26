import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from './db';

/**
 * 188차(대표 #685 '폴더명 말고 모든 사진·영상' · 로컬 10/26 P1 '영상은 장면 2~3장 + 설명' · #619 '영상 = 2초·중간 화면 설명'):
 * 자료실 영상(사람이 올린 것 — AI 생성·합성 영상, '쓰지않음' 표시, 기밀 자료·기밀 폴더, 격리 팀 자료는 빼고)에서 장면 사진 2~3장(2초 무렵·가운데·끝 무렵)을 뽑아
 * 자료실 '마케팅/영상 장면' 폴더에 저장한다 — 장면 사진 meta.video = 원본 영상, 영상 meta.scenes = 뽑은 장면 목록(또는 실패·건너뜀 이유).
 * 장면 사진은 사진 AI 설명(mktPhotos)을 거쳐 시안 바탕·카드뉴스 장·블로그 본문 후보가 된다(실사 규칙 그대로) · 첫 장면 설명은 설명이 빈 영상의 설명으로(#619 영상 분류).
 * ffmpeg 정적 빌드는 합성 함수(/api/marketing/studio/render)에만 실려 있어 운영(Vercel)에서는 그 함수를 부른다(kickScenes). 시험·로컬은 그 자리에서.
 * 실패는 영상 meta.scenes.error 로 남기고 1시간 뒤·세 번까지만 다시. 영상은 150MB 까지. 마케팅을 쓰는 회사(브랜드가 있는 회사)만.
 */
export const SCENE_FOLDER = '마케팅/영상 장면';
const VIDEO_MAX = 150 * 1024 * 1024;
/** 우리가 만든·AI 로 만든 영상(이름·폴더·태그) — 실사가 아니라서 장면을 뽑지 않음 */
export const AI_VIDEO = /AI\s*생성|합성|제작의뢰실|higgsfield|kling|seedance|자동\s*시안/i;
const clip = (s: unknown, n: number) => [...String(s ?? '').replace(/\s+/g, ' ').trim()].slice(0, n).join('');
const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** 뽑을 시각(초): 3초 미만 = 가운데 1장 · 8초 미만 = 2장(앞·뒤쪽) · 그 밖 = 2초·가운데·82%(끝 화면·검은 화면 피함) */
export function sceneTimes(d: number | null | undefined): number[] {
  if (!d || !Number.isFinite(d) || d < 0.4) return [];
  const r = (x: number) => Math.round(x * 10) / 10;
  if (d < 3) return [r(d / 2)];
  if (d < 8) return [r(Math.min(2, d * 0.3)), r(d * 0.65)];
  return [2, r(d * 0.5), r(d * 0.82)];
}

/** 장면을 뽑을 수 있는 영상(별칭 없이 library_files 를 읽는 쿼리용) — 사진 후보(mktPhotos.poolCond)와 같은 제외 규칙 */
const videoCond = (sql: ReturnType<typeof db>, tenant: string) => sql`library_files.tenant = ${tenant} and library_files.deleted_at is null and library_files.upload_status = 'ready'
  and library_files.mime_type like 'video/%' and library_files.storage_key is not null and coalesce(library_files.size_bytes, 0) <= ${VIDEO_MAX}
  and coalesce(library_files.source, '') not in ('ai', 'ai_attach', 'revenue') and coalesce(library_files.security, 'internal') <> 'confidential'
  and not (coalesce(library_files.meta, '{}'::jsonb) ? 'video') and not ('쓰지않음' = any(coalesce(library_files.tags, '{}')))
  and not exists (select 1 from library_folder_security fs where fs.tenant = library_files.tenant and fs.security = 'confidential' and (library_files.folder = fs.folder or left(library_files.folder, length(fs.folder) + 1) = fs.folder || '/'))
  and (library_files.space = 'marketing' or not exists (select 1 from team_members mi join teams ti on ti.id = mi.team_id join users uu on uu.id = mi.user_id
    where mi.user_id = library_files.created_by and ti.isolated and not ti.archived and ti.tenant = library_files.tenant and uu.role not in ('owner', 'admin')))`;
/** 아직 안 뽑았거나, 실패 뒤 1시간 지났고 세 번이 안 된 영상 */
const pendingCond = (sql: ReturnType<typeof db>, retryWait = true) => sql`(library_files.meta->'scenes' is null or (library_files.meta->'scenes' ? 'error'
  and coalesce((library_files.meta->'scenes'->>'tries')::int, 1) < 3 ${retryWait ? sql`and (library_files.meta->'scenes'->>'at')::timestamptz < now() - interval '1 hour'` : sql``}))`;

type VRow = { id: string; title: string; file_name: string; folder: string; tags: string[]; storage_key: string; created_by: string | null; meta: any };

/** 영상 한 편 → 장면 사진 저장 → 영상 meta.scenes. 중간에 실패하면 이번에 저장한 장면은 지움(다시 뽑을 때 겹치지 않게) */
async function extract(tenant: string, v: VRow): Promise<string[]> {
  const sql = db(); const { getObject } = await import('./storage'); const F = await import('./video/ffmpeg');
  const { actorOf } = await import('./mktAutoVisual'); const { saveGeneratedFile } = await import('./library');
  const actor = await actorOf({ tenant, created_by: v.created_by });
  if (!actor) throw new Error('자료실에 저장할 사람이 없습니다(활성 계정 없음)');
  const dir = await mkdtemp(join(tmpdir(), 'scenes-')); const saved: { id: string; at: number }[] = [];
  try {
    const ext = (/\.(\w{2,5})$/.exec(v.file_name)?.[1] ?? 'mp4').toLowerCase();
    const inFile = join(dir, `in.${ext}`);
    await writeFile(inFile, await getObject(v.storage_key));
    const info = await F.mediaInfo(inFile);
    if (!info.video) throw new Error('영상 화면을 읽지 못했습니다');
    const times = sceneTimes(info.duration);
    if (!times.length) throw new Error('영상 길이를 읽지 못했습니다');
    const sharp = (await import('sharp')).default;
    const safe = v.title.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[\\/:*?"<>|\n]+/g, ' ').trim().slice(0, 50) || '영상';
    const tags = [...new Set([...(v.tags ?? []).filter((x) => !/^(글자없음|글자있음)$/.test(String(x).replace(/\s+/g, ''))), '영상 장면'])].slice(0, 20);
    for (const [k, t] of times.entries()) {
      const f = join(dir, `s${k}.jpg`);
      await F.ffmpegOk(['-ss', String(t), '-i', inFile, '-frames:v', '1', '-q:v', '2', f], { timeoutMs: 60_000 });
      const raw = await readFile(f).catch(() => null);
      if (!raw?.length) continue;
      // 휴대폰 4K 영상도 긴 변 1920px 로(시안 1080px 에 충분) — 방향은 ffmpeg 가 이미 바로잡음
      const data = await sharp(raw, { failOn: 'none' }).resize(1920, 1920, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
      const s = await saveGeneratedFile(actor, { fileName: `${safe}_장면${k + 1}.jpg`, mime: 'image/jpeg', data, title: `${safe} — 장면 ${k + 1}(${clock(t)})`, folder: SCENE_FOLDER, tags,
        description: '', source: 'video_frame', space: 'marketing', meta: { video: { id: v.id, at: t, title: v.title } } });
      saved.push({ id: s.id, at: t });
    }
    if (!saved.length) throw new Error('장면을 뽑지 못했습니다');
    await sql`update library_files set meta = coalesce(meta, '{}'::jsonb) || ${sql.json({ scenes: { v: 1, at: new Date().toISOString(), duration: info.duration, frames: saved } } as never)} where id = ${v.id}`;
    return saved.map((x) => x.id);
  } catch (e) {
    if (saved.length) await sql`update library_files set deleted_at = now() where id = any(${saved.map((x) => x.id)}::uuid[])`;
    throw e;
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

/** 장면 뽑기 묶음(회사마다 한 번에 하나) — ids = 그 영상만(다시 뽑기 포함). 새 장면 사진은 바로 사진 AI 설명(예산·AI 꺼짐이면 정기 실행이 나중에) */
export async function sceneBatch(tenant: string, o: { limit?: number; budgetMs?: number; ids?: string[] } = {}) {
  const L = await import('./later'); const sql = db();
  const r = await L.withLock(`mktScenes:${tenant}`, async () => {
    const t0 = Date.now(); const budget = o.budgetMs ?? 120e3;
    const rows = await sql<VRow[]>`select id, coalesce(nullif(title, ''), file_name) as title, file_name, folder, tags, storage_key, created_by, meta from library_files
      where ${videoCond(sql, tenant)} and ${o.ids?.length ? sql`id = any(${o.ids}::uuid[])` : pendingCond(sql)}
      order by (space = 'marketing') desc, created_at desc limit ${o.limit ?? 4}`;
    let done = 0; let failed = 0; let skipped = 0; const fresh: string[] = [];
    for (const v of rows) {
      if ((done || failed) && Date.now() - t0 > budget) break;
      const at = new Date().toISOString();
      if (AI_VIDEO.test(`${v.title} ${v.file_name} ${v.folder} ${(v.tags ?? []).join(' ')}`)) {
        await sql`update library_files set meta = coalesce(meta, '{}'::jsonb) || ${sql.json({ scenes: { v: 1, at, skipped: 'AI 생성·합성 영상 — 실사가 아니라 장면을 뽑지 않음' } } as never)} where id = ${v.id}`;
        skipped++; continue;
      }
      try { const ids = await extract(tenant, v); fresh.push(...ids); done++; } catch (e: any) {
        failed++;
        const tries = (v.meta?.scenes?.error ? Number(v.meta.scenes.tries) || 1 : 0) + 1;
        await sql`update library_files set meta = coalesce(meta, '{}'::jsonb) || ${sql.json({ scenes: { v: 1, at, error: clip(e?.message ?? e, 200), tries } } as never)} where id = ${v.id}`;
        if (tries >= 3) await (await import('./log')).logError('mkt:scenes', e, { fileId: v.id }).catch(() => {});
      }
    }
    let described = 0;
    if (fresh.length) {
      try { await (await import('./mktAuto')).assertMktAi(tenant); described = (await (await import('./mktPhotos')).describeBatch(tenant, { ids: fresh, limit: fresh.length, budgetMs: 60e3 })).done; } catch { /* 설명은 정기 실행이 다시 */ }
    }
    const [{ left }] = await sql<{ left: number }[]>`select count(*)::int as left from library_files where ${videoCond(sql, tenant)} and ${pendingCond(sql, false)}`;
    return { done, failed, skipped, frames: fresh.length, described, left };
  });
  return L.isBusy(r) ? { done: 0, failed: 0, skipped: 0, frames: 0, described: 0, left: 0, busy: true } : r;
}

/** 사진 AI 설명 화면 숫자: 영상 수·장면 뽑음·실패·AI 영상 건너뜀·아직·장면 사진 수 */
export async function scenesView(tenant: string) {
  const sql = db();
  const [r] = await sql<{ total: number; done: number; failed: number; skipped: number; frames: number }[]>`select count(*)::int as total,
      count(*) filter (where meta->'scenes' ? 'frames')::int as done, count(*) filter (where meta->'scenes' ? 'error')::int as failed,
      count(*) filter (where meta->'scenes' ? 'skipped')::int as skipped,
      coalesce(sum(case when jsonb_typeof(meta->'scenes'->'frames') = 'array' then jsonb_array_length(meta->'scenes'->'frames') else 0 end), 0)::int as frames
    from library_files where ${videoCond(sql, tenant)}`;
  return { ...r, pending: Math.max(0, r.total - r.done - r.failed - r.skipped) };
}

/** 장면 뽑기 시작 — 운영(Vercel)은 ffmpeg 가 실린 합성 함수로 넘기고(응답 202, 처리는 그 함수에서), 시험·로컬은 그 자리에서 */
export async function kickScenes(tenant: string | null, o: { limit?: number; budgetMs?: number } = {}) {
  if (process.env.VERCEL && process.env.CRON_SECRET) {
    const { appUrl } = await import('./mail');
    try {
      await fetch(`${appUrl()}/api/marketing/studio/render`, { method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, 'content-type': 'application/json' },
        body: JSON.stringify({ scenes: tenant ?? true }), signal: AbortSignal.timeout(8000) });
    } catch { /* 다음 정기 실행이 다시 부름 */ }
    return { via: 'render-route' as const };
  }
  return tenant ? sceneBatch(tenant, o) : { runs: await scenesRun() };
}
/** 마케팅을 쓰는 회사(브랜드가 있음) 가운데 뽑을 영상이 있는 회사 — 한 번에 3곳 */
async function sceneTenants() {
  return db()<{ tenant: string }[]>`select distinct tenant from library_files where deleted_at is null and upload_status = 'ready' and mime_type like 'video/%'
    and coalesce(source, '') not in ('ai', 'ai_attach', 'revenue') and ${pendingCond(db())} and exists (select 1 from mkt_brands b where b.tenant = library_files.tenant) order by tenant limit 3`;
}
/** 합성 함수에서(또는 시험·로컬 정기 실행 응답 뒤): 회사마다 영상 4편, 전체 200초 안 */
export async function scenesRun(tenant?: string | null) {
  const t0 = Date.now(); const out: Record<string, unknown>[] = [];
  for (const t of tenant ? [{ tenant }] : await sceneTenants()) {
    const left = 200e3 - (Date.now() - t0);
    if (left < 20e3) break;
    out.push({ tenant: t.tenant, ...(await sceneBatch(t.tenant, { limit: 4, budgetMs: left - 15e3 })) });
  }
  return out;
}
/** 정기 실행: 뽑을 영상이 있으면 합성 함수를 부름 · 시험 서버는 MKT_SCENES_TICK=0(장면 뽑기는 API 로 직접 시험) */
export async function scenesTick() {
  if (process.env.MKT_SCENES_TICK === '0') return { off: true };
  if (!(await sceneTenants()).length) return { idle: true };
  if (process.env.VERCEL && process.env.CRON_SECRET) return kickScenes(null);
  (await import('./later')).runLater('mktScenes', async () => scenesRun());
  return { started: 'later' as const };
}
