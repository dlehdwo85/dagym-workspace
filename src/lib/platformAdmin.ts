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

export async function tenantDirectory(u: SessionUser, q: { q?: string; status?: string }) {
  requirePlatform(u);
  const sql = db();
  const term = (q.q ?? '').trim();
  const like = `%${term.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const rows: any[] = await sql`
    select t.id, t.name, t.kind, t.status, t.is_test, t.created_at, t.delete_scheduled_at, t.support_consent_at, ow.email as owner_email,
      ts.plan_code, ts.status as sub_status, ts.trial_ends_at, ts.limit_overrides,
      ts.billing_cycle, ts.next_billing_on, ts.billing_amount, ts.past_due_since, ts.billing_lock, ts.billing_grace_until,
      (select json_build_object('at', coalesce(p.paid_at, p.created_at), 'status', p.status, 'amount', p.amount, 'msg', p.result_msg) from payments p where p.tenant = t.id order by p.created_at desc limit 1) as last_payment,
      (select count(*)::int from users x where x.tenant = t.id and x.status = 'active') as users,
      (select max(x.last_login_at) from users x where x.tenant = t.id) as last_login_at,
      (select storage_bytes from tenant_usage tu where tu.tenant = t.id order by month desc limit 1)::float8 as storage_bytes,
      (select count(distinct coalesce(a.request_id::text, a.id::text))::int from ai_usage a where a.tenant = t.id and a.created_at >= date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') as ai_requests,
      (select coalesce(sum(a.cost_krw), 0)::float8 from ai_usage a where a.tenant = t.id and a.created_at >= date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') as ai_krw
    from tenants t left join users ow on ow.id = t.owner_user_id left join tenant_subscriptions ts on ts.tenant = t.id
    where (${term} = '' or t.name ilike ${like} or t.id ilike ${like} or coalesce(ow.email, '') ilike ${like})
      and (${q.status ?? ''} = '' or t.status = ${q.status ?? ''} or (${q.status ?? ''} = 'trial' and ts.status in ('trial', 'expired')) or (${q.status ?? ''} = 'deleting' and t.delete_scheduled_at is not null))
    order by (t.id in ('default', 'demo')) desc, t.created_at desc limit 300`;
  // #412 회사별 AI 잔여(업무·영업 공유 요청 수 · 마케팅 크레딧) + 플랫폼 전체 원가·마진 한 줄(이달 AI 원가 합계 vs 요금 합계 VAT 제외)
  const P = await import('./plans'); const M = await import('./mktAuto');
  const monthStart = `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7)}-01`;
  const [mktPlans, mktSettings, mktUsed] = await Promise.all([
    M.planTable(),
    sql<{ tenant: string; plan_code: string | null; monthly_credits: number | null }[]>`select tenant, plan_code, monthly_credits::float8 monthly_credits from mkt_settings`.catch(() => []),
    sql<{ tenant: string; credits: number }[]>`select tenant, coalesce(sum(credits), 0)::float8 credits from mkt_credit_ledger where created_at >= (${monthStart}::date::timestamp at time zone 'Asia/Seoul') group by tenant`.catch(() => []),
  ]);
  const tenants = await Promise.all(rows.map(async (r) => {
    const { limits } = await P.effectiveLimits(r.id, sql).catch(() => ({ limits: { aiRequests: null } as { aiRequests: number | null } }));
    const ms = mktSettings.find((x) => x.tenant === r.id);
    const creditsLimit = ms ? ms.monthly_credits ?? (ms.plan_code ? mktPlans[ms.plan_code]?.monthlyCredits ?? null : null) : null;
    const creditsUsed = mktUsed.find((x) => x.tenant === r.id)?.credits ?? 0;
    const aiLimit = limits.aiRequests ?? null;
    return { ...r, ai_limit_requests: aiLimit, ai_left_requests: aiLimit === null ? null : Math.max(0, aiLimit - Number(r.ai_requests)),
      mkt_plan_code: ms?.plan_code ?? null, mkt_credits_limit: creditsLimit, mkt_credits_used: creditsUsed, mkt_credits_left: creditsLimit === null ? null : Math.max(0, Math.round((creditsLimit - creditsUsed) * 10) / 10) };
  }));
  const customers = tenants.filter((t) => !INTERNAL.includes(t.id) && !t.is_test);
  const aiCostKrw = Math.round(tenants.reduce((a, t) => a + Number(t.ai_krw ?? 0), 0));
  const customerAiCostKrw = Math.round(customers.reduce((a, t) => a + Number(t.ai_krw ?? 0), 0));
  const revenueKrw = Math.round(customers.reduce((a, t) => a + (t.billing_amount ? (t.billing_cycle === 'annual' ? Number(t.billing_amount) / 12 : Number(t.billing_amount)) / 1.1 : 0), 0));
  const summary = { month: monthStart.slice(0, 7), aiCostKrw, customerAiCostKrw, revenueKrw, marginKrw: revenueKrw - customerAiCostKrw, marginPct: revenueKrw > 0 ? Math.round(((revenueKrw - customerAiCostKrw) / revenueKrw) * 1000) / 10 : null,
    customers: customers.length, paying: customers.filter((t) => t.billing_amount).length };
  return { tenants, summary };
}

export async function tenantAdminDetail(u: SessionUser, tenant: string) {
  requirePlatform(u);
  const sql = db();
  const [t] = await sql`select t.*, ow.email as owner_email from tenants t left join users ow on ow.id = t.owner_user_id where t.id = ${tenant}`;
  if (!t) throw notFound('없는 회사입니다');
  const P = await import('./plans');
  const [{ limits, sub }, usage, users, support, payments] = await Promise.all([
    P.effectiveLimits(tenant, sql), P.currentUsage(tenant, sql),
    sql`select id, name, email, role, status, last_login_at, (totp_enabled_at is not null) as totp, platform_admin, created_at from users where tenant = ${tenant} and deleted_at is null order by (role = 'owner') desc, name`,
    sql`select s.created_at, s.expires_at, s.ended_at, s.reason, a.name as admin_name from support_sessions s join users a on a.id = s.admin_id where s.tenant = ${tenant} order by s.created_at desc limit 10`,
    sql`select p.id, p.kind, p.plan_code, p.amount, p.status, p.canceled_amount, p.result_msg, p.paid_at, p.created_at, s.status as settlement, to_char(s.expected_on, 'YYYY-MM-DD') as expected_on, to_char(s.settled_on, 'YYYY-MM-DD') as settled_on
      from payments p left join payment_settlements s on s.payment_id = p.id where p.tenant = ${tenant} order by p.created_at desc limit 12`, // V32 2 정산 상태 같이
  ]);
  // V28 B2: 이번 달 청구 예정(정기 결제 금액, VAT 포함)·미납·AI 원가율
  const [b] = await sql<any[]>`select billing_cycle, next_billing_on, billing_amount, past_due_since, billing_lock, billing_grace_until from tenant_subscriptions where tenant = ${tenant}`;
  const [{ krw }] = await sql<{ krw: number }[]>`select coalesce(sum(cost_krw), 0)::float8 krw from ai_usage where tenant = ${tenant} and created_at >= date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'`;
  const monthly = b?.billing_amount ? (b.billing_cycle === 'annual' ? Math.round(b.billing_amount / 12) : b.billing_amount) : 0;
  const billing = { ...(b ?? {}), expectedThisMonth: monthly, unpaid: b?.past_due_since ? b.billing_amount : 0, aiCostKrw: Math.round(krw), aiCostRate: monthly ? Math.round((krw / (monthly / 1.1)) * 1000) / 10 : null };
  // 대표 10/20 ① 고객사 추가로 만든 회사: 대표가 아직 초대를 안 받았으면 '초대 대기'(다시 보내기)
  const [inv] = await sql<{ expires_at: Date; created_at: Date }[]>`select expires_at, created_at from invitations where user_id = ${t.owner_user_id} and accepted_at is null and revoked_at is null order by created_at desc limit 1`;
  const ownerInvite = t.owner_user_id && users.find((x: any) => x.id === t.owner_user_id)?.status === 'invited' ? { pending: true, expiresAt: inv?.expires_at ?? null, expired: !inv || new Date(inv.expires_at) < new Date() } : { pending: false };
  return { ownerInvite, billing, payments, tenant: t, subscription: { planCode: sub.plan_code, planName: sub.plan_name, status: sub.status, trialEndsAt: sub.trial_ends_at ?? null, overrides: sub.limit_overrides ?? {}, addons: sub.addons ?? {} }, limits, usage, users, support };
}

export const overrideInput = z.object({
  users: z.number().int().min(0).max(100000).nullable().optional(), storageGb: z.number().min(0).max(100000).nullable().optional(), aiRequests: z.number().int().min(0).max(10_000_000).nullable().optional(),
  tasksTotal: z.number().int().min(0).max(100_000_000).nullable().optional(),
  clear: z.array(z.enum(['users', 'storageGb', 'aiRequests', 'tasksTotal'])).optional(),
});
/** 인원·저장·AI 한도 개별 조정(요금제 대신). clear 에 넣은 항목은 요금제 값으로 되돌림. AI 크레딧 지급 = aiRequests 를 올려 주는 것 */
export async function setLimitOverrides(u: SessionUser, tenant: string, i: z.infer<typeof overrideInput>, ip: string | null) {
  requirePlatform(u);
  const sql = db();
  const [s] = await sql<{ limit_overrides: Record<string, unknown> }[]>`select limit_overrides from tenant_subscriptions where tenant = ${tenant}`;
  if (!s) throw notFound('요금제가 없는 회사입니다 — 먼저 요금제를 지정하세요');
  const next: Record<string, unknown> = { ...(s.limit_overrides ?? {}) };
  for (const k of ['users', 'storageGb', 'aiRequests', 'tasksTotal'] as const) if (i[k] !== undefined) next[k] = i[k];
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
  trialDays: z.number().int().min(1).max(90).optional(), spaces: z.array(z.enum(['sales', 'marketing'])).max(2).default([]), memo: z.string().max(2000).optional() });
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
    await tx`update tenants set spaces = ${['work', ...new Set(i.spaces)]}, platform_memo = ${i.memo?.trim() || null} where id = ${tenant}`;
    if (plan) await tx`update tenant_subscriptions set plan_code = ${plan}, status = 'active', trial_ends_at = null, period_end = null where tenant = ${tenant}`;
    else if (i.trialDays) await tx`update tenant_subscriptions set trial_ends_at = now() + ${i.trialDays} * interval '1 day', period_end = (now() + ${i.trialDays} * interval '1 day')::date where tenant = ${tenant}`;
    const [hq] = await tx<{ id: string }[]>`select id from org_units where tenant = ${tenant} and type = 'hq' order by sort limit 1`;
    await tx`insert into invitations (email, name, role, org_unit_ids, token_hash, invited_by, user_id, expires_at) values (${i.ownerEmail}, ${i.ownerName}, 'owner', ${hq ? [hq.id] : []}, ${sha256(token)}, ${u.id}, ${userId}, now() + interval '7 days')`;
    await audit(tx, u.id, 'platform.tenant_create', 'tenant', tenant, { company: i.company, ownerEmail: i.ownerEmail, plan: plan ?? `trial${i.trialDays ? `(${i.trialDays}d)` : ''}`, spaces: i.spaces, industries: inds }, ip);
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
