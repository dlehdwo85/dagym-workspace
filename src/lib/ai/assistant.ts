import { z } from 'zod';
import { DateTime } from 'luxon';
import { db } from '../db';
import { HttpError, badRequest, notFound } from '../errors';
import { audit } from '../log';
import { isAdmin, denyDemo } from '../access';
import { todaySeoul } from '../time';
import { listTasks, listQuery, getTaskDetail, createTask, updateTask, addComment, taskInput } from '../tasks';
import { listEvents } from '../events';
import { canSeeRevenue } from '../revenue';
import { directory } from '../admin';
import { listLibrary, loadLibraryFile, attachLibraryToTask, saveGeneratedFile, tenantOf } from '../library';
import { writeXlsx } from '../xlsx';
import { anthropicProvider, aiEnabled, costUsd, type AiMessage, type AiProvider, type AiTool } from './provider';
import type { SessionUser } from '../types';

/**
 * V9 워크인 AI 비서. 요청한 사람의 권한으로만 데이터를 읽고(서버 함수 재사용 — 권한 검사 그대로),
 * 쓰기(업무 만들기·고치기·댓글·첨부·보고서)는 "AI 제안"으로만 만들고 사람이 [확인]해야 실행한다.
 */
const TZ = 'Asia/Seoul';
const MAX_STEPS = 8;

export function defaultBudget() {
  const n = Number(process.env.AI_MONTHLY_BUDGET_USD);
  return Number.isFinite(n) && n > 0 ? n : 30;
}
export async function usageThisMonth(tenant: string) {
  const sql = db();
  const start = DateTime.now().setZone(TZ).startOf('month').toJSDate();
  const [[u], [l]] = await Promise.all([
    sql<{ cost: number; requests: number; tokens: number }[]>`select coalesce(sum(cost_usd), 0)::float8 cost, count(*)::int requests,
      coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0)::float8 tokens from ai_usage where tenant = ${tenant} and created_at >= ${start}`,
    sql<{ monthly_usd: number }[]>`select monthly_usd::float8 monthly_usd from ai_limits where tenant = ${tenant}`,
  ]);
  return { costUsd: Math.round(u.cost * 10000) / 10000, requests: u.requests, tokens: u.tokens, limitUsd: l?.monthly_usd ?? defaultBudget() };
}

export async function aiStatus(u: SessionUser) {
  const enabled = aiEnabled() && !u.isDemo;
  if (!enabled) return { enabled: false };
  const usage = await usageThisMonth(tenantOf(u));
  return { enabled: true, model: process.env.AI_MODEL || 'claude-opus-5-5', usage: isAdmin(u) ? usage : { ...usage, costUsd: undefined, tokens: undefined }, overLimit: usage.costUsd >= usage.limitUsd, canSetLimit: u.role === 'owner' };
}
export async function setLimit(u: SessionUser, monthlyUsd: number) {
  if (u.role !== 'owner') throw new HttpError(403, 'forbidden', '대표만 바꿀 수 있습니다');
  const sql = db();
  await sql`insert into ai_limits (tenant, monthly_usd, updated_by) values (${tenantOf(u)}, ${monthlyUsd}, ${u.id})
    on conflict (tenant) do update set monthly_usd = excluded.monthly_usd, updated_by = excluded.updated_by, updated_at = now()`;
  await audit(sql, u.id, 'ai.limit', null, null, { monthlyUsd }, null);
  return { ok: true };
}

// ---------------- 도구 ----------------
const str = (d: string) => ({ type: 'string' as const, description: d });
const TOOLS: AiTool[] = [
  { name: 'search_library', description: '회사 자료실(로고·소개서·단가표·보고서 등)에서 제목·폴더·태그·본문으로 자료를 찾는다. 결과의 id 로 읽거나 업무에 첨부할 수 있다.',
    input_schema: { type: 'object', properties: { query: str('찾을 말 (예: "다짐 로고", "단가표")'), folder: str('폴더로 좁히기 (선택)') }, required: ['query'] } },
  { name: 'read_library_file', description: '자료실 파일의 본문 글자를 읽는다(문서·엑셀·텍스트). 이미지·PDF 는 본문이 없을 수 있다.',
    input_schema: { type: 'object', properties: { fileId: str('자료 id') }, required: ['fileId'] } },
  { name: 'search_tasks', description: '사용자가 볼 수 있는 업무를 찾는다.',
    input_schema: { type: 'object', properties: {
      query: str('제목 검색어 (선택)'),
      view: { type: 'string', enum: ['all', 'my', 'today', 'overdue', 'week', 'review', 'requested', 'done'], description: 'my=내 담당, requested=내가 지시한 업무, done=완료' },
      assigneeId: str('담당자 id (선택)'), from: str('마감일 시작 YYYY-MM-DD (선택)'), to: str('마감일 끝 YYYY-MM-DD (선택)'),
    } } },
  { name: 'get_task', description: '업무 하나의 상세(설명·체크리스트·댓글·첨부 이름)를 본다.',
    input_schema: { type: 'object', properties: { taskId: str('업무 id') }, required: ['taskId'] } },
  { name: 'list_events', description: '사용자가 볼 수 있는 캘린더 일정을 기간으로 본다 (최대 62일).',
    input_schema: { type: 'object', properties: { from: str('YYYY-MM-DD'), to: str('YYYY-MM-DD (포함)') }, required: ['from', 'to'] } },
  { name: 'list_people', description: '업무를 배정할 수 있는 사람과 조직(현장·부서) 목록. 사람 이름을 id 로 바꿀 때 쓴다.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'revenue_summary', description: '현장별 월 매출·지출·회원 수 (대표·본사만). 다른 사람은 권한 없음.',
    input_schema: { type: 'object', properties: { fromMonth: str('YYYY-MM'), toMonth: str('YYYY-MM') }, required: ['fromMonth', 'toMonth'] } },
  { name: 'propose_create_task', description: '업무 만들기를 제안한다. 사용자가 화면에서 [확인]해야 만들어진다.',
    input_schema: { type: 'object', properties: {
      title: str('제목'), description: str('설명 (선택)'), assigneeId: str('담당자 id (선택)'), dueDate: str('마감일 YYYY-MM-DD (선택)'), dueTime: str('마감 시각 HH:MM (선택)'),
      priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] }, projectId: str('프로젝트 id (선택)'), orgUnitId: str('조직 id (선택)'),
      checklist: { type: 'array', items: { type: 'string' }, description: '체크리스트 (선택)' },
    }, required: ['title'] } },
  { name: 'propose_update_task', description: '업무 고치기(상태·마감·담당·우선순위·제목)를 제안한다. [확인] 후 실행.',
    input_schema: { type: 'object', properties: {
      taskId: str('업무 id'), title: str('새 제목'), status: { type: 'string', enum: ['todo', 'in_progress', 'review', 'on_hold', 'done'] },
      dueDate: str('YYYY-MM-DD'), dueTime: str('HH:MM'), assigneeId: str('담당자 id'), priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
    }, required: ['taskId'] } },
  { name: 'propose_comment', description: '업무에 댓글 달기를 제안한다. [확인] 후 실행.',
    input_schema: { type: 'object', properties: { taskId: str('업무 id'), text: str('댓글 내용') }, required: ['taskId', 'text'] } },
  { name: 'propose_attach_file', description: '자료실 파일을 업무에 첨부하기를 제안한다. [확인] 후 실행.',
    input_schema: { type: 'object', properties: { taskId: str('업무 id'), fileId: str('자료 id') }, required: ['taskId', 'fileId'] } },
  { name: 'propose_xlsx_report', description: '표를 엑셀(.xlsx)로 만들어 자료실 "AI 보고서" 폴더에 저장(업무 id 가 있으면 그 업무에도 첨부)하기를 제안한다. 숫자는 도구로 확인한 값만 넣는다.',
    input_schema: { type: 'object', properties: {
      title: str('파일 제목'), taskId: str('첨부할 업무 id (선택)'),
      sheets: { type: 'array', items: { type: 'object', properties: { name: str('시트 이름'), rows: { type: 'array', items: { type: 'array', items: { type: ['string', 'number', 'null'] } }, description: '첫 줄은 머리글' } }, required: ['name', 'rows'] } },
    }, required: ['title', 'sheets'] } },
];

const SYSTEM = `당신은 사내 업무·일정 서비스 "워크인"의 AI 비서입니다. 한국 피트니스 회사(다짐·하이링크) 직원을 돕습니다.
- 사실(업무·일정·자료·매출)은 반드시 도구로 확인하고 답하세요. 도구 결과에 없는 숫자·이름·날짜를 지어내지 마세요.
- 데이터를 바꾸는 일(업무 만들기·고치기·댓글·첨부·엑셀 보고서)은 propose_* 도구로만 제안하세요. 제안은 사용자가 화면의 [확인] 버튼을 눌러야 실행됩니다. 실행됐다고 말하지 말고 "확인을 누르면 반영됩니다"라고 안내하세요.
- 사람 이름은 list_people 로 id 를 찾아 쓰세요. 날짜는 Asia/Seoul 기준입니다.
- 권한 오류가 나면 그 사람이 볼 수 없는 정보라고 짧게 알려 주세요.
- 답은 한국어로 짧고 분명하게. 목록은 짧은 줄로.`;

type Ctx = { u: SessionUser; proposals: { id: string; kind: string; summary: string }[] };
const clip = (s: unknown, n = 400) => (typeof s === 'string' ? (s.length > n ? s.slice(0, n) + '…' : s) : s);
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

async function propose(c: Ctx, kind: string, summary: string, payload: unknown) {
  const [p] = await db()<{ id: string }[]>`insert into ai_proposals (tenant, user_id, kind, summary, payload) values (${tenantOf(c.u)}, ${c.u.id}, ${kind}, ${summary}, ${db().json(payload as never)}) returning id`;
  c.proposals.push({ id: p.id, kind, summary });
  return { proposalId: p.id, status: '사용자 확인 대기 — 화면의 [확인]을 눌러야 실행됩니다' };
}

async function runTool(c: Ctx, name: string, input: any): Promise<unknown> {
  const u = c.u;
  switch (name) {
    case 'search_library': {
      const r = await listLibrary(u, { q: String(input.query ?? ''), folder: input.folder, limit: 10 });
      return r.files.map((f: any) => ({ id: f.id, title: f.title, folder: f.folder, tags: f.tags, fileName: f.file_name, type: f.mime_type, snippet: clip(f.snippet, 200) }));
    }
    case 'read_library_file': {
      const f = await loadLibraryFile(u, String(input.fileId));
      return { title: f.title, fileName: f.file_name, text: f.text_content ? clip(f.text_content, 30000) : '(본문 글자 없음 — 이미지·PDF 등은 제목·태그로만 알 수 있습니다)' };
    }
    case 'search_tasks': {
      const q = listQuery.parse({ view: input.view ?? 'all', q: input.query || undefined, assigneeId: input.assigneeId || undefined,
        from: isDate(input.from) ? input.from : undefined, to: isDate(input.to) ? input.to : undefined, limit: 40, includeDone: input.view === 'done' ? '1' : undefined });
      const rows = await listTasks(u, q);
      return rows.slice(0, 40).map((t: any) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, due: t.due_date ? `${t.due_date}${t.due_time ? ' ' + String(t.due_time).slice(0, 5) : ''}` : null,
        assignee: t.assignee_name ?? null, project: t.project_name ?? null }));
    }
    case 'get_task': {
      const d = await getTaskDetail(u, String(input.taskId));
      const t: any = d.task;
      return { id: t.id, title: t.title, status: t.status, priority: t.priority, due: t.due_date, dueTime: t.due_time, assignee: t.assignee_name, requestedBy: t.requested_by_name,
        project: t.project_name, description: clip(t.description, 4000), checklist: d.checklist.map((x: any) => `${x.done ? '☑' : '☐'} ${x.text}`),
        comments: d.comments.slice(-15).map((x: any) => `${x.author_name}: ${clip(String(x.body).replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/g, '@$1'), 300)}`),
        attachments: d.attachments.map((a: any) => a.doc_title ?? a.file_name) };
    }
    case 'list_events': {
      if (!isDate(input.from) || !isDate(input.to)) throw badRequest('날짜는 YYYY-MM-DD');
      const from = DateTime.fromISO(input.from, { zone: TZ }), to = DateTime.fromISO(input.to, { zone: TZ }).plus({ days: 1 });
      if (to.diff(from, 'days').days > 62) throw badRequest('최대 62일');
      const evs = await listEvents(u, from.toJSDate(), to.toJSDate());
      return evs.slice(0, 100).map((e: any) => ({ id: e.id, title: e.title, start: DateTime.fromJSDate(new Date(e.start)).setZone(TZ).toFormat(e.allDay ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm'),
        end: e.allDay ? null : DateTime.fromJSDate(new Date(e.end)).setZone(TZ).toFormat('HH:mm'), allDay: e.allDay, calendar: e.calendarName ?? undefined }));
    }
    case 'list_people': {
      const d = await directory(u);
      return { people: d.users.map((x: any) => ({ id: x.id, name: x.name, title: x.title, role: x.role })), orgUnits: d.orgUnits.filter((o: any) => o.active).map((o: any) => ({ id: o.id, name: o.name, type: o.type })) };
    }
    case 'revenue_summary': {
      if (!(await canSeeRevenue(u))) throw new HttpError(403, 'forbidden', '매출은 대표·본사만 볼 수 있습니다');
      const ok = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
      if (!ok(input.fromMonth) || !ok(input.toMonth)) throw badRequest('YYYY-MM 형식');
      const rows = await db()`select o.name as site, to_char(r.month, 'YYYY-MM') as month, r.revenue::float8 revenue, r.expense::float8 expense, r.members, r.target::float8 target
        from revenue_entries r join org_units o on o.id = r.org_unit_id where not o.is_demo and r.month between ${input.fromMonth + '-01'} and ${input.toMonth + '-01'} order by o.name, r.month limit 600`;
      return { unit: '원(회원 수는 명)', rows };
    }
    case 'propose_create_task': {
      const i = taskInput.parse({ title: input.title, description: input.description || undefined, assigneeId: input.assigneeId || undefined, dueDate: isDate(input.dueDate) ? input.dueDate : undefined,
        dueTime: /^\d{2}:\d{2}$/.test(input.dueTime ?? '') ? input.dueTime : undefined, priority: input.priority || undefined, projectId: input.projectId || undefined,
        orgUnitId: input.orgUnitId || undefined, checklist: Array.isArray(input.checklist) ? input.checklist.slice(0, 50) : undefined });
      return propose(c, 'create_task', `업무 만들기: ${i.title}${i.dueDate ? ` (마감 ${i.dueDate}${i.dueTime ? ' ' + i.dueTime : ''})` : ''}`, i);
    }
    case 'propose_update_task': {
      const d = await getTaskDetail(u, String(input.taskId));
      const patch = taskInput.partial().parse({ title: input.title || undefined, status: input.status || undefined, dueDate: isDate(input.dueDate) ? input.dueDate : undefined,
        dueTime: /^\d{2}:\d{2}$/.test(input.dueTime ?? '') ? input.dueTime : undefined, assigneeId: input.assigneeId || undefined, priority: input.priority || undefined });
      if (!Object.values(patch).some((v) => v !== undefined)) throw badRequest('바꿀 내용이 없습니다');
      return propose(c, 'update_task', `업무 고치기: ${(d.task as any).title} — ${Object.entries(patch).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join(', ')}`, { taskId: input.taskId, patch });
    }
    case 'propose_comment': {
      const d = await getTaskDetail(u, String(input.taskId));
      const text = String(input.text ?? '').trim().slice(0, 5000);
      if (!text) throw badRequest('내용이 없습니다');
      return propose(c, 'comment', `댓글: ${(d.task as any).title} — ${clip(text, 80)}`, { taskId: input.taskId, text });
    }
    case 'propose_attach_file': {
      const [d, f] = await Promise.all([getTaskDetail(u, String(input.taskId)), loadLibraryFile(u, String(input.fileId))]);
      return propose(c, 'attach_file', `첨부: ${f.title} → ${(d.task as any).title}`, { taskId: input.taskId, fileId: input.fileId, fileTitle: f.title, mime: f.mime_type });
    }
    case 'propose_xlsx_report': {
      const sheets = z.array(z.object({ name: z.string().max(31), rows: z.array(z.array(z.union([z.string().max(5000), z.number(), z.null()])).max(200)).max(5000) })).min(1).max(10).parse(input.sheets);
      const title = String(input.title ?? 'AI 보고서').slice(0, 100);
      if (input.taskId) await getTaskDetail(u, String(input.taskId));
      return propose(c, 'xlsx_report', `엑셀 보고서 만들기: ${title} (${sheets.length}개 시트, ${sheets.reduce((n, s) => n + s.rows.length, 0)}줄)${input.taskId ? ' + 업무 첨부' : ''}`, { title, taskId: input.taskId || null, sheets });
    }
  }
  throw badRequest(`모르는 도구: ${name}`);
}

const chatInput = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(8000) })).min(1).max(30),
  taskId: z.string().uuid().optional(),
});
export { chatInput };

export async function chat(u: SessionUser, i: z.infer<typeof chatInput>, provider: AiProvider = anthropicProvider()) {
  denyDemo(u);
  if (!aiEnabled()) throw notFound();
  const tenant = tenantOf(u);
  const usage = await usageThisMonth(tenant);
  if (usage.costUsd >= usage.limitUsd) throw new HttpError(429, 'ai_limit', `이번 달 AI 사용 한도($${usage.limitUsd})에 도달했습니다. 대표에게 한도 조정을 요청하세요.`);
  if (i.messages[i.messages.length - 1].role !== 'user') throw badRequest('마지막은 질문이어야 합니다');

  let context = '';
  if (i.taskId) {
    const d = await getTaskDetail(u, i.taskId); // 볼 수 없는 업무면 여기서 404
    context = `\n지금 사용자가 보고 있는 업무: id=${i.taskId}, 제목="${(d.task as any).title}". "이 업무"는 이것을 뜻합니다.`;
  }
  const system = `${SYSTEM}\n\n오늘: ${todaySeoul()} (${DateTime.now().setZone(TZ).toFormat('cccc', { locale: 'ko' })}), 사용자: ${u.name}(id=${u.id}, 역할=${u.role}).${context}`;
  const messages: AiMessage[] = i.messages.map((m) => ({ role: m.role, content: m.text }));
  const c: Ctx = { u, proposals: [] };
  const sql = db();
  const steps: string[] = [];
  let reply = '';
  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await provider.chat({ system, messages, tools: TOOLS }).catch((e: any) => {
      throw new HttpError(502, 'ai_unavailable', `AI 서버 응답 오류${e?.status ? ` (${e.status})` : ''}. 잠시 후 다시 시도하세요.`);
    });
    const used = r.usage;
    await sql`insert into ai_usage (tenant, user_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd)
      values (${tenant}, ${u.id}, ${provider.name}, ${r.model ?? provider.model}, ${used.input_tokens}, ${used.output_tokens}, ${used.cache_read_input_tokens ?? 0},
        ${used.cache_creation_input_tokens ?? 0}, ${costUsd(r.model ?? provider.model, used)})`;
    const text = r.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (r.stop_reason === 'refusal') { reply = '이 요청은 처리할 수 없습니다. 다르게 요청해 주세요.'; break; }
    if (r.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: r.content as never }); continue; }
    if (r.stop_reason !== 'tool_use') { reply = text || (r.stop_reason === 'max_tokens' ? '답이 너무 길어 중간에 끊겼습니다. 범위를 좁혀 다시 요청해 주세요.' : ''); break; }
    messages.push({ role: 'assistant', content: r.content as never });
    const uses = r.content.filter((b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use');
    const results = await Promise.all(uses.map(async (t) => {
      steps.push(t.name);
      try {
        return { type: 'tool_result' as const, tool_use_id: t.id, content: JSON.stringify(await runTool(c, t.name, t.input)) };
      } catch (e: any) {
        const msg = e instanceof HttpError ? (e.status === 404 ? '찾을 수 없거나 볼 권한이 없습니다' : e.message) : e?.issues ? '입력값이 올바르지 않습니다' : '처리 중 오류';
        return { type: 'tool_result' as const, tool_use_id: t.id, content: msg, is_error: true };
      }
    }));
    messages.push({ role: 'user', content: results });
    if (step === MAX_STEPS - 1) reply = text || '여러 단계를 거쳤지만 끝내지 못했습니다. 요청을 나눠서 다시 해 주세요.';
  }
  await audit(sql, u.id, 'ai.chat', i.taskId ? 'task' : null, i.taskId ?? null, { tools: steps, proposals: c.proposals.map((p) => p.id) }, null);
  return { reply, proposals: c.proposals, tools: steps };
}

// ---------------- 제안 실행 (사람이 [확인]) ----------------
export async function decideProposal(u: SessionUser, id: string, accept: boolean) {
  denyDemo(u);
  const sql = db();
  const [p] = await sql<any[]>`select * from ai_proposals where id = ${id} and user_id = ${u.id}`;
  if (!p) throw notFound('제안이 없습니다');
  if (p.status !== 'pending') throw badRequest('이미 처리한 제안입니다');
  if (!accept) {
    await sql`update ai_proposals set status = 'cancelled', decided_at = now() where id = ${id}`;
    return { ok: true, status: 'cancelled' };
  }
  const x = p.payload;
  let result: Record<string, unknown>;
  try {
    switch (p.kind) {
      case 'create_task': { const r: any = await createTask(u, taskInput.parse(x)); result = { taskId: r.id, link: `/tasks/${r.id}` }; break; }
      case 'update_task': { await updateTask(u, x.taskId, taskInput.partial().parse(x.patch)); result = { taskId: x.taskId, link: `/tasks/${x.taskId}` }; break; }
      case 'comment': { const r = await addComment(u, x.taskId, `${x.text}\n\n— AI 제안을 확인해 작성`); result = { commentId: r.id, link: `/tasks/${x.taskId}#c-${r.id}` }; break; }
      case 'attach_file': { const r = await attachLibraryToTask(u, x.fileId, x.taskId); result = { attachmentId: r.id, link: `/tasks/${x.taskId}` }; break; }
      case 'xlsx_report': {
        const buf = writeXlsx(x.sheets);
        const fileName = `${x.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'AI 보고서'}.xlsx`;
        const f = await saveGeneratedFile(u, { fileName, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: buf, title: x.title, folder: 'AI 보고서', tags: ['AI'], description: 'AI 비서가 만든 보고서(사용자 확인)' });
        if (x.taskId) await attachLibraryToTask(u, f.id, x.taskId);
        result = { fileId: f.id, link: x.taskId ? `/tasks/${x.taskId}` : `/library?file=${f.id}` };
        break;
      }
      default: throw badRequest('모르는 제안');
    }
  } catch (e) {
    await sql`update ai_proposals set status = 'failed', result = ${sql.json({ error: (e as Error).message })}, decided_at = now() where id = ${id}`;
    throw e;
  }
  await sql`update ai_proposals set status = 'done', result = ${sql.json(result as never)}, decided_at = now() where id = ${id}`;
  await audit(sql, u.id, 'ai.proposal_done', null, null, { id, kind: p.kind, result }, null);
  return { ok: true, status: 'done', ...result };
}
