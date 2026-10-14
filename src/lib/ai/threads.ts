import { z } from 'zod';
import { db, type Sql } from '../db';
import { HttpError, badRequest, notFound } from '../errors';
import { audit } from '../log';
import type { SessionUser } from '../types';

/**
 * V14 2·5·6번 AI 비서 대화 보관.
 * - 대화(ai_threads)·메시지(ai_messages)는 본인 화면에서 이어 보기. 회사 관리자 열람은 메뉴 권한 "AI 사용 내역"(기본 대표만).
 * - 문맥은 최근 20개 + 앞부분 요약만 보낸다. 보관 기간 지나면 정기 실행이 지운다(기본 90일, 0 = 무기한).
 * - 업무와 무관한 질문·하루 한도·긴 입력·같은 질문 반복은 비싼 모델 호출 전에 막고 "차단됨"으로 남긴다.
 */
import { tenantOf } from '../types';
export type AiSettings = { retention_days: number; daily_limit: number; input_max: number; topic_filter: boolean; console_note: string | null };
export async function aiSettings(tenant: string, sql: Sql = db()): Promise<AiSettings> {
  const [s] = await sql<AiSettings[]>`select retention_days, daily_limit, input_max, topic_filter, console_note from ai_settings where tenant = ${tenant}`;
  return s ?? { retention_days: 90, daily_limit: Number(process.env.AI_DAILY_LIMIT) || 50, input_max: 4000, topic_filter: process.env.AI_TOPIC_FILTER !== '0', console_note: null };
}

/** 대화 하나 열기(본인 것만). 없으면 404 */
export async function ownThread(u: SessionUser, id: string, sql: Sql = db()) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound('대화가 없습니다');
  const [t] = await sql<{ id: string; title: string; task_id: string | null; summary: string | null; summarized_upto: string; pinned: boolean }[]>`
    select id, title, task_id, summary, summarized_upto::text, pinned from ai_threads where id = ${id} and user_id = ${u.id} and tenant = ${tenantOf(u)} and deleted_at is null`;
  if (!t) throw notFound('대화가 없습니다');
  return t;
}
export async function startThread(u: SessionUser, firstText: string, taskId: string | null, sql: Sql = db(), ctx?: { page: string; id?: string }) {
  const title = firstText.replace(/\s+/g, ' ').trim().slice(0, 40) || '새 대화';
  const [t] = await sql<{ id: string }[]>`insert into ai_threads (tenant, user_id, title, task_id, context_page, context_id)
    values (${tenantOf(u)}, ${u.id}, ${title}, ${taskId}, ${taskId ? 'task' : ctx?.page ?? null}, ${ctx?.id ?? null}) returning id`;
  return t.id;
}
/** 문맥: 앞부분 요약 + 최근 20개(차단·오류 제외). 제안은 처리 결과와 함께 */
export async function threadHistory(threadId: string, sql: Sql = db()) {
  const rows = await sql<{ id: string; role: 'user' | 'assistant'; text: string; proposal_ids: string[]; file_ids: string[] | null; file_names: string[] | null }[]>`
    select id::text, role, text, proposal_ids, file_ids, file_names from ai_messages where thread_id = ${threadId} and status = 'ok' order by id desc limit 20`;
  rows.reverse();
  const pids = rows.flatMap((r) => r.proposal_ids);
  const props = pids.length ? await sql<{ id: string; summary: string; status: string }[]>`select id, summary, status from ai_proposals where id = any(${pids}::uuid[])` : [];
  // 앞선 질문의 첨부 id — "아까 올린 사진 자료실에 정리해줘" 처럼 나중에 가리킬 수 있게
  const files = (r: (typeof rows)[number]) => (r.file_ids?.length ? `\n[첨부: ${r.file_ids.map((id, k) => `id=${id} · ${r.file_names?.[k] ?? ''}`).join(' / ')}]` : '');
  const msgs = rows.map((r) => ({ role: r.role, text: r.text + files(r) + (r.proposal_ids.length ? `\n(제안: ${r.proposal_ids.map((p) => props.find((x) => x.id === p)).filter(Boolean).map((p) => `${p!.summary} [${p!.status === 'done' ? '실행됨' : p!.status === 'cancelled' ? '취소됨' : '대기'}]`).join('; ')})` : '') }));
  // 처음은 user 여야 한다
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  const [t] = await sql<{ summary: string | null }[]>`select summary from ai_threads where id = ${threadId}`;
  return { messages: msgs, summary: t?.summary ?? null, oldestId: rows[0]?.id ?? null };
}
/** 20개보다 오래된 메시지가 10개 이상 쌓이면 가벼운 모델로 요약해 둔다(실패해도 대화는 계속) */
export async function maybeSummarize(u: SessionUser, threadId: string) {
  const sql = db();
  const [t] = await sql<{ summary: string | null; upto: string }[]>`select summary, summarized_upto::text upto from ai_threads where id = ${threadId}`;
  const keep = await sql<{ id: string }[]>`select id::text from ai_messages where thread_id = ${threadId} and status = 'ok' order by id desc limit 1 offset 19`;
  if (!keep[0]) return;
  const old = await sql<{ id: string; role: string; text: string }[]>`select id::text, role, text from ai_messages where thread_id = ${threadId} and status = 'ok'
    and id > ${t.upto}::bigint and id < ${keep[0].id}::bigint order by id`;
  if (old.length < 10) return;
  const { anthropicProvider, costUsd } = await import('./provider');
  const p = anthropicProvider({ tier: 'fast' });
  try {
    const r = await p.chat({ system: '사내 AI 비서 대화의 앞부분을 다음 대화에 쓸 수 있게 한국어 5줄 이내로 요약하세요. 정한 일·업무 이름·날짜·사람을 남기세요.', tools: [],
      messages: [{ role: 'user', content: `${t.summary ? `지난 요약:\n${t.summary}\n\n` : ''}이어진 대화:\n${old.map((m) => `${m.role === 'user' ? '사용자' : 'AI'}: ${m.text.slice(0, 1500)}`).join('\n')}` }] });
    const text = r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim().slice(0, 3000);
    await sql`update ai_threads set summary = ${text}, summarized_upto = ${old[old.length - 1].id}::bigint where id = ${threadId}`;
    await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
      values (${tenantOf(u)}, ${u.id}, ${crypto.randomUUID()}, ${p.name}, ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, ${r.usage.cache_read_input_tokens ?? 0},
        ${r.usage.cache_creation_input_tokens ?? 0}, ${costUsd(r.model ?? p.model, r.usage)}, 'summary')`;
  } catch { /* 요약 실패는 무시 — 최근 20개로 계속 */ }
}

/** 사전 점검(비싼 모델 전에): 입력 길이 · 1인 하루 한도 · 같은 질문 반복 · 업무 무관 질문(가벼운 모델 분류). 막히면 이유 */
export async function precheck(u: SessionUser, text: string, threadId: string | null, hasFiles: boolean): Promise<string | null> {
  const sql = db();
  const s = await aiSettings(tenantOf(u), sql);
  if (text.length > s.input_max) throw badRequest(`한 번에 ${s.input_max.toLocaleString('ko-KR')}자까지 보낼 수 있습니다 (지금 ${text.length.toLocaleString('ko-KR')}자). 나눠서 요청하거나 자료로 첨부해 주세요.`);
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from ai_messages m join ai_threads t on t.id = m.thread_id
    where t.user_id = ${u.id} and m.role = 'user' and m.created_at >= (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')`;
  if (n >= s.daily_limit) return `오늘 AI 요청 ${s.daily_limit}회를 모두 썼습니다. 내일 다시 이용해 주세요.`;
  if (threadId) {
    const [last] = await sql<{ text: string; at: Date }[]>`select text, created_at at from ai_messages where thread_id = ${threadId} and role = 'user' order by id desc limit 1`;
    if (last && last.text.trim() === text.trim() && Date.now() - new Date(last.at).getTime() < 2 * 60_000 && !hasFiles) return '방금 같은 질문을 하셨어요. 위의 답을 확인해 주세요.';
  }
  if (!s.topic_filter || hasFiles || text.trim().length < 8) return null; // 자료를 붙인 요청·짧은 말은 업무로 본다
  const { anthropicProvider, costUsd } = await import('./provider');
  const p = anthropicProvider({ tier: 'fast' });
  try {
    const r = await p.chat({ system: 'WORKIN_TOPIC_CLASSIFIER: 사내 업무 도구의 AI 비서에 들어온 요청이 회사 업무(업무·일정·회의·자료실·매출·보고·고객 응대·회사 문서 작성/요약/번역 등)와 관련 있는지 판정하세요. 일반 잡담·숙제·코딩 과제·연예·게임·개인 상담·시사 토론은 무관.',
      tools: [], format: { type: 'object', additionalProperties: false, required: ['work'], properties: { work: { type: 'boolean' } } },
      messages: [{ role: 'user', content: text.slice(0, 600) }] });
    await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
      values (${tenantOf(u)}, ${u.id}, ${crypto.randomUUID()}, ${p.name}, ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, ${r.usage.cache_read_input_tokens ?? 0},
        ${r.usage.cache_creation_input_tokens ?? 0}, ${costUsd(r.model ?? p.model, r.usage)}, 'classify')`;
    const j = JSON.parse(/\{[\s\S]*\}/.exec(r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(''))?.[0] ?? '{"work":true}');
    return j.work === false ? '업무와 관련된 요청만 도와드려요. 업무·일정·자료·보고에 대해 물어봐 주세요.' : null;
  } catch { return null; } // 분류 실패는 막지 않는다
}

export async function saveTurn(u: SessionUser, threadId: string, user: { text: string; fileIds?: string[]; fileNames?: string[] },
  reply: { text: string; proposalIds?: string[]; status?: 'ok' | 'blocked' | 'error'; reason?: string | null; cost?: number; inTok?: number; outTok?: number }) {
  const sql = db();
  const st = reply.status ?? 'ok';
  await sql`insert into ai_messages (thread_id, role, text, file_ids, file_names, status, block_reason) values (${threadId}, 'user', ${user.text}, ${user.fileIds ?? []}, ${user.fileNames ?? []}, ${st}, ${reply.reason ?? null})`;
  await sql`insert into ai_messages (thread_id, role, text, proposal_ids, status, input_tokens, output_tokens, cost_usd)
    values (${threadId}, 'assistant', ${reply.text}, ${reply.proposalIds ?? []}, ${st}, ${reply.inTok ?? 0}, ${reply.outTok ?? 0}, ${reply.cost ?? 0})`;
  await sql`update ai_threads set updated_at = now(), cost_usd = cost_usd + ${reply.cost ?? 0} where id = ${threadId}`;
}

// ---------------- 내 대화 목록·열기·이름/고정·삭제 ----------------
export async function listThreads(u: SessionUser, q: { q?: string; taskId?: string }) {
  const sql = db();
  const like = q.q ? '%' + q.q.replace(/[%_\\]/g, (c) => '\\' + c) + '%' : null;
  const conf = (await menuLevelOf(u)) !== 'none'; // 기밀 대화는 기밀 권한자에게만 제목·검색
  const threads = await sql`select t.id, case when t.confidential and not ${conf} then '기밀 자료 대화' else t.title end as title, t.confidential, t.task_id, tk.title as task_title, t.pinned, t.updated_at, t.context_page, t.context_id,
      (select count(*)::int from ai_messages m where m.thread_id = t.id and m.role = 'user') as turns
    from ai_threads t left join tasks tk on tk.id = t.task_id
    where t.user_id = ${u.id} and t.tenant = ${tenantOf(u)} and t.deleted_at is null
      ${q.taskId ? sql`and t.task_id = ${q.taskId}` : sql``}
      ${like ? sql`and (t.title ilike ${like} or exists (select 1 from ai_messages m where m.thread_id = t.id and m.text ilike ${like}))` : sql``}
    order by t.pinned desc, t.updated_at desc limit 100`;
  return { threads };
}
export async function threadMessages(threadId: string, sql: Sql = db()) {
  const msgs = await sql`select m.id::text, m.role, m.text, m.file_names, m.status, m.block_reason, m.cost_usd::float8 cost_usd, m.created_at,
      coalesce((select json_agg(json_build_object('id', p.id, 'kind', p.kind, 'summary', p.summary, 'status', p.status, 'result', p.result) order by p.created_at)
        from ai_proposals p where p.id = any(m.proposal_ids)), '[]') as proposals
    from ai_messages m where m.thread_id = ${threadId} order by m.id`;
  return msgs;
}
export async function getThread(u: SessionUser, id: string) {
  const sql = db();
  const t = await ownThread(u, id, sql);
  return { thread: t, messages: await threadMessages(id, sql) };
}
export const threadPatch = z.object({ title: z.string().trim().min(1).max(80).optional(), pinned: z.boolean().optional() });
export async function patchThread(u: SessionUser, id: string, i: z.infer<typeof threadPatch>) {
  const sql = db();
  const t = await ownThread(u, id, sql);
  await sql`update ai_threads set title = ${i.title ?? t.title}, pinned = ${i.pinned ?? t.pinned} where id = ${id}`;
  return { ok: true };
}
export async function deleteThread(u: SessionUser, id: string) {
  const sql = db();
  await ownThread(u, id, sql);
  await sql`update ai_threads set deleted_at = now() where id = ${id}`;
  return { ok: true };
}

// ---------------- V14 6번 회사 "AI 사용 내역" (메뉴 권한: 조회 / 편집) ----------------
export async function logList(u: SessionUser, q: { userId?: string; q?: string }) {
  const { requireMenu } = await import('../menuPerms');
  await requireMenu(u, 'ai_logs', 'view');
  const sql = db();
  const like = q.q ? '%' + q.q.replace(/[%_\\]/g, (c) => '\\' + c) + '%' : null;
  const conf = (await menuLevelOf(u)) !== 'none'; // 기밀 대화는 기밀 권한자에게만 제목·검색
  const threads = await sql`select t.id, case when t.confidential and not ${conf} then '기밀 자료 대화' else t.title end as title, t.confidential, t.user_id, us.name as user_name, t.task_id, t.updated_at, t.created_at, t.cost_usd::float8 cost_usd, (t.deleted_at is not null) as deleted_by_user,
      (select count(*)::int from ai_messages m where m.thread_id = t.id and m.role = 'user') as turns,
      (select count(*)::int from ai_messages m where m.thread_id = t.id and m.role = 'user' and m.status = 'blocked') as blocked
    from ai_threads t join users us on us.id = t.user_id
    where t.tenant = ${tenantOf(u)} ${q.userId ? sql`and t.user_id = ${q.userId}` : sql``}
      ${like ? sql`and (not t.confidential or ${conf}) and (t.title ilike ${like} or exists (select 1 from ai_messages m where m.thread_id = t.id and m.text ilike ${like}))` : sql``}
    order by t.updated_at desc limit 200`;
  return { threads, settings: await aiSettings(tenantOf(u), sql) };
}
export async function logThread(u: SessionUser, id: string, ip: string | null) {
  const { requireMenu } = await import('../menuPerms');
  await requireMenu(u, 'ai_logs', 'view');
  const sql = db();
  const [t] = await sql`select t.id, t.title, t.user_id, us.name as user_name, t.task_id, t.created_at, t.confidential from ai_threads t join users us on us.id = t.user_id where t.id = ${id} and t.tenant = ${tenantOf(u)}`;
  if (!t) throw notFound('대화가 없습니다');
  await audit(sql, u.id, 'ai_log.view', 'ai_thread', id, { owner: t.user_id }, ip); // 누가 남의 대화를 봤는지 남긴다
  const msgs = await threadMessages(id, sql);
  // V14 15번: 기밀 자료를 근거로 한 대화는 기밀 열람 권한자만 내용을 본다
  if (t.confidential && t.user_id !== u.id && (await menuLevelOf(u)) === 'none')
    return { thread: { ...t, title: '기밀 자료 대화' }, redacted: true, messages: msgs.map((m: any) => ({ ...m, text: m.role === 'user' ? '(기밀 자료 대화 — 열람 권한 필요)' : '(기밀 자료 — 열람 권한 필요)', file_names: [], proposals: [] })) };
  return { thread: t, messages: msgs };
}
export async function logDelete(u: SessionUser, id: string, ip: string | null) {
  const { requireMenu } = await import('../menuPerms');
  await requireMenu(u, 'ai_logs', 'edit');
  const sql = db();
  const r = await sql`delete from ai_threads where id = ${id} and tenant = ${tenantOf(u)} returning user_id`;
  if (!r.length) throw notFound('대화가 없습니다');
  await audit(sql, u.id, 'ai_log.delete', 'ai_thread', id, { owner: r[0].user_id }, ip);
  return { ok: true };
}
export const aiSettingsInput = z.object({ retentionDays: z.number().int().min(0).max(3650).optional(), dailyLimit: z.number().int().min(1).max(1000).optional(),
  inputMax: z.number().int().min(200).max(20000).optional(), topicFilter: z.boolean().optional(), consoleNote: z.string().max(500).nullable().optional() });
export async function setAiSettings(u: SessionUser, i: z.infer<typeof aiSettingsInput>, ip: string | null) {
  const { requireMenu } = await import('../menuPerms');
  await requireMenu(u, 'ai_logs', 'edit');
  if (i.consoleNote !== undefined && u.role !== 'owner') throw new HttpError(403, 'forbidden', '잔액 메모는 대표만 적습니다');
  const sql = db(); const t = tenantOf(u);
  const cur = await aiSettings(t, sql);
  const next = { retention_days: i.retentionDays ?? cur.retention_days, daily_limit: i.dailyLimit ?? cur.daily_limit, input_max: i.inputMax ?? cur.input_max,
    topic_filter: i.topicFilter ?? cur.topic_filter, console_note: i.consoleNote !== undefined ? i.consoleNote : cur.console_note };
  await sql`insert into ai_settings (tenant, retention_days, daily_limit, input_max, topic_filter, console_note, updated_by)
    values (${t}, ${next.retention_days}, ${next.daily_limit}, ${next.input_max}, ${next.topic_filter}, ${next.console_note}, ${u.id})
    on conflict (tenant) do update set retention_days = excluded.retention_days, daily_limit = excluded.daily_limit, input_max = excluded.input_max,
      topic_filter = excluded.topic_filter, console_note = excluded.console_note, updated_by = excluded.updated_by, updated_at = now()`;
  await audit(sql, u.id, 'ai.settings', null, null, next, ip);
  return { ok: true, settings: next };
}
/** 정기 실행: 보관 기간이 지난 대화 삭제 */
export async function purgeOldThreads() {
  const r = await db()`delete from ai_threads t where t.updated_at < now() - make_interval(days => coalesce((select s.retention_days from ai_settings s where s.tenant = t.tenant), 90))
    and coalesce((select s.retention_days from ai_settings s where s.tenant = t.tenant), 90) > 0 returning id`;
  return r.length;
}

const menuLevelOf = async (u: SessionUser) => (await import('../menuPerms')).menuLevel(u, 'confidential');
