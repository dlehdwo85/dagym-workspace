import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../db';
import { HttpError, notFound } from '../errors';
import { requireMenu } from '../menuPerms';
import { tenantOf, type SessionUser } from '../types';

/**
 * V28-1 업무마다 AI 비서: 이 업무(제목·설명·체크리스트·댓글·첨부 글자·문의 내용)만 문맥으로 Haiku 가 답한다.
 * 메일·문자·카카오톡은 초안만 — 보내기는 사람이 시안 창에서. 연락처(전화·이메일)는 AI 에 보내지 않는다. 대화는 업무 × 사람 단위로 저장.
 */
export const ACTIONS = { mail: '메일 초안', sms: '문자 초안', kakao: '카카오톡 초안', summary: '요약', next: '다음 할 일 제안', ask: '질문' } as const;
export type AssistAction = keyof typeof ACTIONS;
export const assistInput = z.object({ action: z.enum(Object.keys(ACTIONS) as [AssistAction, ...AssistAction[]]).default('ask'), text: z.string().trim().max(2000).optional() });

const SYSTEM = `회사 업무 1건을 돕는 비서입니다. 아래 [업무 문맥]만 근거로 답합니다.
- 한국어 존댓말, 짧고 실무적으로. 2~3문장마다 빈 줄, 항목은 "- ".
- 문맥에 없는 사실(금액·날짜·약속·사람)을 지어내지 않습니다. 모르는 값은 [ ] 로 비워 두거나 확인이 필요하다고 말합니다.
- 받는 사람 이름·전화·이메일은 쓰지 않습니다(호칭은 "담당자님").
- 메일·문자·카카오톡은 초안만 씁니다. 실제 발송은 사람이 시안 창에서 합니다. 명함·서명·링크는 시스템이 붙이므로 쓰지 않습니다.`;
const INSTR: Record<AssistAction, string> = {
  mail: '이 업무로 고객에게 보낼 메일 초안을 써 주세요. 제목(subject)·본문(body 3~6문장)·첨부로 보낼 파일 번호(attach, 업무 첨부 목록의 번호, 없으면 빈 배열)·한 줄 설명(reply).',
  sms: '이 업무로 고객에게 보낼 문자 초안(body, 2~3문장)과 한 줄 설명(reply). 첨부를 보내야 하면 attach 에 번호(링크로 들어감).',
  kakao: '이 업무로 고객에게 보낼 카카오톡 메시지 초안(body, 2~4문장, 이모지 없이)과 한 줄 설명(reply).',
  summary: '이 업무를 5줄 이내로 요약해 주세요(현재 상태·남은 일·막힌 점). reply 에.',
  next: '다음에 할 일을 우선순위대로 3개 이내로 제안해 주세요(누가·무엇을·언제). reply 에.',
  ask: '사용자 질문에 답해 주세요. 초안을 요청하면 subject·body 도 채우세요. reply 에 답.',
};
const SCHEMA = { type: 'object', additionalProperties: false, required: ['reply', 'subject', 'body', 'attach'],
  properties: { reply: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, attach: { type: 'array', items: { type: 'integer' } } } };

async function loadTask(u: SessionUser, taskId: string) {
  const { loadTaskForUser } = await import('../access');
  await loadTaskForUser(u, taskId); // 못 보는 업무·다른 조직은 404
  const sql = db();
  const [t] = await sql<{ title: string; description: string | null; status: string; due_date: string | null; due_time: string | null; assignee_name: string | null; requester_name: string | null }[]>`
    select t.title, t.description, t.status, to_char(t.due_date, 'YYYY-MM-DD') due_date, to_char(t.due_time, 'HH24:MI') due_time, a.name assignee_name, r.name requester_name
    from tasks t left join users a on a.id = t.assignee_id left join users r on r.id = t.requested_by where t.id = ${taskId}`;
  if (!t) throw notFound();
  return t;
}

/** 업무 문맥(연락처 빼고). 첨부는 글자를 읽을 수 있는 작은 파일 3개까지 앞부분만 */
async function taskContext(taskId: string, t: Awaited<ReturnType<typeof loadTask>>) {
  const sql = db();
  const [items, comments, atts, [inq]] = await Promise.all([
    sql<{ text: string; done: boolean }[]>`select text, done from task_checklist_items where task_id = ${taskId} order by sort`,
    sql<{ body: string; name: string; created_at: Date }[]>`select c.body, u.name, c.created_at from comments c join users u on u.id = c.author_id
      where c.task_id = ${taskId} and c.deleted_at is null order by c.created_at desc limit 15`,
    sql<{ id: string; file_name: string; mime_type: string; size_bytes: string; storage_key: string | null }[]>`select id, file_name, mime_type, size_bytes, storage_key from attachments
      where task_id = ${taskId} and kind = 'file' and deleted_at is null and upload_status = 'ready' order by created_at`,
    sql<{ organization: string | null; inquiry_type: string; site: string }[]>`select organization, inquiry_type, site from inquiries where task_id = ${taskId} limit 1`,
  ]);
  const { extractText } = await import('../textExtract');
  const { getObject } = await import('../storage');
  const texts: string[] = [];
  for (const a of atts.filter((x) => x.storage_key && Number(x.size_bytes) <= 3 * 1024 * 1024).slice(0, 3)) {
    try { const s = extractText(await getObject(a.storage_key!), a.file_name, a.mime_type); if (s) texts.push(`[${a.file_name}]\n${s.slice(0, 1500)}`); } catch { /* 못 읽는 파일은 이름만 */ }
  }
  const desc = (t.description ?? '').replace(/\*\*연락처[\s\S]*?(?=\*\*문의 내용 원문\*\*|$)/, '');
  const text = [
    `[업무] ${t.title} · 상태 ${t.status}${t.due_date ? ` · 마감 ${t.due_date}${t.due_time ? ' ' + t.due_time : ''}` : ''}${t.assignee_name ? ` · 담당 ${t.assignee_name}` : ''}${t.requester_name ? ` · 지시 ${t.requester_name}` : ''}`,
    inq ? `[문의] ${inq.site} · ${inq.inquiry_type}${inq.organization ? ` · ${inq.organization}` : ''}` : '',
    desc.trim() ? `[설명]\n${desc.slice(0, 3000)}` : '',
    items.length ? `[체크리스트]\n${items.map((x) => `${x.done ? '✔' : '·'} ${x.text}`).join('\n')}` : '',
    comments.length ? `[최근 댓글]\n${comments.reverse().map((c) => `${c.name}: ${c.body.slice(0, 300)}`).join('\n')}` : '',
    atts.length ? `[첨부 목록]\n${atts.map((a, n) => `${n + 1}. ${a.file_name}`).join('\n')}` : '[첨부 목록] 없음',
    texts.length ? `[첨부 글자(앞부분)]\n${texts.join('\n\n')}` : '',
  ].filter(Boolean).join('\n\n');
  return { text, atts };
}

export async function taskAssistHistory(u: SessionUser, taskId: string) {
  await loadTask(u, taskId);
  const rows = await db()`select id, role, action, content, draft, cost_krw, created_at from task_ai_messages where task_id = ${taskId} and user_id = ${u.id} order by id desc limit 40`;
  return { messages: rows.reverse(), actions: ACTIONS };
}

export async function taskAssist(u: SessionUser, taskId: string, i: z.infer<typeof assistInput>) {
  const t = await loadTask(u, taskId);
  await requireMenu(u, 'assistant', 'use');
  if (i.action === 'ask' && !i.text) throw new HttpError(400, 'bad_request', '무엇을 도와드릴지 적어 주세요');
  const P = await import('./provider');
  if (!P.aiEnabled()) throw new HttpError(503, 'ai_off', 'AI 가 설정되지 않았습니다');
  const G = await import('./guard');
  await G.assertUserBudget(u);
  await (await import('../plans')).assertAiRequest(u);
  const sql = db();
  const ctx = await taskContext(taskId, t);
  const hist = (await sql<{ role: 'user' | 'assistant'; content: string }[]>`select role, content from task_ai_messages where task_id = ${taskId} and user_id = ${u.id} order by id desc limit 6`).reverse();
  const ask = `${INSTR[i.action]}${i.text ? `\n\n[사용자 요청] ${i.text}` : ''}`;
  const messages = [
    { role: 'user' as const, content: `[업무 문맥]\n${ctx.text}` }, { role: 'assistant' as const, content: '업무 문맥을 확인했습니다.' },
    ...hist.map((h) => ({ role: h.role, content: h.content })), { role: 'user' as const, content: ask },
  ];
  const p = P.anthropicProvider({ tier: 'fast' });
  const r = await p.chat({ system: SYSTEM, tools: [], messages, format: SCHEMA });
  const cost = P.costUsd(r.model ?? p.model, r.usage);
  await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
    values (${tenantOf(u)}, ${u.id}, ${randomUUID()}, ${p.name}, ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, ${r.usage.cache_read_input_tokens ?? 0},
      ${r.usage.cache_creation_input_tokens ?? 0}, ${cost}, 'task_assist')`;
  const raw = r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  let out: { reply?: string; subject?: string; body?: string; attach?: number[] } = {};
  try { out = JSON.parse(raw); } catch { out = { reply: raw }; }
  const pick = [...new Set((out.attach ?? []).filter((n) => Number.isInteger(n) && n >= 1 && n <= ctx.atts.length))].map((n) => ctx.atts[n - 1].id);
  const isDraft = ['mail', 'sms', 'kakao'].includes(i.action) || !!out.body?.trim();
  const draft = isDraft ? { channel: i.action === 'sms' ? 'sms' : i.action === 'kakao' ? 'kakao' : 'email', subject: String(out.subject ?? '').slice(0, 200), body: String(out.body ?? '').slice(0, 5000), attachmentIds: pick } : null;
  const reply = String(out.reply ?? '').slice(0, 4000) || (draft ? '초안을 만들었습니다 — 시안 창에서 확인하고 고쳐 주세요.' : '');
  const costKrw = Math.round(cost * P.usdKrw() * 100) / 100;
  const userText = i.text ? `${i.action === 'ask' ? '' : `[${ACTIONS[i.action]}] `}${i.text}` : ACTIONS[i.action];
  await sql`insert into task_ai_messages (task_id, user_id, role, action, content) values (${taskId}, ${u.id}, 'user', ${i.action}, ${userText})`;
  const [m] = await sql<{ id: number }[]>`insert into task_ai_messages (task_id, user_id, role, action, content, draft, cost_krw)
    values (${taskId}, ${u.id}, 'assistant', ${i.action}, ${reply}, ${draft ? sql.json(draft as never) : null}, ${costKrw}) returning id`;
  await G.userBudgetAlerts(u).catch(() => {});
  return { id: m.id, reply, draft, costKrw };
}

export async function clearTaskAssist(u: SessionUser, taskId: string) {
  await loadTask(u, taskId);
  await db()`delete from task_ai_messages where task_id = ${taskId} and user_id = ${u.id}`;
  return { ok: true };
}
