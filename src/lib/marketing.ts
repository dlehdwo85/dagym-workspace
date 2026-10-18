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
export const CHANNELS = { instagram: '인스타그램', facebook: '페이스북', blog: '블로그', youtube: '유튜브', naver_place: '네이버 플레이스', other: '기타' } as const;
const zChannel = z.enum(Object.keys(CHANNELS) as [keyof typeof CHANNELS, ...(keyof typeof CHANNELS)[]]);
const uuidOr404 = (id: string) => { if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('찾을 수 없습니다'); };
const seoulDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
/** 승인 마감 = 게시일 HH:00(서울, 회사 설정 — 기본 09:00) */
export const approvalDeadline = (scheduledAt: Date | string | null, hour = 9) => scheduledAt ? new Date(`${seoulDate(new Date(scheduledAt))}T${String(hour).padStart(2, '0')}:00:00+09:00`) : null;

async function mediaOk(u: SessionUser, ids: string[]) {
  const { loadLibraryFile } = await import('./library');
  for (const id of ids) await loadLibraryFile(u, id, 'meta'); // 볼 수 없는 자료는 404
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
  return { ...c, calls: k.calls };
}

export async function listBrands(u: SessionUser) { await assertSpace(u, 'marketing'); return { brands: await db()`select id, name, color from mkt_brands where tenant = ${tenantOf(u)} order by name` }; }
export const brandInput = z.object({ name: z.string().trim().min(1).max(40), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional() });
export async function createBrand(u: SessionUser, i: z.infer<typeof brandInput>) {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('브랜드는 관리자가 등록합니다');
  const [b] = await db()`insert into mkt_brands (tenant, name, color) values (${tenantOf(u)}, ${i.name}, ${i.color ?? '#7C3AED'}) on conflict (tenant, name) do update set color = excluded.color returning id`;
  return { id: b.id };
}

export async function listContents(u: SessionUser, q: { view?: string; from?: string; to?: string }) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u);
  const rows = await sql<any[]>`select c.id, c.title, c.channel, c.status, c.scheduled_at, c.current_version, c.approved_version, c.published_url, b.name as brand, b.color as brand_color,
      v.body, cardinality(v.media_ids) as media_count, u.name as created_by_name, c.updated_at
    from mkt_contents c left join mkt_brands b on b.id = c.brand_id
    left join mkt_versions v on v.content_id = c.id and v.version = c.current_version
    left join users u on u.id = c.created_by
    where c.tenant = ${t} and c.status <> 'canceled'
      and (${q.view ?? ''} <> 'approvals' or c.status in ('pending', 'changes', 'hold'))
      and (${q.from ?? ''} = '' or c.scheduled_at >= ${q.from || '1970-01-01'}::date)
      and (${q.to ?? ''} = '' or c.scheduled_at < (${q.to || '2999-01-01'}::date + 1))
    order by c.scheduled_at nulls last, c.created_at desc limit 300`;
  const st = await (await import('./mktAuto')).settingsOf(t);
  return { contents: rows.map((r) => ({ ...r, deadline: r.scheduled_at ? (approvalDeadline(r.scheduled_at, st.approval_hour)) : null })) };
}

export async function getContent(u: SessionUser, id: string) {
  await assertSpace(u, 'marketing');
  uuidOr404(id);
  const sql = db();
  const [c] = await sql<any[]>`select c.*, b.name as brand from mkt_contents c left join mkt_brands b on b.id = c.brand_id where c.id = ${id} and c.tenant = ${tenantOf(u)}`;
  if (!c) throw notFound('콘텐츠를 찾을 수 없습니다');
  const versions = await sql<any[]>`select v.version, v.body, v.media_ids, v.note, v.created_at, u.name as created_by_name from mkt_versions v left join users u on u.id = v.created_by where v.content_id = ${id} order by v.version desc`;
  const ids = [...new Set(versions.flatMap((v) => v.media_ids as string[]))];
  const media = ids.length ? await sql`select id, title, file_name, mime_type from library_files where id = any(${ids}::uuid[]) and tenant = ${tenantOf(u)} and deleted_at is null` : [];
  const publishJobs = await sql`select j.provider, j.status, j.version, j.permalink, j.is_test, j.last_error, j.created_at, u.name as requested_by_name from mkt_publish_jobs j left join users u on u.id = j.requested_by where j.content_id = ${id} order by j.created_at desc`;
  const decisions = await sql`select d.version, d.decision, d.comment, d.decided_at, u.name as decided_by_name from mkt_decisions d left join users u on u.id = d.decided_by where d.content_id = ${id} order by d.decided_at desc`;
  const st = await (await import('./mktAuto')).settingsOf(tenantOf(u));
  return { content: { ...c, deadline: approvalDeadline(c.scheduled_at, st.approval_hour) }, versions, media, decisions, publishJobs, canDecide: isAdmin(u) };
}

const versionFields = { body: z.string().max(20000).default(''), mediaIds: z.array(zUuid).max(20).default([]), note: z.string().max(500).optional() };
export const contentInput = z.object({ title: z.string().trim().min(1).max(200), channel: zChannel, brandId: zUuid.nullable().optional(), scheduledAt: z.string().datetime({ offset: true }).nullable().optional(), ...versionFields });
export async function createContent(u: SessionUser, i: z.infer<typeof contentInput>) {
  await assertSpace(u, 'marketing');
  await mediaOk(u, i.mediaIds);
  const sql = db(); const t = tenantOf(u);
  const [br] = i.brandId ? await sql<{ test_mode: boolean }[]>`select test_mode from mkt_brands where id = ${i.brandId} and tenant = ${t}` : [];
  if (i.brandId && !br) throw notFound('브랜드를 찾을 수 없습니다');
  const isTest = !!br?.test_mode; // 시험 모드 브랜드: [시험] 표시·알림은 올린 사람에게만·게시 확인 안 됨
  const title = isTest && !i.title.startsWith('[시험]') ? `[시험] ${i.title}` : i.title;
  return sql.begin(async (tx) => {
    const [c] = await tx<{ id: string }[]>`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, is_test)
      values (${t}, ${i.brandId ?? null}, ${title}, ${i.channel}, ${i.scheduledAt ?? null}, 'pending', 1, ${u.id}, ${isTest}) returning id`;
    await tx`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, ${i.body}, ${i.mediaIds}, ${i.note ?? null}, ${u.id})`;
    const admins = isTest ? [] : await (await import('./mktAuto')).approvers(t);
    await notify(tx, { userIds: admins, type: 'review_requested', title: `승인 대기: ${title}`, body: `${u.name} · ${CHANNELS[i.channel]}`, link: `/s/marketing/approvals?c=${c.id}`, entityType: 'mkt_content', entityId: c.id, actorId: u.id, dedupeKey: `mkt:${c.id}:1` });
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
    const [c] = await tx<any[]>`select id, title, current_version, status, is_test, created_by from mkt_contents where id = ${id} and tenant = ${tenantOf(u)} for update`;
    if (!c) throw notFound('콘텐츠를 찾을 수 없습니다');
    if (c.status === 'published') throw badRequest('이미 게시한 콘텐츠입니다');
    const v = c.current_version + 1;
    await tx`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${id}, ${v}, ${i.body}, ${i.mediaIds}, ${i.note ?? null}, ${u.id})`;
    await tx`update mkt_contents set current_version = ${v}, status = 'pending', updated_at = now() where id = ${id}`;
    const admins = c.is_test ? [c.created_by] : await (await import('./mktAuto')).approvers(tenantOf(u));
    await notify(tx, { userIds: admins, type: 'review_requested', title: `재승인 대기(v${v}): ${c.title}`, body: i.note ?? `${u.name}님이 수정본을 올렸습니다`, link: `/s/marketing/approvals?c=${id}`, entityType: 'mkt_content', entityId: id, actorId: u.id, dedupeKey: `mkt:${id}:${v}` });
    return { version: v };
  });
}

/** 승인함 결정(버전 단위): 보던 버전이 최신이 아니면 거부, 승인은 시안 이미지(자료) 있는 버전만. 버튼 = 승인 · 수정 요청 · 보류(대표 결정 10/17) */
export const decideInput = z.object({ version: z.number().int().min(1), decision: z.enum(['approve', 'changes', 'hold']), comment: z.string().max(2000).optional() });
export async function decide(u: SessionUser, id: string, i: z.infer<typeof decideInput>, ip: string | null) {
  await assertSpace(u, 'marketing');
  uuidOr404(id);
  if (!isAdmin(u)) throw forbidden('승인은 관리자가 합니다');
  if (i.decision !== 'approve' && !i.comment?.trim()) throw badRequest(i.decision === 'changes' ? '무엇을 고칠지 적어 주세요' : '보류 이유를 적어 주세요');
  const sql = db();
  const res = await sql.begin(async (tx) => {
    const [c] = await tx<any[]>`select id, title, current_version, status, created_by, channel from mkt_contents where id = ${id} and tenant = ${tenantOf(u)} for update`;
    if (!c) throw notFound('콘텐츠를 찾을 수 없습니다');
    if (i.version !== c.current_version) throw new HttpError(409, 'stale_version', `최신 버전(v${c.current_version})이 아닙니다 — 새로 고쳐 보고 결정해 주세요`);
    if (c.status === 'published') throw badRequest('이미 게시한 콘텐츠입니다');
    if (i.decision === 'approve' && c.channel !== 'blog') { // 블로그는 글만으로도 승인(사진은 선택)
      const [v] = await tx<{ n: number }[]>`select cardinality(media_ids) as n from mkt_versions where content_id = ${id} and version = ${i.version}`;
      if (!v?.n) throw badRequest('시안 이미지가 없어 승인할 수 없습니다 — 시안을 붙인 뒤 다시');
    }
    const status = { approve: 'approved', changes: 'changes', hold: 'hold' }[i.decision];
    await tx`insert into mkt_decisions (content_id, version, decision, comment, decided_by) values (${id}, ${i.version}, ${i.decision}, ${i.comment ?? null}, ${u.id})`;
    await tx`update mkt_contents set status = ${status}, approved_version = ${i.decision === 'approve' ? i.version : null}, updated_at = now() where id = ${id}`;
    if (c.created_by) await notify(tx, { userIds: [c.created_by], type: 'review_result', title: `${{ approve: '승인', changes: '수정 요청', hold: '보류' }[i.decision]}: ${c.title}`, body: i.comment ?? `v${i.version}`, link: `/s/marketing/approvals?c=${id}`, entityType: 'mkt_content', entityId: id, actorId: u.id, dedupeKey: `mktd:${id}:${i.version}:${i.decision}` });
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
  return { calls: await db()`select c.id, c.phone, c.called_at, c.source, c.status, c.memo, c.task_id, b.name as brand from mkt_calls c left join mkt_brands b on b.id = c.brand_id
    where c.tenant = ${tenantOf(u)} and (${q.status ?? ''} = '' or c.status = ${q.status ?? ''}) order by c.called_at desc limit 200` };
}
export const callInput = z.object({ phone: z.string().trim().min(4).max(30), calledAt: z.string().datetime({ offset: true }).optional(), source: z.string().max(100).optional(), brandId: zUuid.nullable().optional(), memo: z.string().max(1000).optional() });
export async function createCall(u: SessionUser, i: z.infer<typeof callInput>) {
  await assertSpace(u, 'marketing');
  const [c] = await db()`insert into mkt_calls (tenant, brand_id, phone, called_at, source, memo, created_by) values (${tenantOf(u)}, ${i.brandId ?? null}, ${i.phone}, ${i.calledAt ?? new Date().toISOString()}, ${i.source ?? null}, ${i.memo ?? null}, ${u.id}) returning id`;
  return { id: c.id };
}
export const callUpdateInput = z.object({ status: z.enum(['new', 'excluded']).optional(), memo: z.string().max(1000).optional() });
export async function updateCall(u: SessionUser, id: string, i: z.infer<typeof callUpdateInput>) {
  await assertSpace(u, 'marketing');
  uuidOr404(id);
  const [c] = await db()`update mkt_calls set status = coalesce(${i.status ?? null}, status), memo = coalesce(${i.memo ?? null}, memo) where id = ${id} and tenant = ${tenantOf(u)} returning id`;
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
  const r = await createTask(u, { title: `[전화 문의] ${c.phone}${c.brand ? ` · ${c.brand}` : ''}`, description: [`전화 시각: ${new Date(c.called_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`, c.source ? `들어온 곳: ${c.source}` : '', c.memo ?? ''].filter(Boolean).join('\n'),
    assigneeId: i.assigneeId ?? u.id, requestedById: u.id, approvalRequired: false } as never);
  await sql`update mkt_calls set status = 'lead', task_id = ${(r as any).id} where id = ${id}`;
  return { taskId: (r as any).id };
}

// ---------------- V41 4-2 마케팅 AI 비서: 캡션·해시태그 초안(게시는 승인 대기를 거쳐 사람이) ----------------
export const captionInput = z.object({ channel: zChannel, topic: z.string().trim().min(2, '무엇을 알릴지 적어 주세요').max(1000), brandId: zUuid.nullable().optional(), tone: z.string().max(40).optional() });
const CAPTION_LEN: Record<string, string> = { instagram: '3~6줄, 첫 줄은 눈길을 끄는 한 문장', facebook: '3~5문장', blog: '제목 1줄 + 본문 8~12문장', youtube: '제목 1줄 + 설명 3~5줄', naver_place: '소식 2~4문장', other: '3~5문장' };
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
