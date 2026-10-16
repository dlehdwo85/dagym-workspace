import { z } from 'zod';
import { db } from '../db';
import { newToken } from '../crypto';
import { badRequest, notFound } from '../errors';
import { audit } from '../log';
import type { SessionUser } from '../types';

/**
 * V32 1 결제 시험: 로그인 계정 없는 시험 회사(is_test)를 만들고, 플랫폼 운영자가 그 회사로 시험 상점 결제창을 연다.
 * 승인 뒤 자동 확인 — 결제 승인·요금제 반영·결제 내역·영수증 메일·(정산 장부)·취소 원복. 시험 카드 입력은 대표가 직접.
 */
const requirePlatform = (u: SessionUser) => { if (!u.platformAdmin || u.support) throw notFound(); };

export const testTenantInput = z.object({ name: z.string().trim().min(1).max(60).optional() });
export async function createTestTenant(u: SessionUser, i: z.infer<typeof testTenantInput>, ip: string | null) {
  requirePlatform(u);
  const sql = db();
  const id = `test_${newToken(9).replace(/[^A-Za-z0-9]/g, '').toLowerCase().slice(0, 10)}`;
  const name = i.name || `결제 시험 ${new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}`;
  await sql.begin(async (tx) => {
    await tx`insert into tenants (id, name, kind, is_test) values (${id}, ${name}, 'company', true)`;
    await tx`insert into tenant_subscriptions (tenant, plan_code, status, trial_ends_at, period_end) values (${id}, 'trial', 'trial', now() + interval '14 days', (now() + interval '14 days')::date)`;
    await tx`insert into org_units (type, name, sort, tenant) values ('hq', ${name}, 0, ${id})`;
    await audit(tx, u.id, 'platform.test_tenant_created', 'tenant', null, { tenant: id }, ip);
  });
  return { id, name };
}

export async function listTestTenants(u: SessionUser) {
  requirePlatform(u);
  const sql = db();
  const tenants = await sql`select t.id, t.name, t.created_at, ts.plan_code, ts.status, ts.billing_cycle,
      (select json_agg(x order by x.created_at desc) from (select p.id, p.kind, p.plan_code, p.addon_code, p.amount, p.status, (p.meta->>'liveSmoke') = 'true' as live, p.canceled_amount, p.result_msg, p.paid_at, p.created_at, p.meta->>'payMethod' as pay_method
        from payments p where p.tenant = t.id order by p.created_at desc limit 10) x) as payments
    from tenants t left join tenant_subscriptions ts on ts.tenant = t.id where t.is_test and t.deleted_at is null order by t.created_at desc limit 20`;
  const plans = await sql`select code, name from plans where public and active and code not in ('trial', 'free', 'team_free', 'w_free') order by sort`;
  const { npLiveConf } = await import('./nicepay');
  return { tenants, plans, liveAvailable: !!npLiveConf() };
}

type Check = { key: string; label: string; state: 'ok' | 'fail' | 'wait' | 'later'; detail?: string };
/** 결제 뒤 자동 확인 */
export async function testCheck(u: SessionUser, paymentId: string) {
  requirePlatform(u);
  if (!/^[0-9a-f-]{36}$/.test(paymentId)) throw notFound();
  const sql = db();
  const [p] = await sql<any[]>`select p.*, t.is_test, t.name as tenant_name from payments p join tenants t on t.id = p.tenant where p.id = ${paymentId}`;
  if (!p || !p.is_test) throw notFound();
  const [s] = await sql<any[]>`select plan_code, status, billing_cycle, addons from tenant_subscriptions where tenant = ${p.tenant}`;
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from payments where tenant = ${p.tenant} and status in ('paid', 'canceled', 'partial_canceled')`;
  const paid = ['paid', 'canceled', 'partial_canceled'].includes(p.status);
  const canceled = p.status === 'canceled';
  const prev = p.meta?.prev;
  const checks: Check[] = [
    { key: 'approved', label: '결제 승인', state: paid ? 'ok' : p.status === 'pending' ? 'wait' : 'fail', detail: p.result_msg ?? p.status },
    p.meta?.liveSmoke ? { key: 'plan', label: '요금제 반영', state: 'later', detail: '실결제 소액 시험 — 요금제는 바꾸지 않음' } :
    { key: 'plan', label: '요금제 반영', state: !paid ? 'wait' : canceled ? 'ok'
      : (p.kind === 'addon' ? Number(s?.addons?.[p.addon_code] ?? 0) > 0 : s?.plan_code === p.plan_code && s?.status === 'active') ? 'ok' : 'fail',
      detail: canceled ? '취소됨 — 아래 원복 확인' : `${s?.plan_code ?? '-'} · ${s?.status ?? '-'}${s?.billing_cycle ? ` · ${s.billing_cycle}` : ''}` },
    { key: 'history', label: '결제 내역', state: paid && n >= 1 ? 'ok' : paid ? 'fail' : 'wait', detail: `${n}건` },
    { key: 'receipt', label: '영수증 메일', state: p.meta?.receiptSentAt ? 'ok' : paid ? 'fail' : 'wait', detail: p.meta?.receiptSentAt ? `보냄(결제한 운영자 메일) ${p.meta.receiptSentAt}` : '아직 안 보냄' },
    { key: 'ledger', label: '정산 장부', state: 'later', detail: '정산 화면(V32 2)이 생기면 여기서 확인' },
    { key: 'revert', label: '취소 시 원복', state: !canceled ? 'wait'
      : (p.kind === 'addon' || !prev || (s?.plan_code === prev.plan_code && s?.status === prev.status)) ? 'ok' : 'fail',
      detail: canceled ? `지금 ${s?.plan_code} · ${s?.status} (결제 전 ${prev?.plan_code ?? '-'} · ${prev?.status ?? '-'})` : '[시험 결제 취소]를 누르면 확인' },
  ];
  return { payment: { id: p.id, tenant: p.tenant, tenantName: p.tenant_name, kind: p.kind, plan: p.meta?.liveSmoke ? '실결제 소액 시험' : p.plan_code ?? p.addon_code, live: !!p.meta?.liveSmoke, amount: p.amount, status: p.status, payMethod: p.meta?.payMethod ?? 'CARD', vbank: p.meta?.vbank ?? null }, checks };
}

/** 정기 실행: 승인 1시간이 지난 시험 결제는 자동 취소(요금제 원복) — 시험 상점도 당일 취소되지만 우리 기록도 맞춘다 */
export async function autoCancelTestPayments() {
  const sql = db();
  const rows = await sql<{ id: string }[]>`select p.id from payments p join tenants t on t.id = p.tenant where t.is_test and p.status = 'paid' and p.paid_at < now() - interval '1 hour' limit 20`;
  if (!rows.length) return 0;
  const { refundPayment } = await import('./index');
  const sys = { id: null, platformAdmin: true } as unknown as SessionUser;
  let n = 0;
  for (const r of rows) { try { await refundPayment(sys, r.id, { reason: '시험 결제 자동 취소', revertPlan: true }, null); n++; } catch { /* 다음 실행에서 다시 */ } }
  return n;
}
