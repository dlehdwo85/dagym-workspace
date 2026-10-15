import { z } from 'zod';
import { db } from '../db';
import { badRequest, forbidden, notFound } from '../errors';
import { audit } from '../log';
import { notify } from '../notifications';
import { tenantOf, type SessionUser } from '../types';
import { usdKrw } from './provider';
import { defaultUserLimitKrw, userAiBudget } from './guard';

/** V23 4장: 사람별 AI 한도 — 추가 요청(직원) → 대표 승인, 대표가 사람별 월 한도 설정, 관리 화면 요약 */
const isOwner = (u: SessionUser) => u.role === 'owner';
const isMgr = (u: SessionUser) => u.role === 'owner' || u.role === 'admin';
const month = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7);

export const limitRequestInput = z.object({ amountKrw: z.number().int().min(1000).max(1_000_000), reason: z.string().trim().max(300).optional() });
export async function requestMoreAi(u: SessionUser, i: z.infer<typeof limitRequestInput>) {
  const sql = db();
  const [dup] = await sql`select 1 from ai_limit_requests where user_id = ${u.id} and month = ${month()} and status = 'pending'`;
  if (dup) throw badRequest('이미 보낸 추가 요청이 대표 확인을 기다리고 있습니다');
  const [r] = await sql<{ id: string }[]>`insert into ai_limit_requests (tenant, user_id, month, amount_krw, reason) values (${tenantOf(u)}, ${u.id}, ${month()}, ${i.amountKrw}, ${i.reason ?? null}) returning id`;
  const owners = (await sql<{ id: string }[]>`select id from users where tenant = ${tenantOf(u)} and role = 'owner' and status = 'active'`).map((x) => x.id);
  await notify(sql, { userIds: owners, type: 'usage_alert', title: `AI 한도 추가 요청 — ${u.name}`, body: `+${i.amountKrw.toLocaleString('ko-KR')}원${i.reason ? ` · ${i.reason.slice(0, 60)}` : ''}`,
    link: '/admin/usage#ai-people', actorId: u.id, dedupeKey: `ai_limit_req:${r.id}` });
  await audit(sql, u.id, 'ai.limit_request', null, null, { id: r.id, amountKrw: i.amountKrw }, null);
  return { id: r.id };
}
export async function decideAiRequest(u: SessionUser, id: string, approve: boolean, ip: string | null) {
  if (!isOwner(u)) throw forbidden('대표만 승인할 수 있습니다');
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
  const sql = db();
  const [r] = await sql<{ id: string; user_id: string; amount_krw: number; status: string }[]>`update ai_limit_requests set status = ${approve ? 'approved' : 'rejected'}, decided_by = ${u.id}, decided_at = now()
    where id = ${id} and tenant = ${tenantOf(u)} and status = 'pending' returning id, user_id, amount_krw, status`;
  if (!r) throw notFound('요청이 없거나 이미 처리되었습니다');
  await notify(sql, { userIds: [r.user_id], type: 'usage_alert', title: approve ? 'AI 한도 추가 승인' : 'AI 한도 추가 거절',
    body: approve ? `이번 달 AI 한도가 ${r.amount_krw.toLocaleString('ko-KR')}원 늘었습니다` : '대표가 이번 추가 요청을 거절했습니다', link: '/assistant', actorId: u.id, dedupeKey: `ai_limit_dec:${r.id}` });
  await audit(sql, u.id, approve ? 'ai.limit_approved' : 'ai.limit_rejected', 'user', r.user_id, { id: r.id, amountKrw: r.amount_krw }, ip);
  return { ok: true };
}
export const userLimitInput = z.object({ userId: z.string().uuid(), monthlyKrw: z.number().int().min(0).max(10_000_000) });
export async function setUserAiLimit(u: SessionUser, i: z.infer<typeof userLimitInput>, ip: string | null) {
  if (!isOwner(u)) throw forbidden('대표만 바꿀 수 있습니다');
  const sql = db();
  const [t] = await sql<{ id: string; monthly: number | null }[]>`select us.id, l.monthly_krw as monthly from users us left join ai_user_limits l on l.user_id = us.id where us.id = ${i.userId} and us.tenant = ${tenantOf(u)}`;
  if (!t) throw notFound('사람이 없습니다');
  await sql`insert into ai_user_limits (user_id, monthly_krw, updated_by) values (${i.userId}, ${i.monthlyKrw}, ${u.id})
    on conflict (user_id) do update set monthly_krw = excluded.monthly_krw, updated_by = excluded.updated_by, updated_at = now()`;
  await audit(sql, u.id, 'ai.user_limit', 'user', i.userId, { from: t.monthly, to: i.monthlyKrw }, ip);
  return { ok: true };
}
/** 관리 > AI 사용 내역: 사람별 사용액·남은 한도·건수, 기다리는 추가 요청, 비싼 요청 상위 10 (대표·관리자) */
export async function aiBudgetsOverview(u: SessionUser) {
  if (!isMgr(u)) throw forbidden();
  const sql = db();
  const people = await sql<{ id: string; name: string; role: string }[]>`select id, name, role from users where tenant = ${tenantOf(u)} and status = 'active' order by role = 'owner' desc, name`;
  const rows = await Promise.all(people.map(async (p) => ({ id: p.id, name: p.name, role: p.role, defaultKrw: defaultUserLimitKrw(p.role), ...(await userAiBudget(p, sql)) })));
  const m = month();
  const [pending, top, [tot]] = await Promise.all([
    sql`select r.id, r.user_id, us.name, r.amount_krw, r.reason, r.created_at from ai_limit_requests r join users us on us.id = r.user_id where r.tenant = ${tenantOf(u)} and r.status = 'pending' order by r.created_at`,
    sql`select a.request_id, us.name, coalesce(a.purpose, 'assistant') as purpose, sum(coalesce(a.cost_krw, a.cost_usd * ${usdKrw()}))::float8 krw, max(a.created_at) as at, count(*)::int calls
      from ai_usage a left join users us on us.id = a.user_id where a.tenant = ${tenantOf(u)} and a.created_at >= (${m + '-01'}::date::timestamp at time zone 'Asia/Seoul')
      group by a.request_id, us.name, a.purpose order by krw desc limit 10`,
    sql<{ krw: number; usd: number }[]>`select coalesce(sum(coalesce(cost_krw, cost_usd * ${usdKrw()})), 0)::float8 krw, coalesce(sum(cost_usd), 0)::float8 usd from ai_usage
      where tenant = ${tenantOf(u)} and created_at >= (${m + '-01'}::date::timestamp at time zone 'Asia/Seoul')`,
  ]);
  return { month: m, usdKrw: usdKrw(), canEdit: isOwner(u), people: rows, pending, top, totalKrw: Math.round(tot.krw), totalUsd: Math.round(tot.usd * 100) / 100 };
}
export async function myAiRequests(u: SessionUser) {
  return { requests: await db()`select id, month, amount_krw, reason, status, created_at, decided_at from ai_limit_requests where user_id = ${u.id} order by created_at desc limit 10` };
}
