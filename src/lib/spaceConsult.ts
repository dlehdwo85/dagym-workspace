// #1139(대표 11/24 '업무관리는 별도의 상담 없이, 영업·마케팅은 문의 → 상담 후 사용(잠금 표기)'):
// · 회사가 켜지 않은 영업·마케팅은 사이드바에 자물쇠 + '상담 후 사용' → 소개 + [상담 신청](관리자, 연락처 미리 채움, 같은 공간 중복 신청 없음)
// · 상담 신청은 플랫폼 운영자에게 알림(앱 + 메일) → 운영자가 회사 상세에서 [영업 열기]·[마케팅 열기](닫기도, 감사 기록) — 회사 관리자는 직접 켜지 못함
// · 예외(직접 켜기 허용): 우리 회사(default)·앱 심사용 demo·검수용 시험 회사(is_test)·결제 시험 test_* — 화면 시험·심사·배포 확인이 막히지 않게
// · 서버 차단은 기존 assertSpace(회사가 켜지 않은 공간 = 404) 그대로 · 화면에 금액은 쓰지 않음(요금은 상담에서)
import { z } from 'zod';
import { db, type Sql } from './db';
import { isAdmin } from './access';
import { badRequest, forbidden, notFound } from './errors';
import { audit } from './log';
import { notify } from './notifications';
import { tenantSpaces, type Space } from './spaces';
import { tenantOf, type SessionUser } from './types';

export const LOCKABLE = ['sales', 'marketing'] as const;
export type Lockable = (typeof LOCKABLE)[number];
const LABEL: Record<Lockable, string> = { sales: '영업', marketing: '마케팅' };

/** 관리자가 직접 공간을 켜도 되는 회사(상담 없이) */
export async function consultFree(tenant: string, sql: Sql = db()) {
  if (['default', 'demo'].includes(tenant) || tenant.startsWith('test_')) return true;
  if (process.env.SPACES_SELF_SERVE === '1') return true; // 시험 서버 전용(tests/helpers.mjs) — 운영에는 넣지 않음
  const [t] = await sql<{ is_test: boolean | null }[]>`select is_test from tenants where id = ${tenant}`;
  return !!t?.is_test;
}

/** 회사가 켜지 않은 영업·마케팅(잠김) */
export async function lockedSpaces(tenant: string, sql: Sql = db()): Promise<Lockable[]> {
  const on = await tenantSpaces(tenant, sql);
  return LOCKABLE.filter((s) => !(on as Space[]).includes(s));
}

/** 잠긴 공간 안내 화면: 잠긴 공간·열린 상담 신청·신청 가능 여부·미리 채울 연락처 */
export async function consultView(u: SessionUser) {
  const sql = db(); const t = tenantOf(u);
  const locked = await lockedSpaces(t, sql);
  const open = await sql<{ id: string; spaces: string[]; created_at: Date; name: string | null }[]>`
    select c.id, c.spaces, c.created_at, us.name from space_consults c left join users us on us.id = c.user_id where c.tenant = ${t} and c.status = 'requested' order by c.created_at desc limit 5`;
  const [me] = await sql<{ name: string; email: string; phone: string | null }[]>`select name, email, phone from users where id = ${u.id}`;
  return {
    locked, canRequest: isAdmin(u) && !u.isDemo, free: await consultFree(t, sql),
    requested: open.map((r) => ({ id: r.id, spaces: r.spaces, at: r.created_at.toISOString(), by: r.name })),
    contact: isAdmin(u) ? { name: me?.name ?? u.name, email: me?.email ?? u.email, phone: me?.phone ?? '' } : null,
  };
}

export const consultInput = z.object({
  spaces: z.array(z.enum(LOCKABLE)).min(1, '영업·마케팅 중 하나 이상 골라 주세요').max(2),
  name: z.string().trim().min(1, '이름을 적어 주세요').max(50),
  phone: z.string().trim().max(30).optional().default(''),
  email: z.string().trim().email('이메일 형식이 아닙니다').max(200),
  memo: z.string().trim().max(1000).optional().default(''),
});
/** [상담 신청] — 회사 관리자. 이미 열린 신청에 같은 공간이 있으면 새로 만들지 않고 그 신청을 돌려줌 */
export async function requestConsult(u: SessionUser, i: z.infer<typeof consultInput>, ip: string | null) {
  if (!isAdmin(u) || u.isDemo) throw forbidden('회사 관리자만 상담을 신청할 수 있습니다');
  const sql = db(); const t = tenantOf(u);
  const locked = await lockedSpaces(t, sql);
  const want = [...new Set(i.spaces)].filter((s) => locked.includes(s));
  if (!want.length) throw badRequest('이미 사용 중인 공간입니다');
  const [dup] = await sql<{ id: string; created_at: Date; spaces: string[] }[]>`select id, created_at, spaces from space_consults where tenant = ${t} and status = 'requested' and spaces && ${want}::text[] order by created_at desc limit 1`;
  if (dup) return { id: dup.id, already: true, at: dup.created_at.toISOString(), spaces: dup.spaces };
  const [c] = await sql<{ id: string; created_at: Date }[]>`insert into space_consults (tenant, user_id, spaces, name, phone, email, memo)
    values (${t}, ${u.id}, ${want}, ${i.name}, ${i.phone || null}, ${i.email}, ${i.memo || null}) returning id, created_at`;
  await audit(sql, u.id, 'space.consult_request', 'tenant', null, { spaces: want }, ip);
  const [tn] = await sql<{ name: string }[]>`select name from tenants where id = ${t}`;
  const what = want.map((s) => LABEL[s]).join('·');
  const { platformAdminIds } = await import('./superAdmin');
  const ops = await platformAdminIds(sql);
  if (ops.length) {
    await notify(sql, { userIds: ops, type: 'signup_request', title: `상담 신청: ${tn?.name ?? t} — ${what}`, body: `${i.name}${i.phone ? ` · ${i.phone}` : ''} · ${i.email}${i.memo ? `\n${i.memo.slice(0, 200)}` : ''}`,
      link: `/platform?tenant=${encodeURIComponent(t)}`, entityType: 'tenant', entityId: null, actorId: u.id, dedupeKey: `space-consult:${c.id}` } as never).catch(() => {});
    // 메일도(운영자가 앱을 안 보고 있어도) — 신청한 사람의 연락처는 운영자에게만
    const { sendMail } = await import('./mail');
    const to = await sql<{ email: string }[]>`select email from users where id = any(${ops}::uuid[])`;
    for (const r of to) await sendMail(r.email, `[워크인] 상담 신청 — ${tn?.name ?? t} (${what})`,
      `${tn?.name ?? t} 에서 ${what} 상담을 신청했습니다.\n\n이름: ${i.name}\n연락처: ${i.phone || '-'}\n이메일: ${i.email}\n메모: ${i.memo || '-'}\n\n플랫폼 운영 › 고객사 › 회사 상세에서 상담 뒤 [${what} 열기]를 누르면 바로 쓸 수 있습니다.`).catch(() => {});
  }
  return { id: c.id, already: false, at: c.created_at.toISOString(), spaces: want };
}

/** 플랫폼 운영자가 회사 상세에서 공간을 켜고 끈 뒤(setTenantSpacesByPlatform): 새로 연 공간이 든 열린 상담 신청은 '열림'으로, 회사 관리자에게 알림 */
export async function afterPlatformSpaces(sql: Sql, u: SessionUser, tenant: string, before: string[], after: string[]) {
  const opened = LOCKABLE.filter((s) => after.includes(s) && !before.includes(s));
  const closed = LOCKABLE.filter((s) => before.includes(s) && !after.includes(s));
  if (opened.length) await sql`update space_consults set status = 'opened', handled_by = ${u.id}, handled_at = now() where tenant = ${tenant} and status = 'requested' and spaces && ${opened}::text[]`;
  // A4: 운영자가 연 공간은 'operator'(결제와 무관) · 닫으면 표시도 지움
  for (const sp of opened) await sql`update tenants set space_grants = case when space_grants ? ${sp} then space_grants else space_grants || jsonb_build_object(${sp}::text, 'operator') end where id = ${tenant}`;
  for (const sp of closed) await sql`update tenants set space_grants = space_grants - ${sp}::text where id = ${tenant}`;
  if (!opened.length && !closed.length) return;
  const admins = (await sql<{ id: string }[]>`select id from users where tenant = ${tenant} and role in ('owner', 'admin') and status = 'active' and not coalesce(is_demo, false)`).map((x) => x.id);
  for (const [list, on] of [[opened, true], [closed, false]] as const) for (const sp of list) if (admins.length)
    await notify(sql, { userIds: admins, type: 'announcement', title: on ? `${LABEL[sp]} 공간을 열었습니다` : `${LABEL[sp]} 공간을 닫았습니다`,
      body: on ? `이제 ${LABEL[sp]}을(를) 쓸 수 있습니다. 직원 배정은 관리 › 사용자 › 공간에서 합니다.` : `${LABEL[sp]} 공간이 닫혔습니다. 자료는 그대로 남아 있고, 다시 열면 이어서 쓸 수 있습니다.`,
      link: on ? `/s/${sp}` : '/', entityType: 'tenant', entityId: null, actorId: u.id, dedupeKey: `space-toggle:${tenant}:${sp}:${on}:${Date.now()}` } as never).catch(() => {});
}

/**
 * #1139 상용화 A4(대표 위임): 업무+영업(w_sales) 결제가 살아 있으면 영업을 열고(space_grants.sales = 'plan'), 해지·만료·30일 미납(이용 중지)이면 다시 잠금 — 자료는 그대로.
 * 운영자가 상담 후 연 공간('operator')은 결제와 무관하게 그대로. 결제 상태가 바뀌는 곳(결제 성공·정기 결제 정기 실행·요금제 변경)에서 부름
 */
export async function syncPaidSpaces(sql: Sql, tenant: string) {
  if (['default', 'demo'].includes(tenant)) return null;
  const [t] = await sql<{ spaces: string[] | null; space_grants: Record<string, string> | null; plan_code: string | null; status: string | null; billing_lock: string | null }[]>`
    select t.spaces, t.space_grants, s.plan_code, s.status, s.billing_lock from tenants t left join tenant_subscriptions s on s.tenant = t.id where t.id = ${tenant}`;
  if (!t) return null;
  const spaces = t.spaces ?? []; const grants = { ...(t.space_grants ?? {}) };
  // 7일 미납(보기만)은 다른 화면처럼 영업도 보기만 — 30일 미납(이용 중지)·해지·만료에서 잠금
  const entitled = t.plan_code === 'w_sales' && t.status === 'active' && t.billing_lock !== 'suspended';
  let change: 'opened' | 'locked' | null = null;
  if (entitled && !spaces.includes('sales')) {
    await sql`update tenants set spaces = case when 'sales' = any(coalesce(spaces, '{}')) then spaces else array_append(coalesce(spaces, '{}'::text[]), 'sales') end, space_grants = space_grants || '{"sales":"plan"}'::jsonb where id = ${tenant}`;
    change = 'opened';
  } else if (!entitled && grants.sales === 'plan') {
    await sql`update tenants set spaces = array_remove(spaces, 'sales'), space_grants = space_grants - 'sales' where id = ${tenant}`;
    change = 'locked';
  }
  if (!change) return null;
  await audit(sql, null, change === 'opened' ? 'space.plan_open' : 'space.plan_lock', 'tenant', tenant, { tenant, space: 'sales', plan: t.plan_code, status: t.status, lock: t.billing_lock }).catch(() => {});
  const admins = (await sql<{ id: string }[]>`select id from users where tenant = ${tenant} and role in ('owner', 'admin') and status = 'active' and not coalesce(is_demo, false)`).map((x) => x.id);
  if (admins.length) await notify(sql, { userIds: admins, type: 'announcement', title: change === 'opened' ? '영업 공간을 열었습니다' : '영업 공간이 잠겼습니다',
    body: change === 'opened' ? '업무 + 영업 결제가 확인되어 영업을 쓸 수 있습니다. 직원 배정은 관리 › 사용자 › 공간에서 합니다.' : '업무 + 영업 결제가 끝나(해지·만료·30일 미납) 영업이 잠겼습니다. 자료는 그대로 남아 있고, 다시 결제하면 이어서 쓸 수 있습니다.',
    link: change === 'opened' ? '/s/sales' : '/admin/usage', entityType: 'tenant', actorId: null, dedupeKey: `space-plan:${tenant}:${change}:${new Date().toISOString().slice(0, 10)}` }).catch(() => {});
  return change;
}

/** 결제 금액에 합칠 마케팅 요금제 — 운영자가 회사 상세에서 정한 것만(space_grants.marketing = 'plan') */
export async function billedMarketing(sql: Sql, tenant: string): Promise<{ code: string; label: string; krw: number } | null> {
  const [t] = await sql<{ g: string | null; plan: string | null; on: boolean }[]>`select t.space_grants->>'marketing' as g, m.plan_code as plan, 'marketing' = any(coalesce(t.spaces, '{}')) as on
    from tenants t left join mkt_settings m on m.tenant = t.id where t.id = ${tenant}`;
  if (!t || t.g !== 'plan' || !t.on || !t.plan) return null;
  const plans = await (await import('./mktAuto')).planTable();
  const p = (plans as Record<string, { label: string; price: number | null }>)[t.plan];
  return p && p.price ? { code: t.plan, label: p.label, krw: p.price } : null;
}

export const mktBillInput = z.object({ planCode: z.enum(['basic', 'standard', 'pro']).nullable() });
/** 플랫폼 운영자: 상담 뒤 회사의 마케팅 요금제를 정함 → 결제 금액에 합침(다음 결제부터) · null = 결제에서 뺌(공간은 그대로) */
export async function setMarketingBilling(u: SessionUser, tenant: string, i: z.infer<typeof mktBillInput>, ip: string | null) {
  if (!u.platformAdmin || u.support) throw notFound(); // 다른 운영 화면처럼 운영자가 아니면 없는 화면
  const sql = db();
  const [t] = await sql<{ id: string }[]>`select id from tenants where id = ${tenant}`;
  if (!t) throw badRequest('없는 회사입니다');
  if (i.planCode) {
    await sql`insert into mkt_settings (tenant, plan_code, updated_by) values (${tenant}, ${i.planCode}, ${u.id}) on conflict (tenant) do update set plan_code = excluded.plan_code, updated_by = excluded.updated_by, updated_at = now()`;
    await sql`update tenants set spaces = case when 'marketing' = any(coalesce(spaces, '{}')) then spaces else array_append(coalesce(spaces, '{}'::text[]), 'marketing') end, space_grants = space_grants || '{"marketing":"plan"}'::jsonb where id = ${tenant}`;
  } else {
    await sql`update tenants set space_grants = case when space_grants->>'marketing' = 'plan' then (space_grants - 'marketing') || '{"marketing":"operator"}'::jsonb else space_grants end where id = ${tenant}`;
  }
  await audit(sql, u.id, 'platform.mkt_billing', 'tenant', tenant, { planCode: i.planCode }, ip);
  return { billed: await billedMarketing(sql, tenant) };
}
