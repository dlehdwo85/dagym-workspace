import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { notify } from './notifications';
import { audit } from './log';
import { tenantOf, type SessionUser } from './types';
import { zUuid } from './api';

/** V41 단계 4-2 마케팅 공간 핵심: 콘텐츠·버전·승인함(버전 단위, 승인·수정 요청·보류)·콘텐츠 캘린더·전화 문의 → 영업 업무 */
export const CHANNELS = { instagram: '인스타그램', facebook: '페이스북', threads: '스레드', blog: '블로그', youtube: '유튜브', naver_place: '네이버 플레이스', other: '기타' } as const;
const zChannel = z.enum(Object.keys(CHANNELS) as [keyof typeof CHANNELS, ...(keyof typeof CHANNELS)[]]);
const uuidOr404 = (id: string) => { if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('찾을 수 없습니다'); };
const seoulDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
/** 승인 마감 = 게시일 HH:00(서울, 회사 설정 — 기본 09:00) */
/** 승인 마감 = 게시 당일 HH:00 KST(기본 09:00), 게시 시각이 더 이르면 게시 시각(운영실 규칙, OPS_ROOM_SCREEN_SPEC 3-2) */
export const approvalDeadline = (scheduledAt: Date | string | null, hour = 9) => {
  if (!scheduledAt) return null;
  const at = new Date(scheduledAt);
  const d = new Date(`${seoulDate(at)}T${String(hour).padStart(2, '0')}:00:00+09:00`);
  return at < d ? at : d;
};
/** 승인 대기 숫자 — 메뉴 배지·현황 머리줄·승인함이 같은 계산: 승인 대기 + 마감 안 지남 + 시험 아님 */
export const APPROVABLE_SQL = (hour: number) => db()`status = 'pending' and not is_test and (scheduled_at is null or least(scheduled_at, ((scheduled_at at time zone 'Asia/Seoul')::date + make_interval(hours => ${hour})) at time zone 'Asia/Seoul') >= now())`;
export async function approvableCount(tenant: string) {
  const st = await (await import('./mktAuto')).settingsOf(tenant);
  const [r] = await db()<{ n: number }[]>`select count(*)::int as n from mkt_contents where tenant = ${tenant} and ${APPROVABLE_SQL(st.approval_hour)}`;
  return r.n;
}

async function mediaOk(u: SessionUser, ids: string[]) {
  const { loadLibraryFile } = await import('./library');
  for (const id of ids) await loadLibraryFile(u, id, 'meta'); // 볼 수 없는 자료는 404
}

/** 현황 머리줄·오늘 게시(운영실 홈 2-1): 승인할 시안(오늘 게시 먼저 → 게시 시각순) · 오늘 게시(예정·승인 대기·게시됨·지연) · 없으면 다음 게시 */
export async function homeNow(t: string) {
  const sql = db();
  const st = await (await import('./mktAuto')).settingsOf(t);
  const cols = sql`c.id, c.title, c.channel, c.kind, c.status, c.scheduled_at, c.current_version, c.published_url, b.name as brand, b.color as brand_color`;
  const queue = await sql<any[]>`select ${cols}, ((c.scheduled_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date) as today
    from mkt_contents c left join mkt_brands b on b.id = c.brand_id where c.tenant = ${t} and ${APPROVABLE_SQL(st.approval_hour)}
    order by ((c.scheduled_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date) desc nulls last, c.scheduled_at nulls last limit 50`;
  const todayPosts = await sql<any[]>`select ${cols} from mkt_contents c left join mkt_brands b on b.id = c.brand_id
    where c.tenant = ${t} and not c.is_test and c.status in ('pending', 'changes', 'approved', 'published') and (c.scheduled_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date order by c.scheduled_at`;
  const [next] = todayPosts.length ? [null] : await sql<any[]>`select ${cols} from mkt_contents c left join mkt_brands b on b.id = c.brand_id
    where c.tenant = ${t} and not c.is_test and c.status in ('pending', 'approved') and c.scheduled_at > now() order by c.scheduled_at limit 1`;
  const dl = (r: any) => ({ ...r, deadline: approvalDeadline(r.scheduled_at, st.approval_hour) });
  return { queue: queue.map(dl), todayPosts: todayPosts.map(dl), next: next ? dl(next) : null, approvalHour: st.approval_hour };
}

export async function overview(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u);
  const [c] = await sql<any[]>`select
      count(*) filter (where status = 'pending')::int as pending,
      count(*) filter (where status in ('approved', 'pending') and (scheduled_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date)::int as today,
      count(*) filter (where status in ('approved', 'pending', 'changes') and scheduled_at between now() and now() + interval '7 days')::int as week,
      count(*) filter (where status = 'changes')::int as changes
    from mkt_contents where tenant = ${t}`;
  const [k] = await sql<any[]>`select count(*) filter (where status = 'new')::int as calls from mkt_calls where tenant = ${t}`;
  // 대표(10/19): 첫 화면 맨 위 '오늘' — 오늘 제작된 시안·오늘 승인할 것(내일까지 게시 예정인 승인 대기)·오늘 게시 예정·오늘 게시됨(시험 제외)
  const [d] = await sql<any[]>`select (now() at time zone 'Asia/Seoul')::date::text as date,
      count(*) filter (where (produced_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date)::int as produced,
      count(*) filter (where status in ('pending', 'changes') and (scheduled_at at time zone 'Asia/Seoul')::date <= (now() at time zone 'Asia/Seoul')::date + 1)::int as approve_soon,
      count(*) filter (where status = 'approved' and (scheduled_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date)::int as post_today,
      count(*) filter (where status = 'published' and (published_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date)::int as posted_today
    from mkt_contents where tenant = ${t} and not is_test`;
  // 로컬 10/19(대표): 홈 = 채널 상태(연결 0개면 3단계·끊김이면 빨간 띠) · 이번 주 게시 일정(지연 빨강) · 성과 요약(최근 7일 광고비 대비 전화·문의)
  const week = await sql<any[]>`select c.id, c.title, c.channel, c.kind, c.status, c.scheduled_at, b.name as brand,
      exists (select 1 from mkt_publish_jobs j where j.content_id = c.id and j.status = 'failed') as failed,
      (c.status <> 'published' and c.scheduled_at < now()) as late
    from mkt_contents c left join mkt_brands b on b.id = c.brand_id
    where c.tenant = ${t} and not c.is_test and c.status in ('pending', 'changes', 'approved', 'published', 'hold')
      and (c.scheduled_at at time zone 'Asia/Seoul')::date between (now() at time zone 'Asia/Seoul')::date and (now() at time zone 'Asia/Seoul')::date + 6 order by c.scheduled_at limit 60`;
  const [perf] = await sql<any[]>`select coalesce((select sum(s.cost_krw) from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${t} and s.day >= (now() at time zone 'Asia/Seoul')::date - 6), 0)::float8 as cost,
      coalesce((select sum(s.clicks) from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${t} and s.day >= (now() at time zone 'Asia/Seoul')::date - 6), 0)::float8 as clicks,
      (select count(*) from mkt_calls where tenant = ${t} and called_at >= now() - interval '7 days')::int as calls`;
  const { homeChannels } = await import('./mktChannels');
  return { ...c, pending: await approvableCount(t), calls: k.calls, todayRow: d, home: await homeNow(t), week, perf, channels: await homeChannels(u), canEdit: isAdmin(u) };
}

export async function listBrands(u: SessionUser) { await assertSpace(u, 'marketing'); return { brands: await db()`select id, name, color from mkt_brands where tenant = ${tenantOf(u)} order by name` }; }
export const brandInput = z.object({ name: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional() });
export async function createBrand(u: SessionUser, i: z.infer<typeof brandInput>) {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('브랜드는 관리자가 등록합니다');
  const [b] = await db()`insert into mkt_brands (tenant, name, color) values (${tenantOf(u)}, ${i.name}, ${i.color ?? '#7C3AED'}) on conflict (tenant, name) do update set color = excluded.color returning id`;
  return { id: b.id };
}

/** 대표 재지적 10/20 18:45 ③: 블로그는 표지 1장 + 본문 사진 1장 이상이 있어야 승인 요청(승인 대기)·승인이 됩니다 — 없으면 '수정 요청' 상태로 사진을 기다림 */
export const BLOG_PHOTO_RULE = '블로그는 표지 1장 + 본문 사진 1장 이상을 붙여야 승인 요청됩니다';
export const needsPhotos = (channel: string, mediaCount: number) => channel === 'blog' && mediaCount < 2;
export async function listContents(u: SessionUser, q: { view?: string; from?: string; to?: string; day?: string }) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u);
  const rows = await sql<any[]>`select c.id, c.title, c.channel, c.kind, c.mode, c.cross_channels, c.status, c.scheduled_at, c.current_version, c.approved_version, c.published_url, c.published_at, c.published_deleted_at, c.is_test, b.name as brand, b.color as brand_color, c.brand_id, b.video->>'logoFileId' as brand_logo,
      v.body, cardinality(v.media_ids) as media_count, v.media_ids, v.note as version_note,
      (select json_agg(json_build_object('id', f.id, 'mime', f.mime_type) order by array_position(v.media_ids, f.id)) from library_files f where f.id = any(v.media_ids) and f.deleted_at is null) as media_info, u.name as created_by_name, c.updated_at, c.auto, c.produce_at, c.produced_at, c.quality, c.rationale,
      (select json_build_object('kind', p.kind, 'status', p.status) from mkt_production_requests p where p.content_id = c.id and p.kind in ('image', 'video', 'regen_image', 'regen_video') and p.status in ('open', 'needs_approval') order by p.created_at desc limit 1) as production,
      (select max(d.version) from mkt_decisions d where d.content_id = c.id and d.decision = 'changes' and d.version < c.current_version) as reapprove_from,
      (select json_build_object('decision', d.decision, 'comment', d.comment, 'at', d.decided_at, 'version', d.version, 'by', du.name) from mkt_decisions d left join users du on du.id = d.decided_by
        where d.content_id = c.id order by d.decided_at desc limit 1) as last_decision
    from mkt_contents c left join mkt_brands b on b.id = c.brand_id
    left join mkt_versions v on v.content_id = c.id and v.version = c.current_version
    left join users u on u.id = c.created_by
    where c.tenant = ${t} and c.status <> 'canceled'
      and (${q.view ?? ''} <> 'approvals' or ${q.day ?? ''} <> '' or c.status in ('pending', 'changes', 'hold', 'approved') or (c.status = 'draft' and (c.scheduled_at > now() or c.quality->'held' is not null))) -- 대표 10/20 14:10 ②: 예정(초안)도 승인함에 묶음으로 · #544 초안 보관은 날짜가 지나도
      -- 현황 '오늘' 카드에서 들어온 목록(시험 제외)
      and (${q.day ?? ''} = '' or (not c.is_test and case ${q.day ?? ''}
        when 'produced' then (c.produced_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date
        when 'soon' then c.status in ('pending', 'changes') and (c.scheduled_at at time zone 'Asia/Seoul')::date <= (now() at time zone 'Asia/Seoul')::date + 1
        when 'today' then c.status = 'approved' and (c.scheduled_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date
        when 'published' then c.status = 'published' and (c.published_at at time zone 'Asia/Seoul')::date = (now() at time zone 'Asia/Seoul')::date
        else true end))
      and (${q.from ?? ''} = '' or c.scheduled_at >= ${q.from || '1970-01-01'}::date)
      and (${q.to ?? ''} = '' or c.scheduled_at < (${q.to || '2999-01-01'}::date + 1))
    order by c.scheduled_at nulls last, c.created_at desc limit 300`;
  const st = await (await import('./mktAuto')).settingsOf(t);
  const handleOf = await (await import('./mktPublish')).accountLabels(t).catch(() => () => null); // #497 R06 카드 '게시 화면으로 보기' 이름
  const now = Date.now();
  return { approvalHour: st.approval_hour, canDecide: isAdmin(u), contents: rows.map((r) => { const deadline = r.scheduled_at ? approvalDeadline(r.scheduled_at, st.approval_hour) : null;
    return { ...r, handle: handleOf(r.channel, r.brand_id), deadline, late: !!deadline && deadline.getTime() < now && ['pending', 'changes'].includes(r.status) }; }) };
}

/** 로컬 10/21 08:10: 브랜드·게시 예정 시각 바로잡기(관리자) — 승인 상태는 그대로(게시 계정 선택·마감 재배치용) */
export const contentPatchInput = z.object({ brandId: zUuid.nullable().optional(), scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  mode: z.enum(['content', 'ad']).optional() /* #499-1 콘텐츠형(참여)·광고형(전환) — 훅 채점 기준 */ });
export async function patchContent(u: SessionUser, id: string, i: z.infer<typeof contentPatchInput>) {
  await assertSpace(u, 'marketing'); if (!isAdmin(u)) throw forbidden('관리자만');
  uuidOr404(id);
  const sql = db(); const t = tenantOf(u);
  if (i.brandId) { const [b] = await sql`select id from mkt_brands where id = ${i.brandId} and tenant = ${t}`; if (!b) throw badRequest('브랜드를 찾을 수 없습니다'); }
  const [c] = await sql<any[]>`update mkt_contents set brand_id = ${i.brandId === undefined ? sql`brand_id` : i.brandId}, scheduled_at = ${i.scheduledAt === undefined ? sql`scheduled_at` : i.scheduledAt}, mode = ${i.mode ?? sql`mode`}, updated_at = now()
    where id = ${id} and tenant = ${t} and status <> 'published' returning id, brand_id, scheduled_at, status, mode`;
  if (!c) throw notFound('콘텐츠를 찾을 수 없습니다(게시된 콘텐츠는 못 바꿈)');
  await audit(sql, u.id, 'mkt_content.patch', 'mkt_content', id, { brandId: i.brandId, scheduledAt: i.scheduledAt, mode: i.mode }).catch(() => {});
  return { id: c.id, brandId: c.brand_id, scheduledAt: c.scheduled_at, status: c.status, mode: c.mode };
}
export async function getContent(u: SessionUser, id: string) {
  await assertSpace(u, 'marketing');
  uuidOr404(id);
  const sql = db();
  const [c] = await sql<any[]>`select c.*, b.name as brand, b.voice as brand_voice, b.color as brand_color, b.video->>'logoFileId' as brand_logo from mkt_contents c left join mkt_brands b on b.id = c.brand_id where c.id = ${id} and c.tenant = ${tenantOf(u)}`; // #497 R06 미리보기 프로필(브랜드 키트 로고·색)
  if (!c) throw notFound('콘텐츠를 찾을 수 없습니다');
  const versions = await sql<any[]>`select v.version, v.body, v.media_ids, v.note, v.created_at, u.name as created_by_name from mkt_versions v left join users u on u.id = v.created_by where v.content_id = ${id} order by v.version desc`;
  const ids = [...new Set(versions.flatMap((v) => v.media_ids as string[]))];
  // 로컬 10/21 02:10: media 는 버전의 media_ids 순서(표지 → 영상)로
  const media = ids.length ? await sql`select id, title, file_name, mime_type from library_files where id = any(${ids}::uuid[]) and tenant = ${tenantOf(u)} and deleted_at is null order by array_position(${ids}::uuid[], id)` : [];
  const publishJobs = await sql`select j.id, j.provider, j.status, j.version, j.permalink, j.is_test, j.last_error, j.attempts, j.run_after, j.created_at, j.deleted_at, j.checked_at, u.name as requested_by_name, a.label as account from mkt_publish_jobs j left join mkt_publish_accounts a on a.id = j.account_id left join users u on u.id = j.requested_by where j.content_id = ${id} order by j.created_at desc`;
  const decisions = await sql`select d.version, d.decision, d.comment, d.decided_at, u.name as decided_by_name from mkt_decisions d left join users u on u.id = d.decided_by where d.content_id = ${id} order by d.decided_at desc`;
  const st = await (await import('./mktAuto')).settingsOf(tenantOf(u));
  // 대표 10/20 22:30 ② M1: 서버 게시 가능 채널·계정(관리자 [서버로 게시] 버튼) + 회사 자동 게시 설정
  const P = await import('./mktPublish');
  const targets = await P.publishTargets(tenantOf(u), c).catch(() => []);
  const handle = (await P.accountLabels(tenantOf(u)).catch(() => () => null))(c.channel, c.brand_id); // #497 R06 미리보기 이름(카드와 같은 고르기)
  // #426 글 품질: AI 시안은 제작 때 낸 보고서(훅 후보·자동 수정 기록 포함), 사람이 올린 버전은 지금 본문으로 바로 검사(저장 안 함)
  const cur = versions.find((v) => v.version === c.current_version);
  const Q = await import('./mktQuality');
  const mode = Q.asMode(c.mode); const kw = [String(c.brand ?? '').replace(/^\s*\[시험\]\s*/, '')].filter(Boolean);
  const saved = c.quality?.report?.v === c.current_version ? c.quality.report : null;
  // #499-1 용도를 바꿨으면(콘텐츠형↔광고형) 제작 때 보고서의 훅 후보·장면으로 그 기준에 맞춰 다시 채점(자동 수정 기록은 그대로)
  const qualityReport = saved && Q.asMode(saved.mode) === mode ? saved
    : cur ? { ...Q.qualityReport({ channel: c.channel, kind: c.kind, title: c.title, body: cur.body ?? '', keywords: kw, voice: c.brand_voice, cross: c.cross_channels ?? [], mode,
        hooks: saved?.hooks?.map((h: { text: string }) => h.text), script: saved?.timing?.rows?.map((r: { line: string }) => r.line) }, await Q.qualityRules()).report, ...(saved ? { v: saved.v, notes: saved.notes } : {}) } : null;
  delete c.brand_voice;
  return { content: { ...c, handle, deadline: approvalDeadline(c.scheduled_at, st.approval_hour) }, versions, media, decisions, publishJobs, canDecide: isAdmin(u), qualityReport, publish: { targets, autoPublish: !!st.auto_publish, canServer: isAdmin(u) && !c.is_test && targets.some((t) => t.accounts.length > 0) } };
}

const versionFields = { body: z.string().max(20000).default(''), mediaIds: z.array(zUuid).max(20).default([]), note: z.string().max(500).optional() };
/** 대표 10/20 11:40 ② (#95) 스레드는 글 500자(Threads API 한도) — 스레드 채널이거나 '스레드에도' 체크면 저장 때 막는다(게시 때 잘리지 않게) */
export const THREADS_MAX = 500;
function threadsLimit(channel: string, cross: string[] | null | undefined, body: string) {
  if (channel !== 'threads' && !(cross ?? []).includes('threads')) return;
  const n = [...body].length;
  if (n > THREADS_MAX) throw badRequest(`스레드는 ${THREADS_MAX}자 이내로 써 주세요 (지금 ${n}자). 스레드를 빼거나 글을 줄여 주세요`);
}
export const contentInput = z.object({ title: z.string().trim().min(1).max(200), channel: zChannel, brandId: zUuid.nullable().optional(), scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  /** 대표 10/20 11:40 ②·6): 같은 글을 함께 올릴 채널('페이스북에도'·'스레드에도') — 승인 1건, M1 게시 실행기가 채널마다 올림 */
  crossChannels: z.array(z.enum(['instagram', 'facebook', 'threads'])).max(3).optional(), ...versionFields,
  /** #499-1 용도: 콘텐츠형(참여) / 광고형(전환) — 훅 채점 기준 */
  mode: z.enum(['content', 'ad']).optional(),
  /** 대표 10/20 18:00 ①: 근거 — 목적·목표 지표·핵심 메시지·왜 이 글인가(선택) */
  rationale: z.object({ purpose: z.string().trim().max(200).optional(), metric: z.string().trim().max(200).optional(), message: z.string().trim().max(200).optional(), why: z.string().trim().max(300).optional() }).optional() });
export async function createContent(u: SessionUser, i: z.infer<typeof contentInput>) {
  await assertSpace(u, 'marketing');
  await mediaOk(u, i.mediaIds);
  const sql = db(); const t = tenantOf(u);
  const [br] = i.brandId ? await sql<{ test_mode: boolean }[]>`select test_mode from mkt_brands where id = ${i.brandId} and tenant = ${t}` : [];
  if (i.brandId && !br) throw notFound('브랜드를 찾을 수 없습니다');
  const isTest = !!br?.test_mode; // 시험 모드 브랜드: [시험] 표시·알림은 올린 사람에게만·게시 확인 안 됨
  const title = isTest && !i.title.startsWith('[시험]') ? `[시험] ${i.title}` : i.title;
  threadsLimit(i.channel, i.crossChannels, i.body);
  return sql.begin(async (tx) => {
    const rat = i.rationale && Object.values(i.rationale).some(Boolean) ? { ...i.rationale, source: 'user' } : null;
    const [c] = await tx<{ id: string }[]>`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, is_test, cross_channels, rationale, mode)
      values (${t}, ${i.brandId ?? null}, ${title}, ${i.channel}, ${i.scheduledAt ?? null}, ${needsPhotos(i.channel, i.mediaIds.length) ? 'changes' : 'pending'}, 1, ${u.id}, ${isTest}, ${(i.crossChannels ?? []).filter((x) => x !== i.channel)}, ${rat ? tx.json(rat as never) : null}, ${i.mode ?? 'content'}) returning id`;
    await tx`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, ${i.body}, ${i.mediaIds}, ${i.note ?? null}, ${u.id})`;
    if (needsPhotos(i.channel, i.mediaIds.length)) { await tx`update mkt_contents set quality = ${tx.json({ passed: false, issues: [BLOG_PHOTO_RULE] } as never)} where id = ${c.id}`; return { id: c.id, version: 1, needsPhotos: true }; }
    // #104: 승인자 + 브랜드 담당에게 바로, 시험 브랜드는 올린 사람에게만
    await (await import('./mktAuto')).mktNotify(tx, { tenant: t, brand_id: i.brandId ?? null, is_test: isTest, created_by: u.id }, u.id, { approval: true, type: 'review_requested', title: `승인 대기: ${title}`, body: `${u.name} · ${CHANNELS[i.channel]}`, link: `/s/marketing/approvals?c=${c.id}`, entityType: 'mkt_content', entityId: c.id, actorId: u.id, dedupeKey: `mkt:${c.id}:1` });
    return { id: c.id, version: 1 };
  });
}

/** 수정본 = 새 버전. 새 버전이 오면 이전 승인은 무효 → 재승인 대기 */
export const versionInput = z.object(versionFields);
export async function addVersion(u: SessionUser, id: string, i: z.infer<typeof versionInput>) {
  await assertSpace(u, 'marketing');
  uuidOr404(id);
  await mediaOk(u, i.mediaIds);
  const sql = db();
  return sql.begin(async (tx) => {
    const [c] = await tx<any[]>`select id, title, current_version, status, is_test, created_by, channel, brand_id, cross_channels, quality from mkt_contents where id = ${id} and tenant = ${tenantOf(u)} for update`;
    if (!c) throw notFound('콘텐츠를 찾을 수 없습니다');
    if (c.status === 'published') throw badRequest('이미 게시한 콘텐츠입니다');
    threadsLimit(c.channel, c.cross_channels, i.body);
    const v = c.current_version + 1;
    await tx`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${id}, ${v}, ${i.body}, ${i.mediaIds}, ${i.note ?? null}, ${u.id})`;
    if (needsPhotos(c.channel, i.mediaIds.length)) { await tx`update mkt_contents set current_version = ${v}, status = 'changes', quality = ${tx.json({ passed: false, issues: [BLOG_PHOTO_RULE] } as never)}, updated_at = now() where id = ${id}`; return { version: v, needsPhotos: true }; }
    // 사진·영상이 붙으면 '사진 필요'(블로그)·'시안 없음/영상 제작 중'(#516) 줄은 지우고, 그것뿐이었으면 검사 결과를 비움
    // 서버가 그린 시안 표시(visual)는 같은 그림을 그대로 둘 때만 남김 — 사람이 다른 사진을 붙이면 [AI 이미지로 다시] 대상이 아님
    let quality = c.quality ?? null;
    if (quality && i.mediaIds.length) {
      const { VISUAL_ISSUE } = await import('./mktAutoVisual');
      const { visual, ...q } = quality;
      const left = ((q.issues ?? []) as string[]).filter((x) => x !== BLOG_PHOTO_RULE && !VISUAL_ISSUE.test(x));
      quality = q.passed === false && (q.issues ?? []).length && !left.length ? null : { ...q, issues: left, ...(visual && i.mediaIds.length === 1 && i.mediaIds[0] === visual.fileId ? { visual } : {}) };
    }
    await tx`update mkt_contents set current_version = ${v}, status = 'pending', quality = ${quality ? tx.json(quality as never) : null}, updated_at = now() where id = ${id}`;
    await (await import('./mktAuto')).mktNotify(tx, { tenant: tenantOf(u), brand_id: c.brand_id, is_test: c.is_test, created_by: c.created_by }, u.id, { approval: true, type: 'review_requested', title: `재승인 대기(v${v}): ${c.title}`, body: i.note ?? `${u.name}님이 수정본을 올렸습니다`, link: `/s/marketing/approvals?c=${id}`, entityType: 'mkt_content', entityId: id, actorId: u.id, dedupeKey: `mkt:${id}:${v}` });
    return { version: v };
  });
}

/** 승인함 결정(버전 단위): 보던 버전이 최신이 아니면 거부, 승인은 시안 이미지(자료) 있는 버전만. 버튼 = 승인 · 수정 요청 · 보류(대표 결정 10/17) */
export const decideInput = z.object({ version: z.number().int().min(1), decision: z.enum(['approve', 'changes', 'hold']), comment: z.string().max(2000).optional() });
export async function decide(u: SessionUser, id: string, i: z.infer<typeof decideInput>, ip: string | null) {
  await assertSpace(u, 'marketing');
  uuidOr404(id);
  if (!isAdmin(u)) throw forbidden('승인은 관리자가 합니다');
  if (i.decision !== 'approve' && (i.comment?.trim().length ?? 0) < 2) throw badRequest(i.decision === 'changes' ? '무엇을 고칠지 두 글자 이상 적어 주세요' : '보류 이유를 두 글자 이상 적어 주세요');
  const sql = db();
  const res = await sql.begin(async (tx) => {
    const [c] = await tx<any[]>`select id, title, current_version, status, created_by, channel from mkt_contents where id = ${id} and tenant = ${tenantOf(u)} for update`;
    if (!c) throw notFound('콘텐츠를 찾을 수 없습니다');
    if (i.version !== c.current_version) throw new HttpError(409, 'stale_version', `최신 버전(v${c.current_version})이 아닙니다 — 새로 고쳐 보고 결정해 주세요`);
    if (c.status === 'published') throw badRequest('이미 게시한 콘텐츠입니다');
    if (i.decision === 'approve' && c.channel !== 'threads') { // 스레드는 글만으로도 승인(사진은 선택). 블로그는 표지+본문 사진(2장 이상) — 대표 10/20 18:45
      const [v] = await tx<{ n: number }[]>`select cardinality(media_ids) as n from mkt_versions where content_id = ${id} and version = ${i.version}`;
      if (needsPhotos(c.channel, v?.n ?? 0)) throw badRequest(`${BLOG_PHOTO_RULE} — 지금 ${v?.n ?? 0}장`);
      if (!v?.n) throw badRequest('시안 이미지가 없어 승인할 수 없습니다 — 시안을 붙인 뒤 다시');
    }
    const status = { approve: 'approved', changes: 'changes', hold: 'hold' }[i.decision];
    await tx`insert into mkt_decisions (content_id, version, decision, comment, decided_by) values (${id}, ${i.version}, ${i.decision}, ${i.comment ?? null}, ${u.id})`;
    await tx`update mkt_contents set status = ${status}, approved_version = ${i.decision === 'approve' ? i.version : null}, updated_at = now() where id = ${id}`;
    if (c.created_by) await notify(tx, { userIds: [c.created_by], type: 'review_result', title: `${{ approve: '승인', changes: '수정 요청', hold: '보류' }[i.decision]}: ${c.title}`, body: i.comment ?? `v${i.version}`, link: `/s/marketing/approvals?c=${id}`, entityType: 'mkt_content', entityId: id, actorId: u.id, dedupeKey: `mktd:${id}:${i.version}:${i.decision}`, space: 'marketing' });
    await audit(tx as never, u.id, 'mkt.decide', 'mkt_content', id, { version: i.version, decision: i.decision }, ip);
    return { status };
  });
  // V41 4-3/V43 5: 자동 제작 콘텐츠의 수정 요청 = 분류 → 글자·배치는 AI 가 새 버전, 재생성은 제작 요청 카드(한도 확인)
  if (i.decision === 'changes' && i.comment) {
    const r = await (await import('./mktAuto')).onChangesRequested(id, i.comment).catch((e) => ({ error: String(e?.message ?? e).slice(0, 200) }));
    if (r) return { ...res, revision: r };
  }
  return res;
}

/** 게시 확인(수동 게시 — 공식 쓰기 API 없는 채널 포함): 승인된 최신 버전만, 게시 주소(증거) 필수 */
export const publishInput = z.object({ url: z.string().url().max(500) });
export async function markPublished(u: SessionUser, id: string, i: z.infer<typeof publishInput>) {
  await assertSpace(u, 'marketing');
  uuidOr404(id);
  const sql = db();
  const [c] = await sql<any[]>`select current_version, approved_version, status, is_test, channel from mkt_contents where id = ${id} and tenant = ${tenantOf(u)}`;
  if (!c) throw notFound('콘텐츠를 찾을 수 없습니다');
  if (c.status !== 'approved' || c.approved_version !== c.current_version) throw new HttpError(409, 'not_approved', '승인된 최신 버전만 게시 확인할 수 있습니다');
  // ⑤-1: 수동 게시(네이버 블로그 도우미·직접 올림)도 게시 작업 기록으로 남김 — 같은 콘텐츠·버전은 한 번만. 시험 콘텐츠도 수동 게시 확인은 됨(기록에 시험 표시, 월간 보고·서버 게시에서는 빠짐)
  const provider = c.channel === 'blog' && /(^|\.)blog\.naver\.com$/.test(new URL(i.url).hostname) ? 'naver_blog' : 'manual';
  await sql.begin(async (tx) => {
    await tx`update mkt_contents set status = 'published', published_url = ${i.url}, published_at = now(), published_by = ${u.id}, updated_at = now() where id = ${id}`;
    await tx`insert into mkt_publish_jobs (tenant, content_id, version, provider, status, idempotency_key, permalink, requested_by, is_test)
      values (${tenantOf(u)}, ${id}, ${c.current_version}, ${provider}, 'done', ${`${id}:${c.current_version}:${provider}`}, ${i.url}, ${u.id}, ${!!c.is_test}) on conflict (idempotency_key) do nothing`;
  });
  return { ok: true, provider };
}

// ---------------- 전화 문의 → 영업 ----------------
export async function listCalls(u: SessionUser, q: { status?: string }) {
  await assertSpace(u, 'marketing');
  const t = tenantOf(u);
  // 광고 최적화 1차 ③ "어떻게 알고 전화하셨어요?" — 최근 30일 광고비가 나간 키워드를 고르기 목록으로
  const adKeywords = (await db()<{ keyword: string }[]>`select max(s.item_name) as keyword from mkt_ad_items s join mkt_ad_accounts a on a.id = s.account_id
    where a.tenant = ${t} and s.kind = 'keyword' and s.day >= (now() at time zone 'Asia/Seoul')::date - 30 group by s.item_id order by sum(s.cost_krw) desc limit 50`).map((r) => r.keyword).filter(Boolean);
  return { adKeywords, calls: await db()`select c.id, c.phone, c.called_at, c.source, c.status, c.memo, c.task_id, c.ad_keyword, c.ad_provider, b.name as brand from mkt_calls c left join mkt_brands b on b.id = c.brand_id
    where c.tenant = ${t} and (${q.status ?? ''} = '' or c.status = ${q.status ?? ''}) order by c.called_at desc limit 200` };
}
const zAdProvider = z.enum(['naver', 'google', 'meta', 'other']);
export const callInput = z.object({ phone: z.string().trim().min(4).max(30), calledAt: z.string().datetime({ offset: true }).optional(), source: z.string().max(100).optional(), brandId: zUuid.nullable().optional(), memo: z.string().max(1000).optional(),
  adKeyword: z.string().trim().max(60).optional(), adProvider: zAdProvider.optional() });
export async function createCall(u: SessionUser, i: z.infer<typeof callInput>) {
  await assertSpace(u, 'marketing');
  const [c] = await db()`insert into mkt_calls (tenant, brand_id, phone, called_at, source, memo, created_by, ad_keyword, ad_provider) values (${tenantOf(u)}, ${i.brandId ?? null}, ${i.phone}, ${i.calledAt ?? new Date().toISOString()}, ${i.source ?? null}, ${i.memo ?? null}, ${u.id},
    ${i.adKeyword || null}, ${i.adKeyword ? i.adProvider ?? null : null}) returning id`;
  return { id: c.id };
}
export const callUpdateInput = z.object({ status: z.enum(['new', 'excluded']).optional(), memo: z.string().max(1000).optional(),
  adKeyword: z.string().trim().max(60).nullable().optional(), adProvider: zAdProvider.nullable().optional() }); // 광고 키워드는 나중에 알게 되면 고침(null = 지움)
export async function updateCall(u: SessionUser, id: string, i: z.infer<typeof callUpdateInput>) {
  await assertSpace(u, 'marketing');
  uuidOr404(id);
  const kw = i.adKeyword !== undefined; const kwVal = i.adKeyword || null;
  const [c] = await db()`update mkt_calls set status = coalesce(${i.status ?? null}, status), memo = coalesce(${i.memo ?? null}, memo),
    ad_keyword = case when ${kw} then ${kwVal}::text else ad_keyword end, ad_provider = case when ${kw} then ${kwVal ? i.adProvider ?? null : null}::text else ad_provider end
    where id = ${id} and tenant = ${tenantOf(u)} returning id`;
  if (!c) throw notFound();
  return { ok: true };
}
/** [영업 리드로]: 영업 담당에게 업무 카드(영업 공간 리드 표는 단계 2에서 — 그때 리드로 옮겨 연결) */
export const convertInput = z.object({ assigneeId: zUuid.nullable().optional() });
export async function convertCall(u: SessionUser, id: string, i: z.infer<typeof convertInput>) {
  await assertSpace(u, 'marketing');
  uuidOr404(id);
  const sql = db();
  const [c] = await sql<any[]>`select c.*, b.name as brand from mkt_calls c left join mkt_brands b on b.id = c.brand_id where c.id = ${id} and c.tenant = ${tenantOf(u)}`;
  if (!c) throw notFound();
  if (c.task_id) return { taskId: c.task_id };
  const { createTask } = await import('./tasks');
  const rule = i.assigneeId ? null : await (await import('./assignees')).resolveAssignee(sql, tenantOf(u), 'marketing_brand', c.brand_id ?? '').catch(() => null); // #100 브랜드별 마케팅 담당
  const r = await createTask(u, { title: `[전화 문의] ${c.phone}${c.brand ? ` · ${c.brand}` : ''}`, description: [`전화 시각: ${new Date(c.called_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`, c.source ? `들어온 곳: ${c.source}` : '', c.memo ?? ''].filter(Boolean).join('\n'),
    assigneeId: i.assigneeId ?? rule?.userId ?? u.id, requestedById: u.id, approvalRequired: false, space: 'marketing' } as never);
  if (rule) await sql`update tasks set assigned_by_rule = ${rule.ruleId} where id = ${(r as any).id}`;
  await sql`update mkt_calls set status = 'lead', task_id = ${(r as any).id} where id = ${id}`;
  return { taskId: (r as any).id };
}

// ---------------- V41 4-2 마케팅 AI 비서: 캡션·해시태그 초안(게시는 승인 대기를 거쳐 사람이) ----------------
export const captionInput = z.object({ channel: zChannel, topic: z.string().trim().min(2, '무엇을 알릴지 적어 주세요').max(1000), brandId: zUuid.nullable().optional(), tone: z.string().max(40).optional() });
const CAPTION_LEN: Record<string, string> = { instagram: '3~6줄, 첫 줄은 눈길을 끄는 한 문장', facebook: '3~5문장', threads: '1~4줄(500자 이내), 대화하듯', blog: '제목 1줄 + 본문 8~12문장', youtube: '제목 1줄 + 설명 3~5줄', naver_place: '소식 2~4문장', other: '3~5문장' };
export async function captionAssist(u: SessionUser, i: z.infer<typeof captionInput>) {
  await assertSpace(u, 'marketing');
  const { requireMenu } = await import('./menuPerms');
  await requireMenu(u, 'assistant', 'use');
  const P = await import('./ai/provider');
  if (!P.aiEnabled()) throw new HttpError(503, 'ai_off', 'AI 가 설정되지 않았습니다');
  const G = await import('./ai/guard');
  await G.assertAiCredit();
  await G.assertUserBudget(u);
  await (await import('./plans')).assertAiRequest(u);
  await (await import('./mktAuto')).assertMktAi(tenantOf(u)); // 상용화 ⑦ 마케팅 월 한도
  const sql = db();
  const [brand] = i.brandId ? await sql<{ name: string }[]>`select name from mkt_brands where id = ${i.brandId} and tenant = ${tenantOf(u)}` : [];
  const Pn = await import('./ai/persona');
  const co = await Pn.companyAi(u, sql);
  const p = P.anthropicProvider({ tier: 'fast' });
  let r;
  try {
    r = await p.chat({
      system: `회사 마케팅 담당을 돕는 카피라이터입니다. ${i.channel === 'other' ? 'SNS' : CHANNELS[i.channel]}에 올릴 글 초안 3개(서로 다른 각도)와 해시태그(최대 10개, # 없이)를 씁니다.
- 한국어. 길이: ${CAPTION_LEN[i.channel]}. 과장·최상급·근거 없는 수치·가격·할인·의료 효능 표현은 쓰지 않습니다. 모르는 값은 [ ] 로 비워 둡니다.
- 개인 연락처·실명은 쓰지 않습니다. 초안일 뿐이며 게시는 승인 뒤 사람이 합니다. JSON 만.
${Pn.companyBlock(co)}`,
      tools: [], messages: [{ role: 'user', content: `${brand ? `[브랜드] ${brand.name}\n` : ''}${i.tone ? `[말투] ${i.tone}\n` : ''}[알릴 것] ${i.topic}` }],
      format: { type: 'object', additionalProperties: false, required: ['captions', 'hashtags'], properties: { captions: { type: 'array', items: { type: 'string' } }, hashtags: { type: 'array', items: { type: 'string' } } } },
    });
  } catch (e) { throw await G.onAiError(e); }
  const cost = P.costUsd(r.model ?? p.model, r.usage);
  await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
    values (${tenantOf(u)}, ${u.id}, ${(await import('node:crypto')).randomUUID()}, ${p.name}, ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, 0, 0, ${cost}, 'marketing_caption')`;
  let o: { captions?: unknown; hashtags?: unknown } = {};
  try { o = JSON.parse((r.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('')); } catch { /* 형식이 틀리면 빈 결과 */ }
  const captions = (Array.isArray(o.captions) ? o.captions : []).map((x) => String(x).trim().slice(0, 3000)).filter(Boolean).slice(0, 3);
  const hashtags = [...new Set((Array.isArray(o.hashtags) ? o.hashtags : []).map((x) => String(x).replace(/^#+/, '').replace(/\s+/g, '').slice(0, 30)).filter(Boolean))].slice(0, 10);
  if (!captions.length) throw new HttpError(502, 'ai_unavailable', 'AI 가 초안을 만들지 못했습니다. 다시 시도해 주세요');
  await G.userBudgetAlerts(u).catch(() => {});
  return { captions, hashtags, costKrw: Math.round(cost * P.usdKrw() * 100) / 100 };
}
