/**
 * V30 ⑥ (#74) 녹음 → 회의록 AI 요약.
 * 화면(휴대폰·PC)이 회의를 녹음하거나 음성 파일을 올리면(자료실 '회의 녹음' 폴더, 쓰고 나면 지움) 서버가 ① STT(stt.ts, OpenAI 음성 인식)로 받아쓰고
 * ② 빠른 모델(Haiku)에 넣어 요약·결정 사항·할 일 후보(JSON)를 만든다. 할 일은 화면에서 버튼 한 번에 그 일정의 후속 업무로.
 * 원가가 크므로: 1회 60분까지 · 회사 월 녹음 한도(무료 30분, 유료 600분, 요금제 limits.minutesPerMonth 로 바꿀 수 있음) · 사람별 AI 한도 · 카드에 "약 N원".
 */
import { z } from 'zod';
import { db, type Sql } from '../db';
import { HttpError, badRequest, forbidden, notFound } from '../errors';
import { denyDemo } from '../access';
import { todaySeoul } from '../time';
import { loadLibraryFile, tenantOf } from '../library';
import { anthropicProvider, aiEnabled, costUsd, usdKrw, type AiProvider } from './provider';
import { sttConfigured, sttCostUsd, transcribeAudio } from './stt';
import { eventCtx } from '../eventtasks';
import { zUuid } from '../api';
import type { SessionUser } from '../types';

export const MAX_SEC = 60 * 60; // 1회 녹음 60분
export const FREE_MIN = 30; // 무료 요금제 월 30분
export const PAID_MIN = 600;
export const minutesInput = z.object({
  audioFileId: zUuid,
  duration: z.number().min(1).max(MAX_SEC).optional(),
  occurrenceStart: z.string().datetime({ offset: true }).optional(),
  hint: z.string().trim().max(500).optional(),
});
export type MinutesTodo = { title: string; assignee: string | null; due: string | null; detail: string };
export type Minutes = {
  id: string; summary: string; decisions: string[]; todos: MinutesTodo[]; transcript: string | null;
  durationSec: number; costKrw: number; createdByName: string | null; createdAt: string;
};
const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    decisions: { type: 'array', items: { type: 'string' } },
    todos: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, assignee: { type: ['string', 'null'] }, due: { type: ['string', 'null'] }, detail: { type: 'string' } }, required: ['title', 'assignee', 'due', 'detail'] } },
  },
  required: ['summary', 'decisions', 'todos'],
};
/** 분당 대략 원가(원): STT + 요약(분당 말 ≈ 400자 ≈ 1,500 토큰 → 약 $0.0015) */
export const perMinKrw = () => Math.max(1, Math.round((sttCostUsd(60) + 0.0015) * usdKrw()));
const monthStart = (sql: Sql) => sql`(date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')`;

/** 회사 월 녹음 한도·쓴 분 */
export async function minutesQuota(tenant: string, sql: Sql = db()) {
  const { subscription } = await import('../plans');
  const sub = await subscription(tenant, sql);
  const fromPlan = Number((sub.limits as { minutesPerMonth?: number } | null)?.minutesPerMonth);
  const capMin = Number.isFinite(fromPlan) && fromPlan > 0 ? fromPlan : /free|trial/.test(String(sub.plan_code)) ? FREE_MIN : PAID_MIN;
  const [{ used }] = await sql<{ used: number }[]>`select coalesce(sum(duration_sec), 0)::float8 used from event_minutes where tenant = ${tenant} and created_at >= ${monthStart(sql)}`;
  return { capMin, usedMin: Math.round((used / 60) * 10) / 10 };
}

const row = (r: any): Minutes => ({
  id: r.id, summary: r.summary, decisions: r.decisions ?? [], todos: r.todos ?? [], transcript: r.transcript ?? null,
  durationSec: r.duration_sec, costKrw: Math.round(Number(r.cost_usd) * usdKrw()), createdByName: r.created_by_name ?? null, createdAt: new Date(r.created_at).toISOString(),
});

/** 일정(회차)의 회의록 목록(최근 5건) + 한도·단가 */
export async function listMinutes(u: SessionUser, eventId: string, occurrenceStart?: string | null) {
  const sql = db();
  const c = await eventCtx(u, eventId, sql);
  const occ = c.event.rrule && occurrenceStart ? new Date(occurrenceStart).toISOString() : '';
  const rows = await sql<any[]>`select m.*, x.name as created_by_name from event_minutes m left join users x on x.id = m.created_by
    where m.event_id = ${c.masterId} and m.occ = ${occ} order by m.created_at desc limit 5`;
  return { items: rows.map(row), quota: await minutesQuota(tenantOf(u), sql), perMinKrw: perMinKrw(), maxSec: MAX_SEC, sttReady: sttConfigured() && aiEnabled(), canWork: c.canWork };
}

export async function makeMinutes(u: SessionUser, eventId: string, i: z.infer<typeof minutesInput>, provider: AiProvider = anthropicProvider({ tier: 'fast' })) {
  denyDemo(u);
  if (!aiEnabled()) throw notFound();
  await (await import('../menuPerms')).requireMenu(u, 'assistant', 'use');
  const sql = db(); const tenant = tenantOf(u);
  const c = await eventCtx(u, eventId, sql);
  if (!c.canWork) throw forbidden('일정 작성자·편집 권한자·참석자만 회의록을 만들 수 있습니다');
  const occ = c.event.rrule && i.occurrenceStart ? new Date(i.occurrenceStart).toISOString() : '';
  await (await import('../plans')).assertAiRequest(u, { legacy: true }); // 회사 월 AI 예산(원)·예전 달러 한도·요청 수
  await (await import('./guard')).assertUserBudget(u, sql); // 사람별 AI 한도
  // 녹음 파일(본인이 올린 것만)
  const a = await loadLibraryFile(u, i.audioFileId, 'ai').catch(() => null);
  if (!a || a.created_by !== u.id) throw badRequest('녹음 파일을 찾을 수 없습니다');
  if (!/^(audio\/|video\/webm|video\/mp4)/i.test(a.mime_type)) throw badRequest('음성 파일이 아닙니다');
  const secs = Math.min(MAX_SEC, Math.max(1, Math.round(i.duration ?? Number(a.size_bytes) / (/wav/i.test(a.mime_type) ? 32000 : 6000))));
  const q = await minutesQuota(tenant, sql);
  if (q.usedMin + secs / 60 > q.capMin) throw new HttpError(429, 'minutes_quota', `이번 달 회의록 녹음 한도(${q.capMin}분)를 넘습니다 — 지금까지 ${q.usedMin}분 사용. 다음 달 1일에 다시 쓸 수 있습니다.`);
  if (!sttConfigured()) throw new HttpError(503, 'stt_unavailable', '받아쓰기(STT)가 아직 설정되지 않았습니다 — 플랫폼 운영자에게 요청해 주세요');

  // 1) 받아쓰기
  const { getObject } = await import('../storage');
  let transcript = '';
  let sttModel = '';
  try {
    const r = await transcribeAudio(await getObject(a.storage_key), a.file_name, a.mime_type, { signal: AbortSignal.timeout(170_000) });
    transcript = r.text; sttModel = r.model;
  } catch (e) {
    throw new HttpError(502, 'stt_failed', `받아쓰기에 실패했습니다: ${(e as Error).message}`.slice(0, 300));
  }
  const sttUsd = sttCostUsd(secs);
  await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
    values (${tenant}, ${u.id}, ${crypto.randomUUID()}, 'openai', ${sttModel}, 0, 0, 0, 0, ${sttUsd}, 'stt')`;
  await sql`update library_files set deleted_at = now(), updated_at = now() where id = ${a.id} and tenant = ${tenant}`.catch(() => {});
  if (!transcript.trim()) throw badRequest('녹음에서 말을 찾지 못했습니다. 더 가까이서 다시 녹음해 주세요');

  // 2) 요약·결정·할 일 (빠른 모델)
  const attendees = await sql<{ name: string }[]>`select x.name from event_attendees a join users x on x.id = a.user_id where a.event_id = ${c.masterId}`;
  const names = [...new Set(attendees.map((x) => x.name))];
  const when = new Date(i.occurrenceStart ?? c.event.start_at).toISOString().slice(0, 10);
  const system = `워크인 AI 비서의 회의록 도우미입니다. 회의 녹음을 받아쓴 글만 받습니다. 한국어로, 들은 내용만 근거로 답하고 없는 내용은 지어내지 마세요. 사람에 대한 평가는 하지 마세요.
JSON 으로만 답하세요: summary(3~6문장 회의 요약), decisions(결정된 사항 한 줄씩, 최대 10개), todos(할 일·후속 조치 최대 10개: title 짧게, assignee 는 참석자 이름 중 맡기로 한 사람(없으면 null), due 는 말한 기한이 있으면 YYYY-MM-DD 아니면 null, detail 한두 문장).
오늘: ${todaySeoul()} (Asia/Seoul). 회의: "${c.event.title}" (${when}).${names.length ? ` 참석자: ${names.join(', ')}.` : ''}`;
  const ask = `${i.hint ? `요청: ${i.hint}\n\n` : ''}[회의 녹취]\n${transcript.slice(0, 60000)}`;
  const r = await provider.chat({ system, tools: [], format: SCHEMA, messages: [{ role: 'user', content: [{ type: 'text', text: ask }] }] });
  const aiUsd = costUsd(r.model ?? provider.model, r.usage);
  await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
    values (${tenant}, ${u.id}, ${crypto.randomUUID()}, ${provider.name}, ${r.model ?? provider.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, ${r.usage.cache_read_input_tokens ?? 0},
      ${r.usage.cache_creation_input_tokens ?? 0}, ${aiUsd}, 'minutes')`;
  if (r.stop_reason === 'refusal') throw badRequest('이 녹음은 요약할 수 없습니다');
  const text = r.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('');
  let j: any; try { j = JSON.parse(text); } catch { throw new HttpError(502, 'ai_bad_output', 'AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.'); }
  const decisions = (Array.isArray(j.decisions) ? j.decisions : []).slice(0, 10).map((x: unknown) => String(x).slice(0, 500)).filter(Boolean);
  const todos: MinutesTodo[] = (Array.isArray(j.todos) ? j.todos : []).slice(0, 10)
    .map((t: any) => ({ title: String(t?.title ?? '').trim().slice(0, 200), assignee: t?.assignee ? String(t.assignee).slice(0, 60) : null, due: /^\d{4}-\d{2}-\d{2}$/.test(t?.due ?? '') ? t.due : null, detail: String(t?.detail ?? '').slice(0, 1000) }))
    .filter((t: MinutesTodo) => t.title);
  const [m] = await sql<any[]>`insert into event_minutes (tenant, event_id, occ, created_by, duration_sec, stt_model, transcript, summary, decisions, todos, cost_usd)
    values (${tenant}, ${c.masterId}, ${occ}, ${u.id}, ${secs}, ${sttModel}, ${transcript.slice(0, 200000)}, ${String(j.summary ?? '').slice(0, 4000)}, ${sql.json(decisions)}, ${sql.json(todos as never)}, ${sttUsd + aiUsd})
    returning *`;
  await (await import('./guard')).userBudgetAlerts(u, sql).catch(() => {});
  return { ok: true, minutes: row({ ...m, created_by_name: u.name }), quota: await minutesQuota(tenant, sql) };
}
