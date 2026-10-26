import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { forbidden } from './errors';
import { tenantOf, type SessionUser } from './types';
import { KIND_SPEC, PURPOSE } from './mktStudio';
import { END_SEC, endCtaOf, splitClip, type V2Scene, type V2Variant } from './mktVideo';
import { END_XFADE, XFADE } from './video/compose';
import { syllables } from './mktQuality';

/**
 * 187차 ⑦(로컬 10/26 16:45 '크레딧 쓴 영상 11편은 지우지 말고 새 영상 방식으로 보완'): 이번 달 만든 영상(크레딧 원장 '영상 생성' 줄)을
 * 새로 만들지 않고 새 방식(한국어 자막 · 끝 화면 전화 · 배경음 · 내레이션 키가 있으면 내레이션)으로 다시 합성한다 — 생성 호출 0, 크레딧 원장 그대로.
 * - 장면별로 만든 영상(v2 합성본): 그때 만든 장면 클립으로 다시 합성(장면 대사 = 자막·내레이션)
 * - 한 편짜리 영상(의뢰 1차·제작 요청 카드로 붙인 영상): 합성 때 길이를 재서 장면 2~4개로 나누고 자막 한 줄씩(릴스 대본 칸 → 의뢰 장면 대사 → 본문 문장 순)
 * 의뢰(mkt_briefs, provider 'reuse')로 만들어 기존 합성 순서(합성 함수·정기 실행 renderTick)를 그대로 탄다. 결과는 새 버전 → 승인함, 보관(10/25 전면 정리)했던 글은 보관 표시를 지운다.
 * 원래 영상은 이전 버전에 그대로 남는다. 관리자만. 응답에 모델·외부 서비스 이름 없음(#602).
 */
const adminOnly = (u: SessionUser) => { if (!isAdmin(u)) throw forbidden('영상 다시 합성은 관리자가 합니다'); };
export const reuseInput = z.object({ ledgerIds: z.array(z.number().int().positive()).min(1).max(20) });

type FileRow = { id: string; key: string; title: string; meta: any };
type BriefRow = { id: string; kind: string; purpose: string; message: string; tone: string | null; mode: string | null; prompt: any; result: any; status: string; error: string | null; created_at: string };
type Row = { id: string; content_id: string; version: number | null; credits: number; created_at: Date; title: string; status: string; deleted_at: Date | null; c_kind: string; channel: string;
  brand_id: string | null; quality: any; mode: string | null; is_test: boolean; brand: string | null; phone: string | null; kit: any; body: string | null; files: FileRow[]; briefs: BriefRow[] };
type Status = 'ready' | 'failed' | 'working' | 'done' | 'published' | 'deleted' | 'missing';
const STATUS_KO: Record<Status, string> = { ready: '다시 합성 가능', failed: '지난번 실패', working: '다시 합성 중', done: '이미 다시 합성함', published: '이미 게시한 글', deleted: '휴지통에 있는 글', missing: '영상 파일 없음' };
const r1 = (x: number) => Math.round(x * 10) / 10;
/** 실패 사유는 쉬운 말로(서버 경로·영문 오류를 화면에 그대로 내지 않음) */
const failText = (e: string | null | undefined) => { const t = String(e ?? '');
  return /ENOENT|NoSuchKey|not ?found|찾을 수 없|없습니다/i.test(t) ? '원본 영상 파일을 읽지 못했습니다' : /길이를 읽지/.test(t) ? '원본 영상의 길이를 읽지 못했습니다' : '합성하지 못했습니다 — 다시 시도해 보세요'; };

/** 자막 줄: 릴스·쇼츠 대본(컷) 칸 → 의뢰 장면 대사 → 본문 문장(해시태그·주소 빼고, 한글 4~60자) */
export function reuseLines(script: unknown, scenes: unknown, body: string | null | undefined): string[] {
  const clean = (x: unknown) => String(x ?? '').replace(/#[^\s#]+/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim();
  const pick = (a: unknown[]) => a.map(clean).filter((x) => x.length >= 2).slice(0, 6);
  if (Array.isArray(script)) { const a = pick(script); if (a.length) return a; }
  if (Array.isArray(scenes)) { const a = pick(scenes.map((x: any) => x?.line)); if (a.length) return a; }
  return String(body ?? '').split(/\n+/).flatMap((l) => l.split(/(?<=[.!?。])\s+/)).map(clean).filter((x) => x.length >= 4 && x.length <= 60 && /[가-힣]/.test(x)).slice(0, 6);
}

/** 이번 달(서울 기준) 영상 생성 원장 줄 + 콘텐츠·브랜드·영상 파일(원장 버전 이후 처음 영상이 붙은 버전, 다시 합성본 제외)·의뢰 */
async function loadRows(t: string, ids: number[] | null, q: ReturnType<typeof db> = db()) {
  return q<Row[]>`select l.id::text as id, l.content_id, l.version, l.credits::float8 as credits, l.created_at,
      c.title, c.status, c.deleted_at, c.kind as c_kind, c.channel, c.brand_id, c.quality, c.mode, c.is_test, br.name as brand, br.facts->>'phone' as phone, br.video as kit,
      (select v.body from mkt_versions v where v.content_id = c.id and v.version = c.current_version) as body,
      (select coalesce(json_agg(x order by x.ord), '[]'::json) from (
        select f.id, f.storage_key as key, coalesce(nullif(f.title, ''), f.file_name) as title, f.meta, m.ord
        from mkt_versions v cross join lateral unnest(v.media_ids) with ordinality m(fid, ord) join library_files f on f.id = m.fid and f.tenant = c.tenant
        where v.content_id = c.id and f.mime_type like 'video/%' and f.deleted_at is null and f.upload_status = 'ready' and f.storage_key is not null and not (coalesce(f.meta->'video', '{}'::jsonb) ? 'reuse')
          and v.version = (select min(v2.version) from mkt_versions v2 cross join lateral unnest(v2.media_ids) m2(fid) join library_files f2 on f2.id = m2.fid and f2.tenant = c.tenant
            where v2.content_id = c.id and v2.version >= coalesce(l.version, 1) and f2.mime_type like 'video/%' and f2.deleted_at is null and f2.upload_status = 'ready' and f2.storage_key is not null
              and not (coalesce(f2.meta->'video', '{}'::jsonb) ? 'reuse'))) x) as files,
      (select coalesce(json_agg(y order by y.created_at desc), '[]'::json) from (select b.id, b.kind, b.purpose, b.message, b.tone, b.mode, b.prompt, b.result, b.status, b.error, b.created_at
        from mkt_briefs b where b.tenant = c.tenant and b.content_id = c.id and b.status <> 'canceled') y) as briefs
    from mkt_credit_ledger l join mkt_contents c on c.id = l.content_id and c.tenant = l.tenant left join mkt_brands br on br.id = c.brand_id
    where l.tenant = ${t} and l.kind = 'generate_video' and l.created_at >= (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')
      ${ids ? q`and l.id = any(${ids}::bigint[])` : q``}
    order by l.created_at desc, l.id desc limit 60`;
}

type Plan = { status: Status; reason: string | null; plan: 'scenes' | 'clip' | null; kind: string; orig: BriefRow | null; reuse: BriefRow | null; variants: V2Variant[]; lines: string[]; seconds: number | null; scenes: number | null };
/** 원장 줄 하나 → 상태·계획(장면 그대로 / 한 편 나누기)·만들 편(variant) */
function planOf(r: Row): Plan {
  const files = r.files ?? []; const briefs = r.briefs ?? []; const fileIds = new Set(files.map((f) => f.id));
  const reuse = briefs.find((b) => b.result?.provider === 'reuse' && String(b.result?.reuse?.ledger) === r.id) ?? null;
  const own = briefs.filter((b) => b.result?.provider !== 'reuse');
  const orig = own.find((b) => (b.result?.mediaIds ?? []).some((m: string) => fileIds.has(m))) ?? own.find((b) => KIND_SPEC[b.kind]?.media === 'video') ?? null;
  const kind = KIND_SPEC[r.c_kind]?.media === 'video' ? r.c_kind : orig && KIND_SPEC[orig.kind]?.media === 'video' ? orig.kind : r.channel === 'youtube' ? 'shorts' : 'reels';
  const base: Plan = { status: 'missing', reason: null, plan: null, kind, orig, reuse, variants: [], lines: [], seconds: null, scenes: null };
  if (r.deleted_at) return { ...base, status: 'deleted', reason: STATUS_KO.deleted };
  if (r.status === 'published') return { ...base, status: 'published', reason: '이미 게시한 글 — 그대로 둡니다' };
  if (reuse?.status === 'generating') return { ...base, status: 'working' };
  if (reuse && reuse.status !== 'failed') return { ...base, status: 'done' };
  if (!files.length) return { ...base, status: 'missing', reason: '영상 파일을 찾지 못함(지웠거나 글에 붙지 않음)' };
  const failed = reuse?.status === 'failed';
  const st: Pick<Plan, 'status' | 'reason'> = { status: failed ? 'failed' : 'ready', reason: failed ? `지난번 실패: ${failText(reuse?.error)}` : null };
  // 장면별로 만든 영상(v2 합성본) — 자막·끝 화면이 이미 들어 있어 합성본을 다시 쓰지 않고 그때 장면 클립으로
  if (files.some((f) => f.meta?.video?.pipeline === 'v2')) {
    const vs = ((orig?.result?.pipeline === 'v2' ? orig.result.variants : []) as V2Variant[])
      .filter((v) => v.mediaId && fileIds.has(v.mediaId) && v.scenes?.length && v.scenes.every((s) => s.key));
    if (!vs.length) return { ...base, status: 'missing', reason: '장면 기록이 없어 다시 합성할 수 없음' };
    const variants: V2Variant[] = vs.slice(0, 5).map((v, n) => ({ n, origin: v.mediaId, scenes: v.scenes.map((s): V2Scene => ({ k: s.k, seconds: s.seconds, line: s.line, visualEn: s.visualEn, screen: s.screen ?? null,
      status: 'completed', tries: s.tries ?? 0, generated: s.generated, key: s.key, qa: s.qa ?? null })) }));
    const sc = variants[0].scenes;
    return { ...base, ...st, plan: 'scenes', variants, lines: sc.map((s) => s.line).filter(Boolean), scenes: sc.length,
      seconds: r1(sc.reduce((a, s) => a + s.seconds, 0) - (sc.length - 1) * XFADE - END_XFADE + END_SEC) };
  }
  // 한 편짜리 영상 — 합성 때 길이를 재서 장면으로 나눔(길이를 알면 미리 보여 줌)
  const lines = reuseLines(r.quality?.script, orig?.prompt?.scenes, r.body);
  const variants: V2Variant[] = files.slice(0, 5).map((f, n) => ({ n, origin: f.id, scenes: [], source: { key: f.key, fileId: f.id, lines } }));
  const dur = Number(files[0].meta?.video?.duration ?? files[0].meta?.scenes?.duration) || null;
  const est = dur ? splitClip(dur, lines, syllables) : null;
  return { ...base, ...st, plan: 'clip', variants, lines: (est ? est.map((s) => s.line) : lines.slice(0, 4)).filter(Boolean),
    scenes: est ? est.length : Math.max(1, Math.min(4, lines.length)), seconds: dur ? r1(dur - END_XFADE + END_SEC) : null };
}

/** 제작의뢰실 '이번 달 만든 영상 다시 합성' 목록(관리자) */
export async function reuseList(u: SessionUser) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const t = tenantOf(u);
  const rows = await loadRows(t, null);
  const { ttsSettings } = await import('./video/tts'); const tts = await ttsSettings();
  const bgm = (await (await import('./mktVideo')).videoAssets(t, '영상 배경음')).length;
  const list = rows.map((r) => {
    const p = planOf(r); const end = endCtaOf(String(r.kit?.cta || p.orig?.prompt?.endCard?.cta || ''), String(r.phone ?? ''));
    return { ledgerId: Number(r.id), contentId: r.content_id, title: r.title, brand: r.brand, at: r.created_at, credits: Number(r.credits), status: p.status, reason: p.reason, plan: p.plan,
      videos: p.variants.length, scenes: p.scenes, seconds: p.seconds, lines: p.lines.slice(0, 4), fileId: r.files?.[0]?.id ?? null, endCta: end.cta || null,
      reuseBriefId: p.reuse?.id ?? null, contentStatus: r.status, isTest: !!r.is_test };
  });
  return { rows: list, ready: list.filter((x) => x.status === 'ready' || x.status === 'failed').length, narration: tts.ready, bgm };
}

/** [다시 합성]: 고른 원장 줄마다 다시 합성 의뢰(생성 크레딧 0)를 만들고 처음 3편은 바로 합성 함수로, 나머지는 정기 실행이 이어받음.
 *  회사마다 잠금 — 두 번 눌러도 같은 영상을 두 번 만들지 않음(진행 중·완료된 줄은 건너뜀) */
export async function reuseStart(u: SessionUser, i: z.infer<typeof reuseInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const t = tenantOf(u); const sql = db(); const want = [...new Set(i.ledgerIds)];
  const started: string[] = []; const skipped: { ledgerId: number; reason: string }[] = [];
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`mkt-video-reuse:${t}`}))`;
    const rows = await loadRows(t, want, tx as unknown as ReturnType<typeof db>);
    for (const id of want) {
      const r = rows.find((x) => Number(x.id) === id);
      if (!r) { skipped.push({ ledgerId: id, reason: '이번 달 영상 목록에 없음' }); continue; }
      const p = planOf(r);
      if (p.status !== 'ready' && p.status !== 'failed') { skipped.push({ ledgerId: id, reason: p.reason ?? STATUS_KO[p.status] }); continue; }
      const spec = KIND_SPEC[p.kind]; const o = p.orig;
      const prompt = { ...(o?.prompt ?? {}), caption: r.body ?? o?.prompt?.caption ?? '', source: 'reuse' }; // 새 버전 본문 = 지금 글 그대로
      const result = { provider: 'reuse', pipeline: 'v2', model: null, stage: 'render', variants: p.variants, errors: [], notes: [], mediaIds: [], reuse: { ledger: r.id, plan: p.plan, from: o?.id ?? null } };
      const message = String(o?.message || r.title || '영상').replace(/^\s*\[시험\]\s*/, '').slice(0, 300) || '영상';
      const [b] = await tx<{ id: string }[]>`insert into mkt_briefs (tenant, brand_id, channel, kind, purpose, message, refs, tone, quantity, status, prompt, content_id, est_credits, result, created_by, mode)
        values (${t}, ${r.brand_id}, ${spec.channel}, ${p.kind}, ${o?.purpose && PURPOSE[o.purpose] ? o.purpose : 'awareness'}, ${message}, ${tx.json({ reuse: true } as never)}, ${o?.tone ?? null},
          ${p.variants.length}, 'generating', ${tx.json(prompt as never)}, ${r.content_id}, 0, ${tx.json(result as never)}, ${u.id}, ${o?.mode === 'ad' || r.mode === 'ad' ? 'ad' : 'content'}) returning id`;
      started.push(b.id);
    }
    await (await import('./log')).audit(tx as never, u.id, 'mkt.video_reuse', 'tenant', t, { ledgers: want, started: started.length, skipped: skipped.length });
  });
  const { kickRender } = await import('./mktVideo');
  for (const id of started.slice(0, 3)) await kickRender(id).catch(() => {}); // 실패는 의뢰 상태·정기 실행이 다시
  return { started: started.length, briefIds: started, skipped };
}
