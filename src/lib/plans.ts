import { z } from 'zod';
import { DateTime } from 'luxon';
import { db, type Sql } from './db';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { audit } from './log';
import { notify } from './notifications';
import type { SessionUser } from './types';

/**
 * V10 회사(테넌트)별 사용량 계량 · 요금제. 결제 연동 없이 "운영자가 요금제 지정".
 * - 테넌트: 지금은 'default'(우리 회사, 내부 무제한) · 'demo'(체험 조직). 사용자의 테넌트 = 체험 계정이면 demo.
 * - 저장공간 = 업무·일정 첨부 + 자료실 파일 크기 합(휴지통·삭제 표시된 것 포함 — 실제 파일은 남아 있으므로).
 * - 한도를 넘어도 업무·일정 등 핵심 기능은 막지 않는다. 막는 것: 새 파일 올리기 · AI 요청 · 사람 초대.
 */
const TZ = 'Asia/Seoul';
const GB = 1024 ** 3;
export type Limits = { users: number | null; storageGb: number | null; aiRequests: number | null; tasksTotal?: number | null; contactsTotal?: number | null /* V31 연락처 수 */ };
export const tenantOfUser = (u: { tenant?: string | null; isDemo?: boolean | null }) => u.tenant ?? (u.isDemo ? 'demo' : 'default');
const monthStart = () => DateTime.now().setZone(TZ).startOf('month');

export async function subscription(tenant: string, sql: Sql = db()) {
  const [s] = await sql<any[]>`select s.*, p.name as plan_name, p.monthly_krw, p.per_user_krw, p.limits, p.public
    from tenant_subscriptions s join plans p on p.code = s.plan_code where s.tenant = ${tenant}`;
  if (s) return s;
  // 구독이 없는 회사는 무료 요금제로 본다
  const [p] = await sql<any[]>`select code as plan_code, name as plan_name, monthly_krw, per_user_krw, limits, public from plans where code = 'free'`;
  return { tenant, addons: {}, period_start: null, period_end: null, status: 'active', ...p };
}

/** 요금제 + 추가 옵션 = 실제 한도 (null = 무제한) */
export async function effectiveLimits(tenant: string, sql: Sql = db()): Promise<{ limits: Limits; sub: any }> {
  const sub = await subscription(tenant, sql);
  const base = sub.limits as Limits & { perUserStorageGb?: number; perUserAi?: number };
  const limits: Limits = { users: base.users ?? null, storageGb: base.storageGb ?? null, aiRequests: base.aiRequests ?? null, tasksTotal: base.tasksTotal ?? null, contactsTotal: base.contactsTotal ?? null };
  // V12 1번 베이직: 1인 한도 × 활성 사용자 수(회사 합산, 최소 1명)
  if (base.perUserStorageGb || base.perUserAi) {
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from users where status = 'active' and tenant = ${tenant}`;
    const people = Math.max(1, n);
    if (base.perUserStorageGb) limits.storageGb = base.perUserStorageGb * people;
    if (base.perUserAi) limits.aiRequests = base.perUserAi * people;
  }
  // V28-3 플랫폼 운영자가 회사별로 정한 한도(있으면 요금제 한도 대신, null = 무제한)
  const ov = (sub.limit_overrides ?? {}) as Partial<Limits>;
  for (const k of ['users', 'storageGb', 'aiRequests', 'tasksTotal', 'contactsTotal'] as const) if (k in ov) limits[k] = ov[k] ?? null;
  const counts = (sub.addons ?? {}) as Record<string, number>;
  const codes = Object.keys(counts).filter((k) => counts[k] > 0);
  if (codes.length) {
    for (const a of await sql<{ code: string; adds: Partial<Limits> }[]>`select code, adds from plan_addons where code = any(${codes})`) {
      for (const [k, v] of Object.entries(a.adds) as [keyof Limits, number][]) if (limits[k] !== null) limits[k] = (limits[k] ?? 0) + v * counts[a.code];
    }
  }
  return { limits, sub };
}

/** 실시간 사용량 */
export async function currentUsage(tenant: string, sql: Sql = db()) {
  const demo = tenant === 'demo';
  const start = monthStart().toJSDate();
  const [[att], [lib], [ai], [users], [tk]] = await Promise.all([
    sql<{ bytes: number; photo: number; doc: number }[]>`select coalesce(sum(a.size_bytes), 0)::float8 bytes,
        coalesce(sum(a.size_bytes) filter (where a.mime_type like 'image/%'), 0)::float8 photo,
        coalesce(sum(a.size_bytes) filter (where a.mime_type ~ '(pdf|word|sheet|excel|presentation|powerpoint|text|csv|hwp)'), 0)::float8 doc
      from attachments a join users u on u.id = a.created_by where a.kind = 'file' and a.storage_key is not null and u.tenant = ${tenant}
        and not exists (select 1 from library_files l where l.storage_key = a.storage_key)`, // 자료실에서 첨부한 파일은 한 번만 셈
    sql<{ bytes: number; photo: number; doc: number }[]>`select coalesce(sum(size_bytes), 0)::float8 bytes,
        coalesce(sum(size_bytes) filter (where mime_type like 'image/%'), 0)::float8 photo,
        coalesce(sum(size_bytes) filter (where mime_type ~ '(pdf|word|sheet|excel|presentation|powerpoint|text|csv|hwp)'), 0)::float8 doc
      from library_files where tenant = ${tenant}`,
    sql<{ requests: number; tokens: number; cost: number }[]>`select count(distinct coalesce(request_id::text, id::text))::int requests,
        coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0)::float8 tokens, coalesce(sum(cost_usd), 0)::float8 cost
      from ai_usage where tenant = ${tenant} and created_at >= ${start}`,
    sql<{ active: number; invited: number }[]>`select count(*) filter (where status = 'active')::int active, count(*) filter (where status = 'invited')::int invited
      from users where tenant = ${tenant}`,
    taskCount(tenant, sql).then((n) => [n]),
  ]);
  const bytes = att.bytes + lib.bytes, photo = att.photo + lib.photo, doc = att.doc + lib.doc;
  return { storageBytes: bytes, byKind: { photo, doc, other: Math.max(0, bytes - photo - doc) }, aiRequests: ai.requests, aiTokens: ai.tokens, aiCostUsd: Math.round(ai.cost * 100) / 100,
    users: users.active, invited: users.invited, tasks: tk };
}

/** V29 3장 업무 총량: 진행 + 완료 + 휴지통(30일 안) — 정리(purged)한 업무·30일 지난 휴지통은 빠짐 */
export async function taskCount(tenant: string, sql: Sql = db()) {
  const [r] = await sql<{ n: number }[]>`select count(*)::int n from tasks t join users u on u.id = t.created_by
    where u.tenant = ${tenant} and t.purged_at is null and (t.deleted_at is null or t.deleted_at > now() - interval '30 days')`;
  return r.n;
}
/** 업무 총량 한도 — 요금제(또는 회사별 조정)에 tasksTotal 이 있을 때만. 새 업무 만들기만 막고 보기·완료·삭제·내보내기는 그대로 */
export async function assertTaskQuota(u: SessionUser, adding = 1, sql: Sql = db()) {
  const tenant = tenantOfUser(u);
  if (tenant === 'default' || tenant === 'demo') return;
  const { limits } = await effectiveLimits(tenant, sql);
  if (limits.tasksTotal === null || limits.tasksTotal === undefined) return;
  const n = await taskCount(tenant, sql);
  if (n + adding > limits.tasksTotal) throw new HttpError(429, 'task_quota', `업무가 ${n.toLocaleString('ko-KR')}개로 한도(${limits.tasksTotal.toLocaleString('ko-KR')}개, 완료·휴지통 포함)에 닿아 새 업무를 만들 수 없습니다. 관리자가 사용량 화면에서 오래된 완료 업무를 보관 파일로 내보내고 정리하거나 요금제를 올리면 다시 만들 수 있습니다.`);
}

const over = (used: number, limit: number | null) => limit !== null && used >= limit;

// ---------------- 한도 확인 (막는 곳: 올리기 · AI · 초대) ----------------
export async function assertStorage(u: SessionUser, addBytes: number) {
  const tenant = tenantOfUser(u);
  const { limits } = await effectiveLimits(tenant);
  if (limits.storageGb === null) return;
  const usage = await currentUsage(tenant);
  if (usage.storageBytes + addBytes > limits.storageGb * GB) {
    throw new HttpError(409, 'storage_full', `회사 저장공간(${limits.storageGb}GB)이 가득 찼습니다. 기존 파일 보기·내려받기는 계속 됩니다. 관리 → 사용량·요금제에서 정리하거나 저장 팩(+20GB 월 3,000원·+100GB 월 9,900원)을 요청해 주세요.`);
  }
}
export async function assertAiRequest(u: SessionUser) {
  const tenant = tenantOfUser(u);
  const { limits } = await effectiveLimits(tenant);
  if (limits.aiRequests === null) return;
  const usage = await currentUsage(tenant);
  if (usage.aiRequests >= limits.aiRequests) throw new HttpError(429, 'ai_quota', `이번 달 AI 요청 ${limits.aiRequests}회를 모두 썼습니다. 다음 달 1일에 다시 쓸 수 있습니다 — 관리자가 AI 팩(100회 월 3,000원부터)을 요청하면 바로 늘어납니다.`);
}
export async function assertSeat(tenant: string, sql: Sql = db()) {
  const { limits } = await effectiveLimits(tenant, sql);
  if (limits.users === null) return;
  const usage = await currentUsage(tenant, sql);
  if (usage.users + usage.invited >= limits.users) throw new HttpError(409, 'seat_full', `요금제 사용자 수(${limits.users}명)를 넘어 초대할 수 없습니다. 쓰지 않는 계정을 비활성화하거나 사용자 추가 옵션을 신청해 주세요.`);
}

// ---------------- 회사 관리자: 사용량·요금제 ----------------
export async function requireTenantAdmin(u: SessionUser, need: 'view' | 'edit' = 'view') { // V14 7번: 메뉴 권한 "사용량·요금제"
  if (u.isDemo) throw forbidden('대표·본사 관리자만 볼 수 있습니다');
  await (await import('./menuPerms')).requireMenu(u, 'usage', need);
}
export async function usageOverview(u: SessionUser) {
  await requireTenantAdmin(u);
  const tenant = tenantOfUser(u);
  const sql = db();
  const [{ limits, sub }, usage, plans, addons, top, requests] = await Promise.all([
    effectiveLimits(tenant, sql), currentUsage(tenant, sql),
    sql`select code, name, monthly_krw, per_user_krw, annual_monthly_krw, annual_per_user_krw, min_users, limits, description from plans where public and active order by sort`,
    sql`select code, name, monthly_krw, adds from plan_addons where active order by sort`,
    sql`(select 'attachment' as kind, a.id, coalesce(a.doc_title, a.file_name) as title, a.file_name, a.size_bytes::float8 size, a.mime_type, a.task_id, a.event_id, a.deleted_at, a.created_at
        from attachments a join users u2 on u2.id = a.created_by where a.kind = 'file' and a.storage_key is not null and u2.tenant = ${tenant}
          and not exists (select 1 from library_files l where l.storage_key = a.storage_key))
      union all (select 'library', id, title, file_name, size_bytes::float8, mime_type, null, null, deleted_at, created_at from library_files where tenant = ${tenant})
      order by size desc limit 20`,
    sql`select r.id, r.plan_code, r.addons, r.note, r.status, r.created_at, u2.name as requested_by_name from plan_requests r join users u2 on u2.id = r.requested_by
      where r.tenant = ${tenant} order by r.created_at desc limit 10`,
  ]);
  return { tenant, subscription: { planCode: sub.plan_code, planName: sub.plan_name, monthlyKrw: sub.per_user_krw ? sub.per_user_krw * Math.max(1, usage.users) : sub.monthly_krw, perUserKrw: sub.per_user_krw ?? null, addons: sub.addons, periodStart: sub.period_start, periodEnd: sub.period_end, status: sub.status },
    limits, usage, plans, addons, topFiles: top, requests, demo: tenant === 'demo', ai: await aiBreakdown(tenant, sql), canEdit: (await (await import('./menuPerms')).menuLevel(u, 'usage', sql)) === 'edit' };
}

/** V14 4번: 이번 달 AI 사용 — 사람별·기능별, 회사 월 한도($) 대비 %, 원 환산(USD_KRW, 기본 1,400) */
export async function aiBreakdown(tenant: string, sql: Sql = db()) {
  const { usageThisMonth } = await import('./ai/assistant');
  const { aiSettings } = await import('./ai/threads');
  const m = await usageThisMonth(tenant);
  const start = `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7)}-01`;
  const [byUser, byPurpose, [blocked]] = await Promise.all([
    sql`select a.user_id, coalesce(us.name, '(삭제된 사용자)') as name, count(*)::int requests, coalesce(sum(a.cost_usd), 0)::float8 cost
      from ai_usage a left join users us on us.id = a.user_id where a.tenant = ${tenant} and a.created_at >= (${start}::date::timestamp at time zone 'Asia/Seoul') group by a.user_id, us.name order by cost desc limit 50`,
    sql`select a.purpose, count(*)::int requests, coalesce(sum(a.cost_usd), 0)::float8 cost from ai_usage a
      where a.tenant = ${tenant} and a.created_at >= (${start}::date::timestamp at time zone 'Asia/Seoul') group by a.purpose order by cost desc`,
    sql<{ n: number }[]>`select count(*)::int n from ai_messages m join ai_threads t on t.id = m.thread_id where t.tenant = ${tenant} and m.role = 'user' and m.status = 'blocked'
      and m.created_at >= (${start}::date::timestamp at time zone 'Asia/Seoul')`,
  ]);
  const rate = Number(process.env.USD_KRW) || 1400;
  const s = await aiSettings(tenant, sql);
  return { costUsd: m.costUsd, limitUsd: m.limitUsd, pct: m.limitUsd > 0 ? Math.round((m.costUsd / m.limitUsd) * 1000) / 10 : 0, leftUsd: Math.max(0, Math.round((m.limitUsd - m.costUsd) * 100) / 100),
    requests: m.requests, tokens: m.tokens, usdKrw: rate, byUser, byPurpose, blocked: blocked.n, dailyLimit: s.daily_limit, consoleNote: s.console_note };
}

export const planRequestInput = z.object({ planCode: z.string().max(40).optional(), addons: z.record(z.string(), z.number().int().min(0).max(100)).optional(), note: z.string().max(1000).optional() });
export async function requestPlanChange(u: SessionUser, i: z.infer<typeof planRequestInput>) {
  await requireTenantAdmin(u, 'edit');
  if (!i.planCode && !i.addons && !i.note) throw badRequest('바꿀 요금제나 옵션을 고르세요');
  const sql = db();
  if (i.planCode && !(await sql`select 1 from plans where code = ${i.planCode} and public and active`).length) throw badRequest('없는 요금제입니다');
  const tenant = tenantOfUser(u);
  const [r] = await sql<{ id: string }[]>`insert into plan_requests (tenant, requested_by, plan_code, addons, note) values (${tenant}, ${u.id}, ${i.planCode ?? null}, ${i.addons ? sql.json(i.addons) : null}, ${i.note ?? null}) returning id`;
  const admins = (await sql<{ id: string }[]>`select id from users where platform_admin and status = 'active'`).map((x) => x.id);
  await notify(sql, { userIds: admins, type: 'usage_alert', title: '요금제 변경 요청', body: `${tenant} — ${i.planCode ?? '옵션'}${i.note ? ` · ${i.note.slice(0, 60)}` : ''}`, link: '/platform',
    entityType: null as never, entityId: null as never, actorId: u.id, dedupeKey: `planreq:${r.id}` });
  await rememberChosenPlan(tenant, i.planCode);
  await audit(sql, u.id, 'plan.request', null, null, { tenant, ...i }, null);
  return { id: r.id };
}

// ---------------- 플랫폼 운영자 (/platform) ----------------
function requirePlatform(u: SessionUser) {
  if (!u.platformAdmin) throw notFound(); // 있는 줄도 모르게
}
export async function platformOverview(u: SessionUser) {
  requirePlatform(u);
  const sql = db();
  const tenants = await sql<{ id: string; name: string }[]>`select id, name from tenants order by created_at`;
  const rows = await Promise.all(tenants.map(async (t) => {
    const [{ limits, sub }, usage] = await Promise.all([effectiveLimits(t.id, sql), currentUsage(t.id, sql)]);
    const pct = (used: number, lim: number | null) => (lim === null ? null : lim === 0 ? 100 : Math.round((used / lim) * 100));
    const p = { storage: pct(usage.storageBytes / GB, limits.storageGb), ai: pct(usage.aiRequests, limits.aiRequests), users: pct(usage.users, limits.users) };
    return { ...t, planCode: sub.plan_code, planName: sub.plan_name, monthlyKrw: sub.monthly_krw, addons: sub.addons, periodEnd: sub.period_end, status: sub.status, note: sub.note ?? null,
      limits, usage, pct: p, overLimit: Object.values(p).some((x) => x !== null && x >= 100) };
  }));
  const [plans, addons, requests] = await Promise.all([
    sql`select code, name, monthly_krw, per_user_krw, limits, description, public, sort, active from plans order by sort`,
    sql`select code, name, monthly_krw, adds, sort, active from plan_addons order by sort`,
    sql`select r.*, u2.name as requested_by_name, t.name as tenant_name from plan_requests r join users u2 on u2.id = r.requested_by join tenants t on t.id = r.tenant
      order by (r.status = 'pending') desc, r.created_at desc limit 50`,
  ]);
  return { tenants: rows, plans, addons, requests };
}

export const subscriptionInput = z.object({
  planCode: z.string().max(40), addons: z.record(z.string(), z.number().int().min(0).max(1000)).default({}),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), status: z.enum(['active', 'trial', 'suspended']).default('active'), note: z.string().max(1000).nullable().optional(),
});
export async function setSubscription(u: SessionUser, tenant: string, i: z.infer<typeof subscriptionInput>) {
  requirePlatform(u);
  const sql = db();
  if (!(await sql`select 1 from tenants where id = ${tenant}`).length) throw notFound('없는 회사입니다');
  if (!(await sql`select 1 from plans where code = ${i.planCode}`).length) throw badRequest('없는 요금제입니다');
  const bad = Object.keys(i.addons).filter((k) => i.addons[k] > 0);
  if (bad.length && (await sql`select code from plan_addons where code = any(${bad})`).length !== bad.length) throw badRequest('없는 추가 옵션입니다');
  await sql`insert into tenant_subscriptions (tenant, plan_code, addons, period_end, status, note, updated_by)
    values (${tenant}, ${i.planCode}, ${sql.json(i.addons)}, ${i.periodEnd ?? null}, ${i.status}, ${i.note ?? null}, ${u.id})
    on conflict (tenant) do update set plan_code = excluded.plan_code, addons = excluded.addons, period_end = excluded.period_end, status = excluded.status,
      note = excluded.note, updated_by = excluded.updated_by, updated_at = now(), period_start = case when tenant_subscriptions.plan_code <> excluded.plan_code then current_date else tenant_subscriptions.period_start end`;
  await audit(sql, u.id, 'platform.subscription', null, null, { tenant, ...i }, null);
  return { ok: true };
}

export const planInput = z.object({
  name: z.string().trim().min(1).max(50), monthlyKrw: z.number().int().min(0).max(100_000_000).nullable(),
  limits: z.object({ users: z.number().int().min(0).nullable(), storageGb: z.number().min(0).nullable(), aiRequests: z.number().int().min(0).nullable(),
    perUserStorageGb: z.number().min(0).optional(), perUserAi: z.number().int().min(0).optional(), tasksTotal: z.number().int().min(0).nullable().optional() }),
  perUserKrw: z.number().int().min(0).max(1_000_000).nullable().optional(),
  description: z.string().max(200).nullable().optional(), public: z.boolean().optional(), active: z.boolean().optional(), sort: z.number().int().optional(),
});
/** 요금제 숫자 바꾸기(배포 없이) — 없는 코드면 새 요금제 */
export async function upsertPlan(u: SessionUser, code: string, i: z.infer<typeof planInput>) {
  requirePlatform(u);
  if (!/^[a-z0-9_-]{2,40}$/.test(code)) throw badRequest('코드는 영문 소문자·숫자 2~40자');
  const sql = db();
  await sql`insert into plans (code, name, monthly_krw, per_user_krw, limits, description, public, active, sort)
    values (${code}, ${i.name}, ${i.monthlyKrw}, ${i.perUserKrw ?? null}, ${sql.json(i.limits)}, ${i.description ?? null}, ${i.public ?? true}, ${i.active ?? true}, ${i.sort ?? 50})
    on conflict (code) do update set name = excluded.name, monthly_krw = excluded.monthly_krw, per_user_krw = ${i.perUserKrw === undefined ? sql`plans.per_user_krw` : sql`${i.perUserKrw}::int`}, limits = excluded.limits, description = coalesce(excluded.description, plans.description),
      public = coalesce(${i.public ?? null}::boolean, plans.public), active = coalesce(${i.active ?? null}::boolean, plans.active),
      sort = coalesce(${i.sort ?? null}::int, plans.sort), updated_at = now()`;
  await audit(sql, u.id, 'platform.plan', null, null, { code, ...i }, null);
  return { ok: true };
}
export const addonInput = z.object({ name: z.string().trim().min(1).max(50), monthlyKrw: z.number().int().min(0).max(10_000_000), adds: z.record(z.enum(['users', 'storageGb', 'aiRequests']), z.number().min(0)), active: z.boolean().optional() });
export async function upsertAddon(u: SessionUser, code: string, i: z.infer<typeof addonInput>) {
  requirePlatform(u);
  if (!/^[a-z0-9_-]{2,40}$/.test(code)) throw badRequest('코드는 영문 소문자·숫자 2~40자');
  const sql = db();
  await sql`insert into plan_addons (code, name, monthly_krw, adds, active) values (${code}, ${i.name}, ${i.monthlyKrw}, ${sql.json(i.adds)}, ${i.active ?? true})
    on conflict (code) do update set name = excluded.name, monthly_krw = excluded.monthly_krw, adds = excluded.adds, active = excluded.active, updated_at = now()`;
  await audit(sql, u.id, 'platform.addon', null, null, { code, ...i }, null);
  return { ok: true };
}
export async function rememberChosenPlan(tenant: string, code: string | undefined) { if (code) await db()`update tenant_subscriptions set chosen_plan = ${code} where tenant = ${tenant}`; }
export async function decidePlanRequest(u: SessionUser, id: string, approve: boolean) {
  requirePlatform(u);
  const sql = db();
  const [r] = await sql<any[]>`select * from plan_requests where id = ${id}`;
  if (!r) throw notFound();
  if (r.status !== 'pending') throw badRequest('이미 처리한 요청입니다');
  if (approve) {
    const sub = await subscription(r.tenant, sql);
    await setSubscription(u, r.tenant, subscriptionInput.parse({ planCode: r.plan_code ?? sub.plan_code, addons: r.addons ?? sub.addons ?? {}, periodEnd: sub.period_end ? DateTime.fromJSDate(new Date(sub.period_end)).toISODate() : null, status: 'active', note: sub.note ?? null }));
    clearReadOnlyCache(r.tenant);
  }
  await sql`update plan_requests set status = ${approve ? 'approved' : 'rejected'}, decided_by = ${u.id}, decided_at = now() where id = ${id}`;
  await notify(sql, { userIds: [r.requested_by], type: 'usage_alert', title: approve ? '요금제 변경 요청이 반영됐습니다' : '요금제 변경 요청이 반려됐습니다', body: r.plan_code ?? '추가 옵션',
    link: '/admin/usage', entityType: null as never, entityId: null as never, actorId: u.id, dedupeKey: `planreq-done:${id}` });
  return { ok: true };
}

// ---------------- 정기 실행: 월별 기록 + 80%·100% 알림 ----------------
export async function usageJob() {
  const sql = db();
  const month = monthStart().toISODate()!;
  let alerts = 0;
  for (const t of await sql<{ id: string }[]>`select id from tenants`) {
    const [{ limits }, usage] = await Promise.all([effectiveLimits(t.id, sql), currentUsage(t.id, sql)]);
    await sql`insert into tenant_usage (tenant, month, storage_bytes, ai_requests, ai_tokens, active_users) values (${t.id}, ${month}, ${usage.storageBytes}, ${usage.aiRequests}, ${usage.aiTokens}, ${usage.users})
      on conflict (tenant, month) do update set storage_bytes = excluded.storage_bytes, ai_requests = excluded.ai_requests, ai_tokens = excluded.ai_tokens, active_users = excluded.active_users, updated_at = now()`;
    if (t.id === 'demo') continue; // 체험 조직에는 관리자 알림 없음
    const admins = (await sql<{ id: string }[]>`select id from users where role in ('owner','admin') and status = 'active' and tenant = ${t.id}`).map((x) => x.id);
    const checks: [string, string, number, number | null][] = [
      ['storage', '저장공간', usage.storageBytes / GB, limits.storageGb], ['ai', 'AI 요청', usage.aiRequests, limits.aiRequests], ['users', '사용자', usage.users, limits.users],
      ['tasks', '업무 수(완료·휴지통 포함)', usage.tasks, limits.tasksTotal ?? null]];
    for (const [key, label, used, lim] of checks) {
      if (lim === null || lim === 0) continue;
      const pct = (used / lim) * 100;
      const warnAt = key === 'tasks' ? 90 : 80; // V29 3장: 업무는 900/1,000 에서 안내
      const level = pct >= 100 ? 100 : pct >= warnAt ? warnAt : 0;
      if (!level) continue;
      // 저장·사용자는 한 번 넘으면 계속이므로 달마다, AI 는 그 달 기준
      alerts += (await notify(sql, { userIds: admins, type: 'usage_alert', title: `${label} ${level === 100 ? '한도에 도달했습니다' : `${level}%를 넘었습니다`}`,
        body: `${label} ${Math.round(pct)}% 사용 중 — 관리 → 사용량·요금제에서 확인하세요${level === 100 ? (key === 'ai' ? ' (AI 는 다음 달까지 멈춤, 업무·일정은 그대로)' : key === 'tasks' ? ' (새 업무 만들기만 멈춤 — 오래된 완료 업무를 보관 파일로 내보내고 정리)' : ' (새로 올리기·초대만 멈춤, 업무·일정은 그대로)') : key === 'tasks' ? ' — 오래된 완료 업무를 보관 파일로 내보내고 정리할 수 있습니다' : ''}`,
        link: '/admin/usage', entityType: null as never, entityId: null as never, dedupeKey: `usage:${t.id}:${key}:${level}:${month}` })).length;
    }
  }
  return { alerts };
}

// ---------------- V15 공개 가입 관리 (플랫폼 운영자) ----------------
export async function platformSignups(u: SessionUser) {
  requirePlatform(u);
  const sql = db();
  const [tenants, attempts, ips] = await Promise.all([
    sql`select t.id, t.name, t.kind, t.status, t.created_ip, t.created_at, t.onboarded_at, ow.email as owner_email, ow.signup_pending,
          ts.status as sub_status, ts.plan_code, ts.trial_ends_at, ts.chosen_plan,
          (select count(*)::int from users x where x.tenant = t.id and x.status = 'active') as users,
          (select count(*)::int from tasks k join org_units o on o.id = k.org_unit_id where o.tenant = t.id and k.deleted_at is null) as tasks
        from tenants t left join users ow on ow.id = t.owner_user_id left join tenant_subscriptions ts on ts.tenant = t.id where t.id not in ('default','demo') and not t.is_test order by t.created_at desc limit 200`,
    sql`select coalesce(reason, 'ok') as reason, count(*)::int n from signup_attempts where created_at > now() - interval '1 day' group by 1 order by 2 desc`,
    sql`select ip, count(*)::int n, count(*) filter (where ok)::int ok from signup_attempts where created_at > now() - interval '1 day' group by ip order by n desc limit 10`,
  ]);
  return { tenants, attempts, ips };
}
export async function setTenantStatus(u: SessionUser, tenant: string, status: 'active' | 'blocked') {
  requirePlatform(u);
  if (['default', 'demo'].includes(tenant)) throw badRequest('기본 회사는 차단할 수 없습니다');
  const sql = db();
  const [t] = await sql`update tenants set status = ${status} where id = ${tenant} and status <> 'deleted' returning id`;
  if (!t) throw notFound('없는 회사입니다');
  if (status === 'blocked') await sql`update sessions set revoked_at = now() where revoked_at is null and user_id in (select id from users where tenant = ${tenant})`;
  await audit(sql, u.id, status === 'blocked' ? 'tenant.block' : 'tenant.unblock', null, null, { tenant }, null);
  return { ok: true };
}

// ---------------- 17차: 14일 무료 체험 · 끝나면 읽기 전용 ----------------
export const TRIAL_DAYS = 14;
/** 체험 상태: 남은 날(서울 날짜 기준, 0 = 오늘 끝남), 끝났으면 readOnly */
export async function trialInfo(tenant: string, sql: Sql = db()) {
  const [s] = await sql<{ status: string; plan_code: string; trial_ends_at: Date | null; chosen_plan: string | null }[]>`
    select status, plan_code, trial_ends_at, chosen_plan from tenant_subscriptions where tenant = ${tenant}`;
  if (!s) return null;
  const ended = s.status === 'expired' || (s.status === 'trial' && !!s.trial_ends_at && s.trial_ends_at.getTime() <= Date.now());
  if (s.status !== 'trial' && s.status !== 'expired') return null;
  const days = s.trial_ends_at ? Math.max(0, Math.ceil(DateTime.fromJSDate(s.trial_ends_at).setZone(TZ).startOf('day').diff(DateTime.now().setZone(TZ).startOf('day'), 'days').days)) : 0;
  return { trial: !ended, readOnly: ended, daysLeft: ended ? 0 : days, endsAt: s.trial_ends_at, chosenPlan: s.chosen_plan };
}

const roCache = new Map<string, { at: number; ro: boolean; lock: string | null }>();
/** 읽기 전용(체험 끝·미납 7일)이면 쓰기 요청을 막는다. 보기·내보내기·로그인·요금제 신청·알림 읽음·탈퇴는 허용 */
const RO_ALLOW = [/^\/api\/billing/, /^\/api\/auth\//, /^\/api\/account\//, /^\/api\/plan/, /^\/api\/usage/, /^\/api\/push\//, /\/read$/, /^\/api\/notifications/, /^\/api\/export/, /^\/api\/support/, /^\/api\/me\//];
/** V28 B2: 미납 30일 이용 중지 — 로그인해도 결제 안내만(결제·로그인·내보내기·요금 화면만 열림) */
const SUSPEND_ALLOW = [/^\/api\/billing/, /^\/api\/auth\//, /^\/api\/account\//, /^\/api\/usage/, /^\/api\/export/, /^\/api\/support/, /^\/api\/platform/];
async function roState(t: string) {
  const c = roCache.get(t);
  if (c && Date.now() - c.at < 15_000) return c;
  const [s] = await db()<{ billing_lock: string | null }[]>`select billing_lock from tenant_subscriptions where tenant = ${t}`;
  const lock = s?.billing_lock ?? null;
  const v = { at: Date.now(), ro: !!lock || !!(await trialInfo(t))?.readOnly, lock };
  roCache.set(t, v);
  return v;
}
export async function billingLock(t: string) { return t === 'default' || t === 'demo' ? null : (await roState(t)).lock; }
export async function assertWritable(u: SessionUser, path: string) {
  const t = tenantOfUser(u);
  if (t === 'default' || t === 'demo' || RO_ALLOW.some((r) => r.test(path))) return;
  const st = await roState(t);
  if (st.lock === 'suspended') throw new HttpError(402, 'suspended', '미납 30일로 이용이 중지되었습니다 — 관리자가 결제하면 바로 다시 쓸 수 있어요(데이터는 그대로).');
  if (st.ro) throw new HttpError(402, 'read_only', st.lock ? '미납 7일로 읽기 전용입니다 — 결제하면 바로 다시 쓸 수 있어요 (보기·내보내기는 그대로).' : '무료 체험이 끝나 읽기 전용입니다. 요금제를 선택하면 다시 쓸 수 있어요 (보기·내보내기는 그대로).');
}
/** 이용 중지 회사는 보기 요청도 막는다(결제 안내만) */
export async function assertNotSuspended(u: SessionUser, path: string) {
  const t = tenantOfUser(u);
  if (t === 'default' || t === 'demo' || u.support || SUSPEND_ALLOW.some((r) => r.test(path))) return;
  if ((await roState(t)).lock === 'suspended') throw new HttpError(402, 'suspended', '미납 30일로 이용이 중지되었습니다 — 관리자가 결제하면 바로 다시 쓸 수 있어요(데이터는 그대로).');
}
export const clearReadOnlyCache = (t?: string) => (t ? roCache.delete(t) : roCache.clear());

/** 정기 실행: 종료 3·1·0일 전 알림(공간 관리자에게 앱+메일), 끝난 체험은 expired */
export async function trialJob() {
  const sql = db();
  const subs = await sql<{ tenant: string; trial_ends_at: Date; trial_notified: Record<string, boolean>; name: string }[]>`
    select s.tenant, s.trial_ends_at, s.trial_notified, t.name from tenant_subscriptions s join tenants t on t.id = s.tenant
    where s.status = 'trial' and s.trial_ends_at is not null and t.deleted_at is null`;
  let notified = 0, expired = 0;
  for (const s of subs) {
    if (s.trial_ends_at.getTime() <= Date.now()) {
      await sql`update tenant_subscriptions set status = 'expired', updated_at = now() where tenant = ${s.tenant} and status = 'trial'`;
      clearReadOnlyCache(s.tenant); expired++;
    }
    const info = await trialInfo(s.tenant, sql);
    const d = info?.readOnly ? 0 : info?.daysLeft ?? 99;
    const key = d === 0 ? 'd0' : d === 1 ? 'd1' : d <= 3 ? 'd3' : null;
    if (!key || s.trial_notified?.[key]) continue;
    const admins = await sql<{ id: string; email: string }[]>`select id, email from users where tenant = ${s.tenant} and status = 'active' and role in ('owner','admin')`;
    const title = d === 0 ? '무료 체험이 오늘 끝납니다' : `무료 체험이 ${d}일 남았습니다`;
    const body = d === 0 ? '오늘이 지나면 읽기 전용(보기·내보내기만)이 됩니다 — 요금제를 선택해 주세요' : '요금제를 선택하면 끊김 없이 계속 쓸 수 있어요';
    await notify(sql, { userIds: admins.map((a) => a.id), type: 'usage_alert', title, body, link: '/admin/usage', dedupeKey: `trial:${s.tenant}:${key}` });
    const { sendMail } = await import('./mail');
    for (const a of admins) await sendMail(a.email, `[워크인] ${title}`, `${s.name}\n${body}\n${process.env.APP_URL ?? ''}/admin/usage`).catch(() => {});
    await sql`update tenant_subscriptions set trial_notified = trial_notified || ${sql.json({ [key]: true })} where tenant = ${s.tenant}`;
    notified++;
  }
  return { trials: subs.length, notified, expired };
}

export const trialActionInput = z.object({ action: z.enum(['extend', 'end', 'convert']), days: z.number().int().min(1).max(60).optional(), planCode: z.string().max(40).optional() });
/** 플랫폼 운영: 체험 연장(+7/+14일)·즉시 종료(읽기 전용)·유료 전환 */
export async function platformTrial(u: SessionUser, tenant: string, i: z.infer<typeof trialActionInput>) {
  requirePlatform(u);
  const sql = db();
  const [s] = await sql<{ status: string; trial_ends_at: Date | null; chosen_plan: string | null }[]>`select status, trial_ends_at, chosen_plan from tenant_subscriptions where tenant = ${tenant}`;
  if (!s) throw notFound('없는 공간입니다');
  if (i.action === 'extend') {
    const base = s.trial_ends_at && s.trial_ends_at.getTime() > Date.now() ? s.trial_ends_at : new Date();
    const end = new Date(base.getTime() + (i.days ?? 7) * 86400000);
    await sql`update tenant_subscriptions set status = 'trial', trial_ends_at = ${end}, period_end = ${end.toISOString().slice(0, 10)}, trial_notified = '{}', updated_by = ${u.id}, updated_at = now() where tenant = ${tenant}`;
  } else if (i.action === 'end') {
    await sql`update tenant_subscriptions set status = 'expired', trial_ends_at = least(coalesce(trial_ends_at, now()), now()), updated_by = ${u.id}, updated_at = now() where tenant = ${tenant}`;
  } else {
    const code = i.planCode ?? s.chosen_plan;
    if (!code || !(await sql`select 1 from plans where code = ${code} and code not in ('trial','free','team_free','w_free')`).length) throw badRequest('전환할 유료 요금제를 고르세요');
    await sql`update tenant_subscriptions set plan_code = ${code}, status = 'active', period_start = current_date, period_end = null, updated_by = ${u.id}, updated_at = now() where tenant = ${tenant}`;
  }
  clearReadOnlyCache(tenant);
  await audit(sql, u.id, `platform.trial_${i.action}`, 'tenant', null, { tenant, ...i }, null);
  return { ok: true, trial: await trialInfo(tenant, sql) };
}

// ---------------- V29 3장 오래된 완료 업무 보관 파일로 내보내고 정리 ----------------
export const cleanupInput = z.object({ before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식(YYYY-MM-DD)') });
const cleanupWhere = (sql: Sql, tenant: string, before: string) => sql`t.status = 'done' and t.deleted_at is null and t.purged_at is null
  and t.completed_at < (${before}::date::timestamp at time zone 'Asia/Seoul') and t.created_by in (select id from users where tenant = ${tenant})`;
/** 정리 대상 개수(그 날짜 전에 완료한 업무) */
export async function cleanupPreview(u: SessionUser, before: string) {
  await requireTenantAdmin(u, 'edit');
  const sql = db(), tenant = tenantOfUser(u);
  const [r] = await sql<{ n: number }[]>`select count(*)::int n from tasks t where ${cleanupWhere(sql, tenant, before)}`;
  const { limits } = await effectiveLimits(tenant, sql);
  return { before, count: r.n, total: await taskCount(tenant, sql), limit: limits.tasksTotal ?? null };
}
/** 보관 파일(CSV, 엑셀에서 열림) — 정리 전에 먼저 내려받는다 */
export async function cleanupCsv(u: SessionUser, before: string) {
  await requireTenantAdmin(u, 'edit');
  const sql = db(), tenant = tenantOfUser(u);
  const rows = await sql<Record<string, unknown>[]>`select t.title, p.name as project, a.name as assignee, r.name as requester, t.due_date::text due, to_char(t.completed_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') done_at,
      to_char(t.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') created, t.description
    from tasks t left join projects p on p.id = t.project_id left join users a on a.id = t.assignee_id left join users r on r.id = coalesce(t.requested_by, t.created_by)
    where ${cleanupWhere(sql, tenant, before)} order by t.completed_at`;
  const esc = (v: unknown) => { const x = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(x) || /^[=+\-@]/.test(x) ? `"${(/^[=+\-@]/.test(x) ? "'" : '') + x.replace(/"/g, '""')}"` : x; };
  const head = ['제목', '프로젝트', '담당', '지시자', '마감', '완료', '만든 날', '설명'];
  return '\uFEFF' + [head, ...rows.map((r) => [r.title, r.project, r.assignee, r.requester, r.due, r.done_at, r.created, r.description])].map((l) => l.map(esc).join(',')).join('\r\n');
}
/** 정리: 셈·화면·휴지통에서 빠짐(기록은 남김, 되살리기 없음). 보관 파일을 먼저 내려받았는지는 화면에서 확인 */
export async function cleanupApply(u: SessionUser, before: string) {
  await requireTenantAdmin(u, 'edit');
  const sql = db(), tenant = tenantOfUser(u);
  const done = await sql<{ id: string }[]>`update tasks t set deleted_at = now(), purged_at = now(), updated_at = now(), version = version + 1 where ${cleanupWhere(sql, tenant, before)} returning t.id`;
  await audit(sql, u.id, 'tasks.cleanup', null, null, { before, count: done.length }, null);
  return { ok: true, purged: done.length, total: await taskCount(tenant, sql) };
}
