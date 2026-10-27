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

/**
 * #566(대표 10/24) 결제 시험 회사 [지우기] — 시험 회사(is_test)만. 결제 기록이 하나라도 있으면 기록을 남기려고 '숨기기'(삭제 표시, 목록에서 빠짐),
 * 없으면 완전히 지움(다른 기록이 걸려 있으면 숨기기로). 취소 안 된 결제(실결제 100원 포함)·1시간 안에 연 결제창이 있으면 막음
 */
export async function removeTestTenant(u: SessionUser, tenant: string, ip: string | null) {
  requirePlatform(u);
  const sql = db();
  const [t] = await sql<{ name: string }[]>`select name from tenants where id = ${tenant} and is_test and deleted_at is null`;
  if (!t) throw notFound('결제 시험 회사가 아닙니다');
  const pays = await sql<{ status: string; created_at: Date }[]>`select status, created_at from payments where tenant = ${tenant}`;
  if (pays.some((p) => ['paid', 'partial_canceled'].includes(p.status))) throw badRequest('아직 취소하지 않은 시험 결제가 있습니다 — [시험 결제 취소] 뒤에 지워 주세요');
  if (pays.some((p) => p.status === 'pending' && Date.now() - new Date(p.created_at).getTime() < 3_600_000)) throw badRequest('결제창을 연 지 1시간이 안 된 시험 결제가 있습니다 — 잠시 뒤에 지워 주세요');
  let mode: 'deleted' | 'hidden' = pays.length ? 'hidden' : 'deleted';
  if (mode === 'deleted') {
    try {
      await sql.begin(async (tx) => {
        await tx`delete from org_units where tenant = ${tenant}`;
        await tx`delete from tenant_subscriptions where tenant = ${tenant}`;
        await tx`delete from tenants where id = ${tenant} and is_test`;
      });
    } catch { mode = 'hidden'; } // 다른 기록이 이 회사를 가리키면 지우지 않고 숨김
  }
  if (mode === 'hidden') await sql`update tenants set status = 'deleted', deleted_at = now() where id = ${tenant} and is_test`;
  await audit(sql, u.id, `platform.test_tenant_${mode}`, 'tenant', null, { tenant, name: t.name, payments: pays.length }, ip);
  return { ok: true, mode };
}

/**
 * 192차(대표 10/27 "결제 시험회사 숨겨도 됩니다. 결제 모듈 상태가 정상인지만 표기하는 걸 냅두고 그 밑에 테스트만 냅둡니다. 굳이 테스트 결제 회사를 추가해야 할 이유를 모르겠네요."):
 * 시험 결제는 고정 시험 회사 하나로(처음 한 번만 만들고 다시 씀 — 화면에는 회사 목록이 없음). 새 시험 결제창을 열기 전에 그 회사에 남은 승인 결제를 취소해
 * '결제 전 요금제'가 늘 시험 전 상태가 되게 한다. 화면 위에는 결제 모듈 상태(운영 결제 방식·실 상점 키·최근 승인·실패·마지막 시험 결과)
 */
const TESTER_KEY = 'pay_tester';
export async function testerId(sql: ReturnType<typeof db> = db()): Promise<string | null> {
  const [s] = await sql<{ value: any }[]>`select value from app_settings where key = ${TESTER_KEY}`;
  const id = s?.value?.tenant ? String(s.value.tenant) : null;
  if (!id) return null;
  const [t] = await sql`select 1 from tenants where id = ${id} and is_test and deleted_at is null`;
  return t ? id : null;
}
export async function ensureTester(u: SessionUser, ip: string | null): Promise<string> {
  requirePlatform(u);
  const sql = db();
  const have = await testerId(sql); if (have) return have;
  const t = await createTestTenant(u, { name: '결제 시험(고정)' }, ip);
  // 동시에 두 번 눌러도 하나만: 저장된 시험 회사가 살아 있으면 덮지 않고, 방금 만든 회사는 숨김
  const [saved] = await sql`insert into app_settings (key, value) values (${TESTER_KEY}, ${sql.json({ tenant: t.id } as never)})
    on conflict (key) do update set value = excluded.value, updated_at = now()
      where not exists (select 1 from tenants x where x.id = app_settings.value->>'tenant' and x.is_test and x.deleted_at is null) returning key`;
  if (saved) return t.id;
  await sql`update tenants set status = 'deleted', deleted_at = now() where id = ${t.id} and is_test`;
  return (await testerId(sql)) ?? t.id;
}
/** 고정 시험 회사에 남은 승인 결제(취소 안 된 것)를 취소 — 요금제도 결제 전으로. 취소가 안 되는 결제가 있어도 시험은 막지 않음(1시간 자동 취소가 다시 시도) */
export async function settleTester(u: SessionUser, tenant: string, ip: string | null) {
  const sql = db();
  const left = await sql<{ id: string }[]>`select id from payments where tenant = ${tenant} and status in ('paid', 'partial_canceled') order by created_at desc`;
  if (!left.length) return { canceled: 0, failed: 0 };
  const { refundPayment } = await import('./index');
  let canceled = 0; let failed = 0;
  for (const p of left) { try { await refundPayment(u, p.id, { reason: '다음 시험 전 자동 취소', revertPlan: true }, ip); canceled++; } catch { failed++; } }
  return { canceled, failed };
}
/**
 * 결제 모듈 상태 — 운영 결제 방식(실 상점·시험 상점·꺼짐) · 실제 회사 결제(시험 회사 제외)의 최근 7일 승인·실패 · 마지막 승인 · 마지막 시험 결과.
 *  설정 필요 = 실 상점 키가 없어 결제가 꺼짐 · 확인 필요 = 마지막 시험 결제가 실패했거나, 최근 7일 안 실제 결제가 실패로 끝나고 그 뒤 승인이 없음
 *  (실패 = 승인 단계 실패·자동 결제 실패 — 결제창을 닫은 것은 대기로 남아 빼짐)
 */
export async function payStatus() {
  const sql = db();
  const { npConf, npLiveConf } = await import('./nicepay');
  const conf = npConf();
  const mode: 'live' | 'test' | 'off' = conf ? conf.mode : 'off';
  const [r] = await sql<{ ok7: number; fail7: number; last_paid: Date | null }[]>`select
      count(*) filter (where p.status in ('paid', 'canceled', 'partial_canceled') and p.paid_at > now() - interval '7 days')::int as ok7,
      count(*) filter (where p.status = 'failed' and p.created_at > now() - interval '7 days')::int as fail7,
      max(p.paid_at) as last_paid
    from payments p join tenants t on t.id = p.tenant where not t.is_test`;
  const [lf] = await sql<{ msg: string | null; at: Date }[]>`select p.result_msg as msg, p.created_at as at from payments p join tenants t on t.id = p.tenant
    where not t.is_test and p.status = 'failed' order by p.created_at desc limit 1`;
  const [lt] = await sql<{ id: string; status: string; at: Date; msg: string | null; live: boolean }[]>`select p.id, p.status, coalesce(p.paid_at, p.updated_at, p.created_at) as at, p.result_msg as msg,
      coalesce((p.meta->>'liveSmoke') = 'true', false) as live from payments p join tenants t on t.id = p.tenant where t.is_test and p.status <> 'pending' order by coalesce(p.paid_at, p.updated_at, p.created_at) desc limit 1`;
  const failOpen = !!lf && Date.now() - new Date(lf.at).getTime() < 7 * 86_400_000 && (!r.last_paid || new Date(r.last_paid) < new Date(lf.at));
  const reasons: string[] = [];
  if (mode === 'off') reasons.push('실 상점 키가 없어 결제가 꺼져 있습니다 — 고객이 결제할 수 없습니다');
  if (lt?.status === 'failed') reasons.push(`마지막 시험 결제가 실패했습니다${lt.msg ? ` — ${lt.msg}` : ''}`);
  if (failOpen) reasons.push(`최근 실제 결제가 실패로 끝났고 그 뒤 승인이 없습니다${lf?.msg ? ` — ${lf.msg}` : ''}`);
  const state: 'ok' | 'warn' | 'setup' = mode === 'off' ? 'setup' : reasons.length ? 'warn' : 'ok';
  return { state, mode, liveKeys: !!npLiveConf(), reasons, ok7: r.ok7, fail7: r.fail7, lastPaid: r.last_paid, lastFail: lf ? { msg: lf.msg, at: lf.at } : null,
    lastTest: lt ? { id: lt.id, status: lt.status, at: lt.at, msg: lt.msg, live: lt.live } : null };
}
/** 결제 시험 화면 한 번에: 상태 · 고정 시험 회사(없으면 null — 처음 [시험 결제] 때 만듦) · 최근 시험 결제 10건 · 요금제 */
export async function payTestHome(u: SessionUser) {
  requirePlatform(u);
  const sql = db();
  const tester = await testerId(sql);
  const [sub] = tester ? await sql<any[]>`select plan_code, status, billing_cycle from tenant_subscriptions where tenant = ${tester}` : [];
  const payments = await sql`select p.id, p.kind, p.plan_code, p.addon_code, p.amount, p.status, coalesce((p.meta->>'liveSmoke') = 'true', false) as live, p.canceled_amount, p.result_msg, p.paid_at, p.created_at,
      p.meta->>'payMethod' as pay_method, coalesce((p.meta->>'window') = 'true', false) as via_window
    from payments p join tenants t on t.id = p.tenant where t.is_test order by p.created_at desc limit 10`;
  const old = await listTestTenants(u);
  return { status: await payStatus(), tester: tester ? { id: tester, plan_code: sub?.plan_code ?? null, status: sub?.status ?? null, billing_cycle: sub?.billing_cycle ?? null } : null,
    payments, plans: old.plans, liveAvailable: old.liveAvailable, tenants: old.tenants };
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
