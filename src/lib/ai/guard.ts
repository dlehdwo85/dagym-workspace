import { db, type Sql } from '../db';
import { HttpError } from '../errors';
import { notify } from '../notifications';
import { tenantOf, type SessionUser } from '../types';
import { usdKrw } from './provider';

/**
 * V23-1 Anthropic 크레딧 소진 안내 + 4장·4.5 사람별 AI 한도.
 * - 오류 구분: 크레딧 부족(402 billing_error·"credit balance") / 요청 한도(429) / 일시 장애(5xx·529) — 사용자 문구 각각, 원문은 로그만
 * - 크레딧 부족이면 1시간 동안 AI 호출을 막고(반복 호출 금지), 1시간 뒤 첫 요청이 확인 역할. 대표·플랫폼 운영자에게 하루 1번 알림
 * - 사람별 월 한도(원, 기본 대표 20,000·그 밖 10,000) + 하루 한도(월의 20%) + 승인된 추가 요청. 회사 월 한도($)와 둘 중 먼저 닿는 쪽에서 멈춤
 */
export const CREDIT_MSG = '이번 달 AI 크레딧이 모두 사용되었습니다. 다음 충전 이후 다시 사용할 수 있습니다. (업무·일정 등 다른 기능은 그대로 쓸 수 있습니다)';
const BLOCK_KEY = 'ai_credit_block';
export type AiErrKind = 'credit' | 'rate' | 'outage' | 'other';
export function classifyAiError(e: any): AiErrKind {
  const status = Number(e?.status ?? 0);
  const text = `${e?.type ?? ''} ${e?.error?.error?.type ?? ''} ${e?.message ?? ''}`;
  if (status === 402 || /billing_error|credit balance|insufficient.?credit|purchase credits/i.test(text)) return 'credit';
  if (status === 429) return 'rate';
  if (status >= 500 || status === 529 || /overloaded/i.test(text)) return 'outage';
  return 'other';
}
export function aiErrorMessage(kind: AiErrKind, status?: number) {
  if (kind === 'credit') return CREDIT_MSG;
  if (kind === 'rate') return 'AI 요청이 몰려 잠시 쉬어야 합니다. 1분쯤 뒤 다시 시도해 주세요.';
  if (kind === 'outage') return 'AI 서버가 잠시 불안정합니다. 잠시 후 다시 시도해 주세요.';
  return `AI 서버 응답 오류${status ? ` (${status})` : ''}. 잠시 후 다시 시도하세요.`;
}

/** 크레딧 부족 차단 중이면 바로 안내(외부 호출 없음) */
export async function assertAiCredit(sql: Sql = db()) {
  const [r] = await sql<{ until: string }[]>`select value->>'until' as until from app_settings where key = ${BLOCK_KEY}`;
  if (r?.until && new Date(r.until) > new Date()) throw new HttpError(503, 'ai_credit', CREDIT_MSG);
}
export async function creditBlockedUntil(sql: Sql = db()) {
  const [r] = await sql<{ until: string }[]>`select value->>'until' as until from app_settings where key = ${BLOCK_KEY}`;
  return r?.until && new Date(r.until) > new Date() ? r.until : null;
}
/** AI 호출이 실패했을 때: 크레딧 부족이면 1시간 차단 + 하루 1번 알림. 사용자에게 보일 HttpError 를 돌려준다 */
export async function onAiError(e: any, sql: Sql = db()): Promise<HttpError> {
  const kind = classifyAiError(e);
  if (kind === 'credit') {
    const until = new Date(Date.now() + 3600_000).toISOString();
    await sql`insert into app_settings (key, value) values (${BLOCK_KEY}, ${sql.json({ until, at: new Date().toISOString() })})
      on conflict (key) do update set value = excluded.value, updated_at = now()`.catch(() => {});
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    const targets = (await sql<{ id: string }[]>`select id from users where status = 'active' and (platform_admin or (role = 'owner' and tenant = 'default'))`.catch(() => [])).map((x) => x.id);
    await notify(sql, { userIds: targets, type: 'usage_alert', title: 'AI 크레딧 소진', body: 'Anthropic 크레딧이 부족해 AI 기능이 멈췄습니다. 콘솔에서 크레딧을 확인하세요. (1시간마다 다시 확인)',
      link: '/admin/usage', dedupeKey: `ai_credit:${day}` }).catch(() => {});
    const { logError } = await import('../log');
    await logError('ai.credit', e, {}).catch(() => {});
  }
  return new HttpError(kind === 'credit' ? 503 : kind === 'rate' ? 429 : 502, kind === 'credit' ? 'ai_credit' : 'ai_unavailable', aiErrorMessage(kind, e?.status));
}
/** 호출이 성공하면 차단 풀기(1시간 뒤 확인 요청이 성공한 경우) */
export async function clearAiCredit(sql: Sql = db()) {
  await sql`delete from app_settings where key = ${BLOCK_KEY} and (value->>'until')::timestamptz <= now()`.catch(() => {});
}

// ---------------- 사람별 한도 ----------------
const monthKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7);
export const defaultUserLimitKrw = (role: string) => (role === 'owner' ? 20000 : 10000); // 4.5: 대표 20,000 · 본부장·직원 10,000
export async function userAiBudget(u: { id: string; role: string }, sql: Sql = db()) {
  const month = monthKey();
  const [[lim], [extra], [used], [today]] = await Promise.all([
    sql<{ monthly_krw: number }[]>`select monthly_krw from ai_user_limits where user_id = ${u.id}`,
    sql<{ krw: number }[]>`select coalesce(sum(amount_krw), 0)::int krw from ai_limit_requests where user_id = ${u.id} and month = ${month} and status = 'approved'`,
    sql<{ krw: number; chats: number; docs: number }[]>`select coalesce(sum(coalesce(cost_krw, cost_usd * ${usdKrw()})), 0)::float8 krw,
        count(*) filter (where purpose is null or purpose in ('assistant', 'sales_assistant', 'marketing_assistant'))::int chats, count(*) filter (where purpose = 'doc_engine')::int docs
      from ai_usage where user_id = ${u.id} and created_at >= (${month + '-01'}::date::timestamp at time zone 'Asia/Seoul')`,
    sql<{ krw: number }[]>`select coalesce(sum(coalesce(cost_krw, cost_usd * ${usdKrw()})), 0)::float8 krw from ai_usage
      where user_id = ${u.id} and created_at >= ((now() at time zone 'Asia/Seoul')::date::timestamp at time zone 'Asia/Seoul')`,
  ]);
  const limit = (lim?.monthly_krw ?? defaultUserLimitKrw(u.role)) + (extra?.krw ?? 0);
  const dayLimit = Math.round(limit * 0.2);
  // 최근 평균 단가(원): 대화 1건(질문 1번 = 요청 묶음)·문서 1건
  const [avg] = await sql<{ chat: number | null; doc: number | null }[]>`select
      (select avg(c) from (select sum(coalesce(cost_krw, cost_usd * ${usdKrw()})) c from ai_usage where user_id = ${u.id} and (purpose is null or purpose in ('assistant', 'sales_assistant', 'marketing_assistant')) group by request_id order by max(created_at) desc limit 30) x)::float8 chat,
      (select avg(cost_usd * ${usdKrw()}) from (select cost_usd from ai_doc_jobs where user_id = ${u.id} and status = 'done' order by created_at desc limit 20) y)::float8 doc`;
  const usedKrw = Math.round(used.krw);
  const remaining = Math.max(0, limit - usedKrw);
  const chatKrw = Math.max(1, Math.round(avg?.chat ?? 30)), docKrw = Math.max(1, Math.round(avg?.doc ?? 50));
  return { month, limitKrw: limit, baseKrw: lim?.monthly_krw ?? defaultUserLimitKrw(u.role), extraKrw: extra?.krw ?? 0, usedKrw, remainingKrw: remaining,
    pct: limit > 0 ? Math.round((usedKrw / limit) * 100) : 100, todayKrw: Math.round(today.krw), dayLimitKrw: dayLimit,
    chats: used.chats, docs: used.docs, avgChatKrw: chatKrw, avgDocKrw: docKrw, chatsLeft: Math.floor(remaining / chatKrw), docsLeft: Math.floor(remaining / docKrw) };
}
export const USER_LIMIT_MSG = '이번 달 내 AI 한도를 모두 썼습니다 — [추가 요청]으로 대표에게 한도를 요청해 주세요. (업무·일정 등 다른 기능은 그대로 쓸 수 있습니다)';
/** 사람별 한도 확인(달·하루). 다 썼으면 429 */
export async function assertUserBudget(u: SessionUser, sql: Sql = db()) {
  const b = await userAiBudget(u, sql);
  if (b.usedKrw >= b.limitKrw) throw new HttpError(429, 'ai_user_limit', USER_LIMIT_MSG);
  if (b.todayKrw >= b.dayLimitKrw) throw new HttpError(429, 'ai_user_day_limit', `오늘 쓸 수 있는 AI 한도(약 ${b.dayLimitKrw.toLocaleString('ko-KR')}원, 월 한도의 20%)를 다 썼습니다. 내일 다시 쓸 수 있습니다.`);
  return b;
}
/** 사용 뒤 80%·100% 알림(본인·대표, 달마다 한 번씩) */
export async function userBudgetAlerts(u: SessionUser, sql: Sql = db()) {
  const b = await userAiBudget(u, sql);
  for (const level of [100, 80]) {
    if (b.pct < level) continue;
    const ins = await sql`insert into ai_user_alerts (user_id, month, level) values (${u.id}, ${b.month}, ${level}) on conflict do nothing returning level`;
    if (!ins.length) break;
    const owners = (await sql<{ id: string }[]>`select id from users where tenant = ${tenantOf(u)} and role = 'owner' and status = 'active'`).map((x) => x.id);
    await notify(sql, { userIds: [u.id, ...owners.filter((o) => o !== u.id)], type: 'usage_alert', title: `AI 한도 ${level}% — ${u.name}`,
      body: `이번 달 ${b.usedKrw.toLocaleString('ko-KR')}원 / ${b.limitKrw.toLocaleString('ko-KR')}원${level === 100 ? ' — AI 기능이 멈췄습니다. 추가 요청을 승인하면 다시 쓸 수 있습니다' : ''}`,
      link: '/assistant', dedupeKey: `ai_user:${u.id}:${b.month}:${level}` });
    break;
  }
  return b;
}
