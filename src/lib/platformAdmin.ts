import { z } from 'zod';
import { db } from './db';
import { newToken, sha256 } from './crypto';
import { HttpError, badRequest, conflict, forbidden, notFound } from './errors';
import { audit } from './log';
import { appUrl, sendMail } from './mail';
import { tenantOf, type SessionUser } from './types';

/**
 * V28-3 슈퍼 계정(플랫폼 운영자) — 고객사 전체 관리. 플랫폼 운영자(users.platform_admin)만, 다른 사람에게는 404.
 * 비밀번호는 보거나 정하지 않는다(재설정 메일만). 지원 모드는 고객사 대표가 허용한 회사만, 읽기 전용·30분·모든 요청 감사 기록.
 */
const INTERNAL = ['default', 'demo'];
function requirePlatform(u: SessionUser) {
  if (!u.platformAdmin || u.support) throw notFound(); // 있는 줄도 모르게(지원 모드 중에는 운영 화면 막음)
}

export type Stage = 'trial' | 'paid' | 'hold' | 'churned';
export const STAGE_LABEL: Record<Stage, string> = { trial: '체험', paid: '유료', hold: '보류', churned: '해지' };
/** #656 고객사 단계: 운영자가 직접 정한 값이 있으면 그것, 없으면 구독 상태에서 자동(체험 → 체험, 체험 끝·중지 → 보류, 사용 중 → 유료, 정지·삭제 예약 → 해지) */
export function stageOf(t: { lifecycle?: string | null; status?: string | null; delete_scheduled_at?: Date | string | null; sub_status?: string | null }): Stage {
  if (t.lifecycle) return t.lifecycle as Stage;
  if ((t.status && t.status !== 'active') || t.delete_scheduled_at) return 'churned';
  if (t.sub_status === 'trial') return 'trial';
  if (t.sub_status === 'expired' || t.sub_status === 'suspended') return 'hold';
  return 'paid';
}
export async function tenantDirectory(u: SessionUser, q: { q?: string; status?: string; segment?: string; stage?: string }) {
  requirePlatform(u);
  const sql = db();
  const term = (q.q ?? '').trim();
  const like = `%${term.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const rows: any[] = await sql`
    select t.id, t.name, t.kind, t.status, t.is_test, t.created_at, t.delete_scheduled_at, t.support_consent_at, ow.email as owner_email, (ow.status = 'invited') as owner_invited,
      t.contact_name, t.contact_phone, t.contact_title, t.segment, t.source, t.lifecycle, t.lifecycle_note, t.lifecycle_at, t.industries, t.size_band, t.platform_memo,
      ts.plan_code, ts.status as sub_status, ts.trial_ends_at, ts.limit_overrides, ts.discount_pct, to_char(ts.discount_until, 'YYYY-MM-DD') as discount_until,
      ts.billing_cycle, ts.next_billing_on, ts.billing_amount, ts.past_due_since, ts.billing_lock, ts.billing_grace_until,
      (select count(*)::int from users x where x.tenant = t.id and x.status = 'active' and x.last_login_at > now() - interval '7 days') as active7,
      (select max(l.at) from tenant_contact_logs l where l.tenant = t.id) as last_contact_at,
      (select to_char(l.next_at, 'YYYY-MM-DD') from tenant_contact_logs l where l.tenant = t.id and l.next_at is not null order by l.at desc, l.created_at desc limit 1) as next_contact_at,
      (select json_build_object('at', coalesce(p.paid_at, p.created_at), 'status', p.status, 'amount', p.amount, 'msg', p.result_msg) from payments p where p.tenant = t.id order by p.created_at desc limit 1) as last_payment,
      (select count(*)::int from users x where x.tenant = t.id and x.status = 'active') as users,
      (select max(x.last_login_at) from users x where x.tenant = t.id) as last_login_at,
      (select storage_bytes from tenant_usage tu where tu.tenant = t.id order by month desc limit 1)::float8 as storage_bytes,
      (select count(distinct coalesce(a.request_id::text, a.id::text))::int from ai_usage a where a.tenant = t.id and a.created_at >= date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') as ai_requests,
      (select coalesce(sum(a.cost_krw), 0)::float8 from ai_usage a where a.tenant = t.id and a.created_at >= date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') as ai_krw
    from tenants t left join users ow on ow.id = t.owner_user_id left join tenant_subscriptions ts on ts.tenant = t.id
    where (${term} = '' or t.name ilike ${like} or t.id ilike ${like} or coalesce(ow.email, '') ilike ${like})
      and not (t.is_test and t.deleted_at is not null) -- #566 숨긴 결제 시험 회사는 목록에서 뺌(결제 기록은 결제 내역에 남음)
      and (${q.status ?? ''} = '' or t.status = ${q.status ?? ''} or (${q.status ?? ''} = 'trial' and ts.status in ('trial', 'expired')) or (${q.status ?? ''} = 'deleting' and t.delete_scheduled_at is not null))
      and (${q.segment ?? ''} = '' or coalesce(t.segment, 'customer') = ${q.segment ?? ''}) -- #656 구분(설계 파트너/일반)
    order by (t.id in ('default', 'demo')) desc, t.created_at desc limit 300`;
  // #412 회사별 AI 잔여(업무·영업 공유 요청 수 · 마케팅 크레딧) + 플랫폼 전체 원가·마진 한 줄(이달 AI 원가 합계 vs 요금 합계 VAT 제외)
  const P = await import('./plans'); const M = await import('./mktAuto');
  const monthStart = `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7)}-01`;
  const [mktPlans, mktSettings, mktUsed] = await Promise.all([
    M.planTable(),
    sql<{ tenant: string; plan_code: string | null; monthly_credits: number | null }[]>`select tenant, plan_code, monthly_credits::float8 monthly_credits from mkt_settings`.catch(() => []),
    sql<{ tenant: string; credits: number }[]>`select tenant, coalesce(sum(credits), 0)::float8 credits from mkt_credit_ledger where created_at >= (${monthStart}::date::timestamp at time zone 'Asia/Seoul') group by tenant`.catch(() => []),
  ]);
  const B = await import('./ai/companyBudget');
  const tenants = await Promise.all(rows.map(async (r) => {
    const { limits } = await P.effectiveLimits(r.id, sql).catch(() => ({ limits: { aiRequests: null } as { aiRequests: number | null } }));
    const budget = await B.companyAiBudget(r.id, sql).catch(() => null); // 대표 10/24 ② 회사 월 AI 예산(원)
    const ms = mktSettings.find((x) => x.tenant === r.id);
    const creditsLimit = ms ? ms.monthly_credits ?? (ms.plan_code ? mktPlans[ms.plan_code]?.monthlyCredits ?? null : null) : null;
    const creditsUsed = mktUsed.find((x) => x.tenant === r.id)?.credits ?? 0;
    const aiLimit = limits.aiRequests ?? null;
    return { ...r, stage: stageOf(r), ai_limit_requests: aiLimit, ai_left_requests: aiLimit === null ? null : Math.max(0, aiLimit - Number(r.ai_requests)),
      ai_budget: budget ? { source: budget.source, limitKrw: budget.limitKrw, usedKrw: budget.usedKrw, pct: budget.pct, over: budget.over } : null,
      mkt_plan_code: ms?.plan_code ?? null, mkt_credits_limit: creditsLimit, mkt_credits_used: creditsUsed, mkt_credits_left: creditsLimit === null ? null : Math.max(0, Math.round((creditsLimit - creditsUsed) * 10) / 10) };
  }));
  const customers = tenants.filter((t) => !INTERNAL.includes(t.id) && !t.is_test);
  const aiCostKrw = Math.round(tenants.reduce((a, t) => a + Number(t.ai_krw ?? 0), 0));
  const customerAiCostKrw = Math.round(customers.reduce((a, t) => a + Number(t.ai_krw ?? 0), 0));
  const revenueKrw = Math.round(customers.reduce((a, t) => a + (t.billing_amount ? (t.billing_cycle === 'annual' ? Number(t.billing_amount) / 12 : Number(t.billing_amount)) / 1.1 : 0), 0));
  const summary = { month: monthStart.slice(0, 7), aiCostKrw, customerAiCostKrw, revenueKrw, marginKrw: revenueKrw - customerAiCostKrw, marginPct: revenueKrw > 0 ? Math.round(((revenueKrw - customerAiCostKrw) / revenueKrw) * 1000) / 10 : null,
    customers: customers.length, paying: customers.filter((t) => t.billing_amount).length,
    contactDue: customers.filter((t) => t.next_contact_at && t.next_contact_at <= kstDay()).length }; // #656 오늘까지 연락할 곳
  const stage = (q.stage ?? '').trim();
  return { tenants: stage ? tenants.filter((t) => t.stage === stage) : tenants, summary };
}

export async function tenantAdminDetail(u: SessionUser, tenant: string) {
  requirePlatform(u);
  const sql = db();
  const [t] = await sql`select t.*, ow.email as owner_email from tenants t left join users ow on ow.id = t.owner_user_id where t.id = ${tenant}`;
  if (!t) throw notFound('없는 회사입니다');
  const P = await import('./plans');
  const [{ limits, sub }, usage, users, support, payments, aiBudget] = await Promise.all([
    P.effectiveLimits(tenant, sql), P.currentUsage(tenant, sql),
    sql`select id, name, email, role, status, last_login_at, (totp_enabled_at is not null) as totp, platform_admin, created_at from users where tenant = ${tenant} and deleted_at is null order by (role = 'owner') desc, name`,
    sql`select s.created_at, s.expires_at, s.ended_at, s.reason, a.name as admin_name from support_sessions s join users a on a.id = s.admin_id where s.tenant = ${tenant} order by s.created_at desc limit 10`,
    sql`select p.id, p.kind, p.plan_code, p.amount, p.status, p.canceled_amount, p.result_msg, p.paid_at, p.created_at, s.status as settlement, to_char(s.expected_on, 'YYYY-MM-DD') as expected_on, to_char(s.settled_on, 'YYYY-MM-DD') as settled_on
      from payments p left join payment_settlements s on s.payment_id = p.id where p.tenant = ${tenant} order by p.created_at desc limit 12`, // V32 2 정산 상태 같이
    import('./ai/companyBudget').then((B) => B.companyAiBudget(tenant, sql)), // 대표 10/24 ② 회사 월 AI 예산(원)·내역
  ]);
  // V28 B2: 이번 달 청구 예정(정기 결제 금액, VAT 포함)·미납·AI 원가율 · #656 할인(기한 안이면 다음 결제 견적에 반영)
  const [b] = await sql<any[]>`select billing_cycle, next_billing_on, billing_amount, past_due_since, billing_lock, billing_grace_until, plan_code, discount_pct, to_char(discount_until, 'YYYY-MM-DD') as discount_until, discount_note from tenant_subscriptions where tenant = ${tenant}`;
  const [{ krw }] = await sql<{ krw: number }[]>`select coalesce(sum(cost_krw), 0)::float8 krw from ai_usage where tenant = ${tenant} and created_at >= date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'`;
  const nextQuote = b?.billing_cycle && b.plan_code ? await (await import('./billing')).quote(tenant, b.plan_code, b.billing_cycle, sql).catch(() => null) : null;
  const charge = nextQuote ? nextQuote.amount : b?.billing_amount ?? 0; // 다음 결제 금액(할인 반영) — 견적이 안 되면 마지막 결제 금액
  const monthly = charge ? (b.billing_cycle === 'annual' ? Math.round(charge / 12) : charge) : 0;
  const billing = { ...(b ?? {}), expectedThisMonth: monthly, discountApplied: discountActive(b) ? Number(b.discount_pct) : 0, unpaid: b?.past_due_since ? b.billing_amount : 0, aiCostKrw: Math.round(krw), aiCostRate: monthly ? Math.round((krw / (monthly / 1.1)) * 1000) / 10 : null };
  const contacts = await sql`select l.id, l.kind, l.at, l.summary, to_char(l.next_at, 'YYYY-MM-DD') as next_at, l.created_at, c.name as by_name from tenant_contact_logs l left join users c on c.id = l.created_by where l.tenant = ${tenant} order by l.at desc, l.created_at desc limit 100`;
  const stage = stageOf({ lifecycle: t.lifecycle, status: t.status, delete_scheduled_at: t.delete_scheduled_at, sub_status: sub.status });
  // 대표 10/20 ① 고객사 추가로 만든 회사: 대표가 아직 초대를 안 받았으면 '초대 대기'(다시 보내기)
  const [inv] = await sql<{ expires_at: Date; created_at: Date }[]>`select expires_at, created_at from invitations where user_id = ${t.owner_user_id} and accepted_at is null and revoked_at is null order by created_at desc limit 1`;
  const ownerInvite = t.owner_user_id && users.find((x: any) => x.id === t.owner_user_id)?.status === 'invited' ? { pending: true, expiresAt: inv?.expires_at ?? null, expired: !inv || new Date(inv.expires_at) < new Date() } : { pending: false };
  const captureEvents30d = await (await import('./capturePolicy')).captureEventCount(tenant, sql); // #626 최근 30일 캡처·인쇄·자동화 사건 수
  return { ownerInvite, captureEvents30d, billing, payments, tenant: t, stage, contacts, subscription: { planCode: sub.plan_code, planName: sub.plan_name, status: sub.status, trialEndsAt: sub.trial_ends_at ?? null, overrides: sub.limit_overrides ?? {}, addons: sub.addons ?? {} }, limits, usage, users, support, aiBudget,
    mktWrite: await (await import('./mktPlans')).tenantWriteView(tenant).catch(() => null) }; // 대표 10/24 추가 ① 마케팅 글 모델
}

export const overrideInput = z.object({
  users: z.number().int().min(0).max(100000).nullable().optional(), storageGb: z.number().min(0).max(100000).nullable().optional(), aiRequests: z.number().int().min(0).max(10_000_000).nullable().optional(),
  tasksTotal: z.number().int().min(0).max(100_000_000).nullable().optional(),
  aiBudgetKrw: z.number().int().min(0).max(100_000_000).nullable().optional(), // 대표 10/24 ② 회사 월 AI 예산(원) — null = 무제한
  clear: z.array(z.enum(['users', 'storageGb', 'aiRequests', 'tasksTotal', 'aiBudgetKrw'])).optional(),
});
/** 인원·저장·AI 한도 개별 조정(요금제 대신). clear 에 넣은 항목은 요금제 값으로 되돌림. AI 크레딧 지급 = aiBudgetKrw(원 예산 요금제)·aiRequests(예전 요금제)를 올려 주는 것 */
export async function setLimitOverrides(u: SessionUser, tenant: string, i: z.infer<typeof overrideInput>, ip: string | null) {
  requirePlatform(u);
  const sql = db();
  const [s] = await sql<{ limit_overrides: Record<string, unknown> }[]>`select limit_overrides from tenant_subscriptions where tenant = ${tenant}`;
  if (!s) throw notFound('요금제가 없는 회사입니다 — 먼저 요금제를 지정하세요');
  const next: Record<string, unknown> = { ...(s.limit_overrides ?? {}) };
  for (const k of ['users', 'storageGb', 'aiRequests', 'tasksTotal', 'aiBudgetKrw'] as const) if (i[k] !== undefined) next[k] = i[k];
  for (const k of i.clear ?? []) delete next[k];
  await sql`update tenant_subscriptions set limit_overrides = ${sql.json(next as never)}, updated_by = ${u.id}, updated_at = now() where tenant = ${tenant}`;
  await audit(sql, u.id, 'platform.limit_overrides', 'tenant', null, { tenant, ...next }, ip);
  return { ok: true, overrides: next };
}

/** 삭제 예약(30일 유예) → 예약일이 지나면 [영구 삭제 실행](회사 이름 다시 입력). 예약 중에는 취소 가능, 정지(차단)는 따로 */
export const deleteInput = z.object({ action: z.enum(['schedule', 'cancel', 'execute']), confirmName: z.string().max(100).optional() });
export async function tenantDeletion(u: SessionUser, tenant: string, i: z.infer<typeof deleteInput>, ip: string | null) {
  requirePlatform(u);
  if (INTERNAL.includes(tenant)) throw badRequest('기본 회사는 삭제할 수 없습니다');
  const sql = db();
  const [t] = await sql<{ name: string; status: string; delete_scheduled_at: Date | null }[]>`select name, status, delete_scheduled_at from tenants where id = ${tenant}`;
  if (!t || t.status === 'deleted') throw notFound('없는 회사입니다');
  if (i.action !== 'cancel' && i.confirmName !== t.name) throw badRequest('회사 이름이 일치하지 않습니다(확인용으로 정확히 입력)');
  if (i.action === 'schedule') {
    await sql`update tenants set delete_scheduled_at = now() + interval '30 days' where id = ${tenant}`;
    const admins = (await sql<{ id: string; email: string }[]>`select id, email from users where tenant = ${tenant} and status = 'active' and role in ('owner', 'admin')`);
    const { notify } = await import('./notifications');
    await notify(sql, { userIds: admins.map((a) => a.id), type: 'usage_alert', title: '워크인 공간 삭제가 예약되었습니다', body: '30일 뒤 삭제됩니다 — 필요한 자료는 설정 > 내보내기로 받아 두세요. 문의는 고객센터로.',
      link: '/settings', dedupeKey: `tenant-delete:${tenant}:${Date.now()}` });
    for (const a of admins) await sendMail(a.email, '[워크인] 공간 삭제 예약 안내', `${t.name} 공간 삭제가 예약되었습니다(30일 뒤).\n필요한 자료는 설정 > 내보내기로 받아 두세요.\n${appUrl()}/settings`).catch(() => {});
  } else if (i.action === 'cancel') {
    await sql`update tenants set delete_scheduled_at = null where id = ${tenant}`;
  } else {
    if (!t.delete_scheduled_at || t.delete_scheduled_at.getTime() > Date.now()) throw badRequest('삭제 예약 후 30일이 지나야 영구 삭제할 수 있습니다');
    const { anonymize } = await import('./account');
    await sql.begin(async (tx) => {
      await tx`update tenants set status = 'deleted', deleted_at = now() where id = ${tenant}`;
      for (const r of await tx<{ id: string }[]>`select id from users where tenant = ${tenant}`) await anonymize(tx, r.id);
    });
  }
  await audit(sql, u.id, `platform.tenant_${i.action}_delete`, 'tenant', null, { tenant }, ip);
  return { ok: true };
}

// ---------------- 사용자 ----------------
async function loadTargetUser(u: SessionUser, userId: string) {
  requirePlatform(u);
  const [t] = await db()<{ id: string; tenant: string; email: string; name: string; status: string; platform_admin: boolean }[]>`select id, tenant, email, name, status, platform_admin from users where id = ${userId} and deleted_at is null`;
  if (!t) throw notFound('없는 사용자입니다');
  if (t.id === u.id) throw badRequest('본인 계정은 여기서 바꿀 수 없습니다');
  return t;
}
export const userActionInput = z.object({ action: z.enum(['lock', 'unlock', 'reset_password', 'reset_2fa']) });
export async function platformUserAction(u: SessionUser, userId: string, i: z.infer<typeof userActionInput>, ip: string | null) {
  const t = await loadTargetUser(u, userId);
  const sql = db();
  let out: Record<string, unknown> = { ok: true };
  if (i.action === 'lock') {
    if (t.platform_admin) throw forbidden('플랫폼 운영자 계정은 잠글 수 없습니다');
    await sql`update users set status = 'disabled', updated_at = now() where id = ${t.id} and status = 'active'`;
    await sql`update sessions set revoked_at = now() where user_id = ${t.id} and revoked_at is null`;
  } else if (i.action === 'unlock') {
    await sql`update users set status = 'active', updated_at = now() where id = ${t.id} and status = 'disabled'`;
  } else if (i.action === 'reset_2fa') {
    await sql`update users set totp_secret = null, totp_enabled_at = null, updated_at = now() where id = ${t.id}`;
    await sql`update sessions set revoked_at = now() where user_id = ${t.id} and revoked_at is null`;
  } else {
    // 비밀번호를 보거나 정하지 않는다 — 본인 메일로 재설정 링크(24시간)
    if (t.status !== 'active') throw badRequest('활성 사용자만 재설정할 수 있습니다');
    const token = newToken();
    await sql`insert into password_resets (token_hash, user_id, created_by, expires_at) values (${sha256(token)}, ${t.id}, ${u.id}, now() + interval '24 hours')`;
    const r = await sendMail(t.email, '[워크인] 비밀번호 재설정', `${t.name}님, 워크인 운영팀 요청으로 비밀번호 재설정 링크를 보냅니다(24시간 유효).\n\n${appUrl()}/reset/${token}\n\n요청하지 않았다면 이 메일을 무시하세요.`);
    out = { ok: true, sentTo: t.email, ...(r === 'dev' ? { devLink: `/reset/${token}` } : {}) };
  }
  await audit(sql, u.id, `platform.user_${i.action}`, 'user', t.id, { tenant: t.tenant }, ip);
  return out;
}

// ---------------- 지원 모드(대리 접속, 읽기 전용) ----------------
export const SUPPORT_COOKIE = 'wos_support';
const SUPPORT_MIN = 30;
/** 고객사 대표: 설정에서 "워크인 지원 모드 허용" 켜고 끄기 */
export async function setSupportConsent(u: SessionUser, on: boolean, ip: string | null) {
  if (u.role !== 'owner' || u.isDemo || u.support) throw forbidden('공간 대표만 바꿀 수 있습니다');
  const sql = db();
  await sql`update tenants set support_consent_at = ${on ? sql`now()` : null}, support_consent_by = ${on ? u.id : null} where id = ${tenantOf(u)}`;
  if (!on) await sql`update support_sessions set ended_at = now() where tenant = ${tenantOf(u)} and ended_at is null`;
  await audit(sql, u.id, on ? 'support.consent_on' : 'support.consent_off', null, null, {}, ip);
  return { ok: true, consent: on };
}
export async function supportConsent(u: SessionUser) {
  const [t] = await db()<{ support_consent_at: Date | null }[]>`select support_consent_at from tenants where id = ${tenantOf(u)}`;
  return { consent: !!t?.support_consent_at, since: t?.support_consent_at ?? null };
}
export const supportInput = z.object({ reason: z.string().trim().min(2, '지원 사유를 적어 주세요').max(300) });
export async function startSupport(u: SessionUser, tenant: string, i: z.infer<typeof supportInput>, ip: string | null) {
  requirePlatform(u);
  const sql = db();
  const [t] = await sql<{ name: string; status: string; support_consent_at: Date | null; owner_user_id: string | null }[]>`select name, status, support_consent_at, owner_user_id from tenants where id = ${tenant}`;
  if (!t || t.status !== 'active') throw notFound('없는 회사입니다');
  if (!t.support_consent_at) throw new HttpError(403, 'no_consent', '이 회사는 지원 모드를 허용하지 않았습니다 — 고객사 대표가 설정에서 "워크인 지원 모드 허용"을 켜야 합니다');
  const [target] = await sql<{ id: string }[]>`select id from users where id = ${t.owner_user_id} and status = 'active'`;
  if (!target) throw badRequest('대표 계정이 없습니다');
  const token = newToken();
  await sql`insert into support_sessions (id, admin_id, tenant, target_user_id, reason, expires_at) values (${sha256(token)}, ${u.id}, ${tenant}, ${target.id}, ${i.reason}, now() + make_interval(mins => ${SUPPORT_MIN}))`;
  await audit(sql, u.id, 'support.start', 'tenant', null, { tenant, reason: i.reason }, ip);
  return { token, maxAge: SUPPORT_MIN * 60, tenantName: t.name };
}
/** 쿠키 토큰 → 지원 대상(대표) + 운영자. 플랫폼 운영자 본인 로그인이 살아 있어야 한다 */
export async function supportFromToken(token: string, admin: SessionUser) {
  if (!admin.platformAdmin) return null;
  const [s] = await db()<{ target_user_id: string; tenant: string; expires_at: Date; name: string }[]>`select s.target_user_id, s.tenant, s.expires_at, t.name from support_sessions s join tenants t on t.id = s.tenant
    where s.id = ${sha256(token)} and s.admin_id = ${admin.id} and s.ended_at is null and s.expires_at > now() and t.support_consent_at is not null`;
  return s ?? null;
}
export async function endSupport(token: string | undefined) {
  if (token) await db()`update support_sessions set ended_at = now() where id = ${sha256(token)} and ended_at is null`;
  return { ok: true };
}

// ---------------- 대표 10/20 11:40 ① 플랫폼 운영 [고객사 추가]·공간·메모·감사 (대신 보기 없음 — 지원 모드는 고객사 동의가 있을 때만) ----------------
export const newTenantInput = z.object({
  company: z.string().trim().min(1, '회사명을 적어 주세요').max(60), industries: z.array(z.string().trim().min(1).max(30)).max(8).default([]), size: z.enum(['1', '2-10', '11-30', '31-100', '100+']).optional(),
  ownerName: z.string().trim().min(1, '대표 이름을 적어 주세요').max(50), ownerEmail: z.string().trim().toLowerCase().email('대표 이메일을 확인해 주세요').max(200),
  planCode: z.string().trim().max(40).optional(), // 비우거나 'trial' = 14일 체험(trialDays 로 조정)
  trialDays: z.number().int().min(1).max(90).optional(), spaces: z.array(z.enum(['sales', 'marketing'])).max(2).default([]), memo: z.string().max(2000).optional(),
  // #656: 담당자(비우면 대표)·연락처·직책, 구분(설계 파트너 체험단/일반), 소개 경로
  contactName: z.string().trim().max(50).optional(), contactPhone: z.string().trim().max(30).optional(), contactTitle: z.string().trim().max(30).optional(),
  segment: z.enum(['partner', 'customer']).optional(), source: z.string().trim().max(100).optional() });
const inviteMail = (company: string, ownerName: string, link: string) => `${ownerName}님, 워크인에 "${company}" 회사가 만들어졌습니다.\n아래 링크에서 비밀번호를 정하면 대표 계정으로 바로 시작할 수 있습니다 (7일 유효).\n\n${link}\n\n모르는 초대라면 이 메일을 무시해 주세요.`;
/** 메일이 안 가도(미설정·발송 실패) 회사 만들기는 성공 — 운영자가 링크를 직접 전달한다 */
async function tryMail(to: string, subject: string, text: string): Promise<'sent' | 'dev' | 'failed'> { try { return await sendMail(to, subject, text); } catch { return 'failed'; } }
/** [고객사 추가]: 회사(+대표 계정·본사 조직·달력·업종 템플릿) 만들고 대표에게 초대 메일 — 비밀번호는 대표가 직접 정한다 */
export async function createTenantByPlatform(u: SessionUser, i: z.infer<typeof newTenantInput>, ip: string | null) {
  requirePlatform(u);
  const sql = db();
  if ((await sql`select 1 from users where lower(email) = ${i.ownerEmail}`).length) throw conflict('이미 쓰는 이메일입니다 — 다른 회사의 계정이거나 이미 가입한 사람입니다');
  const plan = i.planCode && i.planCode !== 'trial' ? i.planCode : null;
  if (plan && !(await sql`select 1 from plans where code = ${plan} and active`).length) throw badRequest('없는 요금제 코드입니다');
  const { createOwnerSpace } = await import('./signup');
  const token = newToken();
  const inds = [...new Set(i.industries.map((x) => x.trim()).filter(Boolean))];
  const r = await sql.begin(async (tx) => {
    const userId = await createOwnerSpace(tx, { email: i.ownerEmail, name: i.ownerName, mode: 'team', company: i.company, size: i.size, industry: inds[0], industries: inds, agree: {}, passwordHash: null, pending: false, ip });
    const [{ tenant }] = await tx<{ tenant: string }[]>`select tenant from users where id = ${userId}`;
    await tx`update users set status = 'invited', updated_at = now() where id = ${userId}`; // 초대를 받으면 active
    await tx`update tenants set spaces = ${['work', ...new Set(i.spaces)]}, platform_memo = ${i.memo?.trim() || null},
      contact_name = ${i.contactName?.trim() || null}, contact_phone = ${i.contactPhone?.trim() || null}, contact_title = ${i.contactTitle?.trim() || null}, segment = ${i.segment ?? null}, source = ${i.source?.trim() || null} where id = ${tenant}`; // #656
    if (plan) await tx`update tenant_subscriptions set plan_code = ${plan}, status = 'active', trial_ends_at = null, period_end = null where tenant = ${tenant}`;
    else if (i.trialDays) await tx`update tenant_subscriptions set trial_ends_at = now() + ${i.trialDays} * interval '1 day', period_end = (now() + ${i.trialDays} * interval '1 day')::date where tenant = ${tenant}`;
    const [hq] = await tx<{ id: string }[]>`select id from org_units where tenant = ${tenant} and type = 'hq' order by sort limit 1`;
    await tx`insert into invitations (email, name, role, org_unit_ids, token_hash, invited_by, user_id, expires_at) values (${i.ownerEmail}, ${i.ownerName}, 'owner', ${hq ? [hq.id] : []}, ${sha256(token)}, ${u.id}, ${userId}, now() + interval '7 days')`;
    await audit(tx, u.id, 'platform.tenant_create', 'tenant', tenant, { company: i.company, ownerEmail: i.ownerEmail, plan: plan ?? `trial${i.trialDays ? `(${i.trialDays}d)` : ''}`, spaces: i.spaces, industries: inds, segment: i.segment ?? null }, ip);
    return { tenant, userId };
  });
  const m = await tryMail(i.ownerEmail, `[워크인] ${i.company} 대표 계정 초대`, inviteMail(i.company, i.ownerName, `${appUrl()}/invite/${token}`));
  return { ok: true, tenant: r.tenant, ownerUserId: r.userId, mail: m, inviteLink: `/invite/${token}` }; // 링크는 직원 초대와 같이 운영자에게도 보여 직접 전달 가능
}
/** 대표가 아직 초대를 안 받았을 때 초대 메일 다시 보내기(새 링크, 이전 링크는 무효) */
export async function reinviteOwner(u: SessionUser, tenant: string, ip: string | null) {
  requirePlatform(u);
  const sql = db();
  const [t] = await sql<{ owner_user_id: string | null; name: string }[]>`select owner_user_id, name from tenants where id = ${tenant}`;
  if (!t?.owner_user_id) throw notFound('없는 회사입니다');
  const [ow] = await sql<{ id: string; email: string; name: string; status: string }[]>`select id, email, name, status from users where id = ${t.owner_user_id}`;
  if (!ow || ow.status !== 'invited') throw badRequest('이미 초대를 받은 대표입니다');
  const token = newToken();
  const [hq] = await sql<{ id: string }[]>`select id from org_units where tenant = ${tenant} and type = 'hq' order by sort limit 1`;
  await sql.begin(async (tx) => {
    await tx`update invitations set revoked_at = now() where user_id = ${ow.id} and accepted_at is null and revoked_at is null`;
    await tx`insert into invitations (email, name, role, org_unit_ids, token_hash, invited_by, user_id, expires_at) values (${ow.email}, ${ow.name}, 'owner', ${hq ? [hq.id] : []}, ${sha256(token)}, ${u.id}, ${ow.id}, now() + interval '7 days')`;
    await audit(tx, u.id, 'platform.tenant_reinvite', 'tenant', tenant, { ownerEmail: ow.email }, ip);
  });
  const m = await tryMail(ow.email, `[워크인] ${t.name} 대표 계정 초대`, inviteMail(t.name, ow.name, `${appUrl()}/invite/${token}`));
  return { ok: true, mail: m, inviteLink: `/invite/${token}` };
}
export const tenantSpacesInput = z.object({ spaces: z.array(z.enum(['sales', 'marketing'])).max(2) });
/** 고객사 공간(영업·마케팅) 켜기/끄기 — 업무 공간은 항상 */
export async function setTenantSpacesByPlatform(u: SessionUser, tenant: string, i: z.infer<typeof tenantSpacesInput>, ip: string | null) {
  requirePlatform(u);
  const sql = db();
  const r = await sql`update tenants set spaces = ${['work', ...new Set(i.spaces)]} where id = ${tenant} returning id`;
  if (!r.length) throw notFound('없는 회사입니다');
  await audit(sql, u.id, 'platform.tenant_spaces', 'tenant', tenant, { spaces: i.spaces }, ip);
  return { ok: true };
}
export const tenantMemoInput = z.object({ memo: z.string().max(2000) });
export async function setTenantMemo(u: SessionUser, tenant: string, i: z.infer<typeof tenantMemoInput>, ip: string | null) {
  requirePlatform(u);
  const sql = db();
  const r = await sql`update tenants set platform_memo = ${i.memo.trim() || null} where id = ${tenant} returning id`;
  if (!r.length) throw notFound('없는 회사입니다');
  await audit(sql, u.id, 'platform.tenant_memo', 'tenant', tenant, {}, ip);
  return { ok: true };
}
/** 고객사 감사 기록: 운영자가 이 회사에 한 일 + 이 회사 사람들의 주요 기록(최근 100건) */
export async function tenantAuditLog(u: SessionUser, tenant: string) {
  requirePlatform(u);
  const sql = db();
  if (!(await sql`select 1 from tenants where id = ${tenant}`).length) throw notFound('없는 회사입니다');
  const rows = await sql`select a.id::text as id, a.action, a.target_type, a.target_id, a.detail, a.created_at, ac.name as actor_name, ac.platform_admin as by_platform
    from audit_logs a left join users ac on ac.id = a.actor_id
    where (a.target_type = 'tenant' and a.target_id = ${tenant}) or ac.tenant = ${tenant}
    order by a.created_at desc limit 100`;
  return { logs: rows };
}

/** #565 플랫폼 운영 맨 위 '오늘 볼 것' — 신규 가입(7일)·결제 실패(7일)와 밀린 결제·답 안 한 문의·수집 실패(24시간)·이번 달 AI 원가. 시험 회사는 뺌 */
export async function platformToday(u: SessionUser) {
  requirePlatform(u);
  const [r] = await db()<any[]>`select
      (select count(*)::int from tenants t where not t.is_test and t.deleted_at is null and t.id not in ('default', 'demo') and t.created_at > now() - interval '7 days') as signups,
      (select count(*)::int from payments p join tenants t on t.id = p.tenant where not t.is_test and p.status = 'failed' and p.created_at > now() - interval '7 days') as pay_failed,
      (select count(*)::int from tenant_subscriptions s join tenants t on t.id = s.tenant where not t.is_test and t.deleted_at is null and s.past_due_since is not null) as past_due,
      (select count(*)::int from support_tickets where status = 'open') as open_tickets,
      (select count(distinct slug)::int from sales_collector_runs where status = 'failed' and started_at > now() - interval '24 hours') as collector_failed,
      (select coalesce(sum(cost_krw), 0)::float8 from ai_usage where created_at >= date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') as ai_krw,
      (select count(*)::int from tenants t where not t.is_test and t.deleted_at is null and t.id not in ('default', 'demo')
        and (select l.next_at from tenant_contact_logs l where l.tenant = t.id and l.next_at is not null order by l.at desc, l.created_at desc limit 1) <= (now() at time zone 'Asia/Seoul')::date) as contact_due`;
  return { signups: r.signups, payFailed: r.pay_failed, pastDue: r.past_due, openTickets: r.open_tickets, collectorFailed: r.collector_failed, aiKrw: Math.round(r.ai_krw), contactDue: r.contact_due }; // #656 오늘까지 연락할 고객사
}

// ---------------- #656 고객사 관리 확장(대표 10/26 00:40): 담당자·구분·단계·할인·연락 기록·내보내기 ----------------
function kstDay(d: Date = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d); }
/** 할인이 지금 적용 중인가 — 비율 > 0 이고 기한이 없거나 오늘까지 */
export function discountActive(s: { discount_pct?: number | null; discount_until?: string | Date | null } | null | undefined, day = kstDay()) {
  if (!s || !Number(s.discount_pct)) return false;
  if (!s.discount_until) return true;
  const until = typeof s.discount_until === 'string' ? s.discount_until.slice(0, 10) : kstDay(s.discount_until);
  return until >= day;
}
async function requireTenant(tenant: string) { if (!(await db()`select 1 from tenants where id = ${tenant}`).length) throw notFound('없는 회사입니다'); }

export const tenantProfileInput = z.object({
  contactName: z.string().trim().max(50).nullable().optional(), contactPhone: z.string().trim().max(30).nullable().optional(), contactTitle: z.string().trim().max(30).nullable().optional(),
  segment: z.enum(['partner', 'customer']).nullable().optional(), source: z.string().trim().max(100).nullable().optional() });
/** 담당자(이름·연락처·직책)·구분(설계 파트너/일반)·소개 경로 — 보낸 칸만 바꾼다. 감사 기록에는 어느 칸을 바꿨는지만(연락처 값은 남기지 않음) */
export async function setTenantProfile(u: SessionUser, tenant: string, i: z.infer<typeof tenantProfileInput>, ip: string | null) {
  requirePlatform(u); await requireTenant(tenant);
  const sql = db();
  const v = (x: string | null | undefined) => (x === undefined ? null : x?.trim() || null);
  await sql`update tenants set
      contact_name = case when ${i.contactName === undefined} then contact_name else ${v(i.contactName)}::text end,
      contact_phone = case when ${i.contactPhone === undefined} then contact_phone else ${v(i.contactPhone)}::text end,
      contact_title = case when ${i.contactTitle === undefined} then contact_title else ${v(i.contactTitle)}::text end,
      segment = case when ${i.segment === undefined} then segment else ${i.segment ?? null}::text end,
      source = case when ${i.source === undefined} then source else ${v(i.source)}::text end
    where id = ${tenant}`;
  await audit(sql, u.id, 'platform.tenant_profile', 'tenant', tenant, { fields: Object.keys(i), segment: i.segment === undefined ? undefined : i.segment ?? null }, ip);
  return { ok: true };
}

export const lifecycleInput = z.object({ stage: z.enum(['trial', 'paid', 'hold', 'churned']).nullable(), note: z.string().trim().max(300).optional() });
/** 단계(체험/유료/보류/해지)를 운영자가 직접 정함. null = 구독 상태에서 자동으로 돌아감 */
export async function setTenantLifecycle(u: SessionUser, tenant: string, i: z.infer<typeof lifecycleInput>, ip: string | null) {
  requirePlatform(u); await requireTenant(tenant);
  const sql = db();
  await sql`update tenants set lifecycle = ${i.stage}, lifecycle_note = ${i.stage ? i.note?.trim() || null : null}, lifecycle_at = ${i.stage ? new Date() : null} where id = ${tenant}`;
  await audit(sql, u.id, 'platform.tenant_lifecycle', 'tenant', tenant, { stage: i.stage, note: i.note?.trim() || null }, ip);
  const [t] = await sql<any[]>`select t.lifecycle, t.status, t.delete_scheduled_at, ts.status as sub_status from tenants t left join tenant_subscriptions ts on ts.tenant = t.id where t.id = ${tenant}`;
  return { ok: true, stage: stageOf(t) };
}

export const CONTACT_KINDS = ['call', 'mail', 'meeting', 'kakao', 'memo'] as const;
export const CONTACT_KIND_LABEL: Record<(typeof CONTACT_KINDS)[number], string> = { call: '전화', mail: '메일', meeting: '미팅', kakao: '카카오톡', memo: '메모' };
export const contactLogInput = z.object({
  kind: z.enum(CONTACT_KINDS).default('memo'), at: z.string().max(40).optional(), summary: z.string().trim().min(1, '내용을 적어 주세요').max(1000),
  nextAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '다음 연락일은 YYYY-MM-DD').nullable().optional() });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 연락 기록(전화·메일·미팅·카카오톡·메모) + 다음 연락 예정일 — 운영자만 본다 */
export async function listContactLogs(u: SessionUser, tenant: string) {
  requirePlatform(u); await requireTenant(tenant);
  const logs = await db()`select l.id, l.kind, l.at, l.summary, to_char(l.next_at, 'YYYY-MM-DD') as next_at, l.created_at, c.name as by_name
    from tenant_contact_logs l left join users c on c.id = l.created_by where l.tenant = ${tenant} order by l.at desc, l.created_at desc limit 200`;
  return { logs };
}
export async function addContactLog(u: SessionUser, tenant: string, i: z.infer<typeof contactLogInput>, ip: string | null) {
  requirePlatform(u); await requireTenant(tenant);
  const at = i.at ? new Date(i.at) : new Date();
  if (Number.isNaN(at.getTime())) throw badRequest('날짜·시각이 올바르지 않습니다');
  const sql = db();
  const [r] = await sql<{ id: string }[]>`insert into tenant_contact_logs (tenant, kind, at, summary, next_at, created_by) values (${tenant}, ${i.kind}, ${at}, ${i.summary.trim()}, ${i.nextAt ?? null}, ${u.id}) returning id`;
  await audit(sql, u.id, 'platform.tenant_contact', 'tenant', tenant, { kind: i.kind, nextAt: i.nextAt ?? null }, ip);
  return { ok: true, id: r.id };
}
export async function deleteContactLog(u: SessionUser, tenant: string, id: string, ip: string | null) {
  requirePlatform(u);
  if (!UUID.test(id)) throw notFound('없는 기록입니다');
  const sql = db();
  const r = await sql`delete from tenant_contact_logs where id = ${id} and tenant = ${tenant} returning id`;
  if (!r.length) throw notFound('없는 기록입니다');
  await audit(sql, u.id, 'platform.tenant_contact_delete', 'tenant', tenant, { id }, ip);
  return { ok: true };
}

export const discountInput = z.object({ pct: z.number().int().min(0).max(100), until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '기한은 YYYY-MM-DD').nullable().optional(), note: z.string().trim().max(200).nullable().optional() });
/** 회사별 할인(%) + 기한 + 사유 — 다음 정기 결제 견적(quote)부터 공급가에 적용. 0 이면 해제 */
export async function setTenantDiscount(u: SessionUser, tenant: string, i: z.infer<typeof discountInput>, ip: string | null) {
  requirePlatform(u);
  if (INTERNAL.includes(tenant)) throw badRequest('기본 회사에는 할인을 걸 수 없습니다');
  const sql = db();
  const r = await sql`update tenant_subscriptions set discount_pct = ${i.pct}, discount_until = ${i.pct ? i.until ?? null : null}, discount_note = ${i.pct ? i.note?.trim() || null : null}, updated_at = now() where tenant = ${tenant} returning tenant`;
  if (!r.length) throw notFound('없는 회사입니다');
  await audit(sql, u.id, 'platform.tenant_discount', 'tenant', tenant, { pct: i.pct, until: i.pct ? i.until ?? null : null }, ip);
  return { ok: true };
}

/** 고객사 목록 내보내기 — 목록과 같은 검색·필터, 엑셀 기본(?format=csv 는 UTF-8 BOM CSV). 개인정보(담당자 연락처)가 들어가므로 감사 기록을 남긴다 */
export async function exportTenants(u: SessionUser, q: { q?: string; status?: string; segment?: string; stage?: string; format?: string }) {
  const { tenants } = await tenantDirectory(u, q);
  const d = (x: Date | string | null | undefined) => (x ? kstDay(new Date(x)) : '');
  const head = ['회사', 'id', '구분', '단계', '업종', '규모', '대표 이메일', '담당자', '담당자 직책', '연락처', '소개 경로', '요금제', '구독 상태', '체험 종료', '결제 금액', '할인', '인원', '최근 7일 접속', '마지막 접속', '이번 달 AI(회)', '이번 달 AI 원가(원)', '마지막 연락', '다음 연락', '가입일', '운영 메모'];
  const rows = tenants.map((t) => [t.name, t.id, t.segment === 'partner' ? '설계 파트너' : '일반', STAGE_LABEL[t.stage as Stage] ?? t.stage, (t.industries ?? []).join('·'), t.size_band ?? '', t.owner_email ?? '',
    t.contact_name ?? '', t.contact_title ?? '', t.contact_phone ?? '', t.source ?? '', t.plan_code ?? '', t.sub_status ?? '', d(t.trial_ends_at),
    t.billing_amount ? `${Number(t.billing_amount).toLocaleString('ko-KR')}원/${t.billing_cycle === 'annual' ? '년' : '월'}` : '', t.discount_pct ? `${t.discount_pct}%${t.discount_until ? ` ~${t.discount_until}` : ''}` : '',
    t.users, t.active7, d(t.last_login_at), t.ai_requests, Math.round(Number(t.ai_krw ?? 0)), d(t.last_contact_at), t.next_contact_at ?? '', d(t.created_at), t.platform_memo ?? '']);
  await audit(db(), u.id, 'platform.tenant_export', null, null, { rows: rows.length, format: q.format ?? 'xlsx' }, null);
  const base = `고객사목록_${kstDay()}`;
  if (q.format === 'csv') {
    const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = '﻿' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
    return { fileName: `${base}.csv`, type: 'text/csv; charset=utf-8', data: Buffer.from(csv, 'utf8') };
  }
  const { writeXlsx } = await import('./xlsx');
  return { fileName: `${base}.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: writeXlsx([{ name: '고객사', rows: [head, ...rows] }]) };
}
