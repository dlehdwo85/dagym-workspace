// #1163(대표 11/24 D-20 고객사 관리 고도화): ① 목록 월 매출·다음 결제·미납 · ② 해지 위험 · ③ 회사 타임라인 · ⑤ 세금계산서 요청→발행→보냄 · ⑥ 환불 사유 통계 · ④ 여러 고객사 메일·공지
// 시험 회사(is_test)는 숫자·목록에서 기본 제외
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx, A, B, C;
const signup = async (email, company, marketing = false) => {
  const c = new Client(email);
  const r = await c.ok('POST', '/api/auth/signup', { email, password: 'signup-pass-1234', name: `${company}대표`, mode: 'team', company, industry: '유통·판매', industries: [], agree: { terms: true, age14: true, privacy: true, ai: true, marketing } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  return { c, id: me.user.id, tenant: me.user.tenant };
};
const pay = async (tenant, amount, o = {}) => (await sql`insert into payments (tenant, kind, plan_code, moid, amount, status, canceled_amount, paid_at, tid, meta)
  values (${tenant}, ${o.kind ?? 'subscription'}, 'w_work', ${`M-${Math.random().toString(36).slice(2)}`}, ${amount}, ${o.status ?? 'paid'}, ${o.canceled ?? 0}, ${o.paidAt ?? new Date()}, 'T-x', ${sql.json(o.meta ?? { billing: true, first: true })}) returning id`)[0].id;

before(async () => {
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SEND_CAP_BROADCAST: '3' }); sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  A = await signup('ceo@ops-a.test', '가나상사', true);
  B = await signup('ceo@ops-b.test', '다라상사', false);
  C = await signup('ceo@ops-c.test', '시험상사', true);
  await sql`update tenants set is_test = true where id = ${C.tenant}`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('#1163 고객사 관리 고도화', () => {
  test('① 목록: 이번 달 결제 합계(부가세 포함·환불 뺌)·다음 결제일·미납 일수 · ② 해지 위험(해지 예약·카드 실패·사용량 급감) · 시험 회사 제외', async () => {
    await pay(A.tenant, 22000); await pay(A.tenant, 44000, { status: 'partial_canceled', canceled: 4000 });
    await pay(A.tenant, 99000, { paidAt: new Date(Date.now() - 40 * 86400_000) }); // 지난달 — 빠짐
    await pay(C.tenant, 500000); // 시험 회사 — 합계에서 빠짐
    await sql`update tenant_subscriptions set billing_cycle = 'monthly', next_billing_on = current_date + 10, billing_amount = 22000, cancel_at_period_end = true where tenant = ${A.tenant}`;
    await sql`update tenant_subscriptions set billing_cycle = 'monthly', next_billing_on = current_date - 5, billing_amount = 39000, past_due_since = now() - interval '5 days' where tenant = ${B.tenant}`;
    // 사용량 급감(A): 앞 14일에 업무·로그인이 많고 최근 14일은 적음
    const [unit] = await sql`select id from org_units where tenant = ${A.tenant} limit 1`;
    const [{ n: nowTasks }] = await sql`select count(*)::int n from tasks t join org_units o on o.id = t.org_unit_id where o.tenant = ${A.tenant} and t.created_at >= now() - interval '14 days'`;
    const prevTasks = Math.max(6, nowTasks * 2 + 2);
    for (let k = 0; k < prevTasks; k++) await sql`insert into tasks (org_unit_id, title, created_by, created_at) values (${unit.id}, ${`옛 업무 ${k}`}, ${A.id}, now() - interval '20 days')`;
    const mate = await sql`insert into users (tenant, email, name, role, status) values (${A.tenant}, 'mate@ops-a.test', '동료', 'staff', 'active') returning id`;
    for (const uid of [A.id, mate[0].id]) await sql`insert into audit_logs (actor_id, action, target_type, target_id, created_at) values (${uid}, 'auth.login', 'user', ${uid}, now() - interval '20 days')`;
    await sql`delete from audit_logs where action = 'auth.login' and actor_id = any(${[A.id, mate[0].id]}) and created_at > now() - interval '14 days'`;

    const L = await ctx.owner.ok('GET', '/api/platform/tenants');
    const a = L.tenants.find((t) => t.id === A.tenant), b = L.tenants.find((t) => t.id === B.tenant);
    assert.equal(L.tenants.some((t) => t.id === C.tenant), false, '시험 회사는 목록에 없음');
    assert.equal(a.month_paid, 22000 + 40000, '이번 달 결제 − 환불');
    assert.equal(a.overdue_days, null); assert.equal(b.overdue_days, 5);
    assert.equal(String(a.next_billing_on).slice(0, 10).length, 10);
    assert.deepEqual(a.risks.map((r) => r.code).sort(), ['cancel', 'tasks', 'users'], JSON.stringify(a.risks));
    assert.deepEqual(b.risks.map((r) => r.code), ['card']); assert.match(b.risks[0].label, /미납 5일/);
    assert.equal(L.summary.monthPaidKrw, 62000, '합계에 시험 회사 없음');
    assert.equal(L.summary.risky, 2); assert.equal(L.summary.overdue, 1);
    const d = await ctx.owner.ok('GET', `/api/platform/tenants/${B.tenant}/detail`);
    assert.deepEqual(d.risks.map((r) => r.code), ['card'], '회사 상세에도 사유');
  });

  test('③ 회사 타임라인: 결제·환불·상담 신청·연락·메모·요금제·해지 예약을 시간순 · 종류 거르기 · 운영자만', async () => {
    const pid = await pay(A.tenant, 11000, { kind: 'addon' });
    await sql`insert into audit_logs (actor_id, action, target_type, target_id, detail) values (${ctx.ownerId}, 'billing.refund', 'payment', ${pid}, ${sql.json({ tenant: A.tenant, amount: 11000, reason: '중복 결제', reasonCode: 'duplicate' })})`;
    await sql`insert into audit_logs (actor_id, action, target_type, detail) values (${A.id}, 'billing.canceled', 'tenant', ${sql.json({ tenant: A.tenant })})`;
    await sql`insert into space_consults (tenant, user_id, spaces, memo) values (${A.tenant}, ${A.id}, ${['sales']}, '영업 상담 원함')`;
    await ctx.owner.ok('POST', `/api/platform/tenants/${A.tenant}/contacts`, { kind: 'call', summary: '해지 이유 통화' });
    await ctx.owner.ok('POST', `/api/platform/tenants/${A.tenant}/contacts`, { kind: 'memo', summary: '다음 달 재계약 기대' });
    await ctx.owner.ok('PUT', `/api/platform/tenants/${A.tenant}`, { planCode: 'w_work', status: 'active' });
    const T = await ctx.owner.ok('GET', `/api/platform/tenants/${A.tenant}/timeline`);
    const kinds = new Set(T.items.map((x) => x.kind));
    for (const k of ['pay', 'refund', 'consult', 'contact', 'memo', 'plan', 'cancel']) assert.ok(kinds.has(k), `${k} 없음: ${[...kinds]}`);
    assert.ok(T.items.every((x, i) => !i || T.items[i - 1].at >= x.at), '최근 것부터');
    assert.ok(T.items.some((x) => x.kind === 'refund' && /11,000원 · 사유 중복 결제/.test(x.title)));
    const only = await ctx.owner.ok('GET', `/api/platform/tenants/${A.tenant}/timeline?kinds=contact,memo`);
    assert.ok(only.items.length >= 2 && only.items.every((x) => ['contact', 'memo'].includes(x.kind)));
    assert.equal((await A.c.get(`/api/platform/tenants/${A.tenant}/timeline`)).status, 404);
  });

  test('⑤ 세금계산서: 요청 → 발행 → 보냄(되돌리기·취소) · 결제 목록·상세에 상태 · 감사 기록', async () => {
    const pid = await pay(A.tenant, 22000);
    await A.c.ok('POST', '/api/billing/tax-invoice', { paymentId: pid, companyName: '가나상사', bizNo: '1234567890', email: 'tax@ops-a.test' });
    const req = (await ctx.owner.ok('GET', '/api/platform/tax-invoices')).requests.find((r) => r.payment_id === pid);
    assert.equal(req.status, 'requested');
    const st = async () => (await ctx.owner.ok('GET', `/api/platform/payments/${pid}`)).tax.status;
    for (const s of ['issued', 'sent', 'issued', 'sent']) { await ctx.owner.ok('PATCH', `/api/platform/tax-invoices/${req.id}`, { status: s }); assert.equal(await st(), s); }
    const [row] = await sql`select status, issued_at, sent_at from tax_invoice_requests where id = ${req.id}`;
    assert.ok(row.status === 'issued' && row.issued_at && row.sent_at);
    assert.equal((await ctx.owner.ok('GET', `/api/platform/payments?q=${A.tenant}`)).payments.find((p) => p.id === pid).tax, 'sent');
    assert.equal((await A.c.ok('GET', '/api/billing/tax-invoice')).requests.find((r) => r.payment_id === pid).status, 'sent', '고객 화면도 보냄');
    assert.ok((await sql`select 1 from audit_logs where action = 'tax_invoice.mark' and detail->>'status' = 'sent'`).length);
    await ctx.owner.ok('PATCH', `/api/platform/tax-invoices/${req.id}`, { status: 'canceled' });
    assert.equal((await ctx.owner.ok('GET', `/api/platform/payments/${pid}`)).tax, null, '취소하면 상태 없음(다시 요청 가능)');
    assert.equal((await A.c.req('PATCH', `/api/platform/tax-invoices/${req.id}`, { status: 'sent' })).status, 404, '운영자만');
  });

  test('⑥ 환불 사유 통계: 기간별 사유·금액·건수(예전 글 사유도 나눔) · 시험 회사 기본 제외', async () => {
    const add = async (tenant, amount, detail) => { const pid = await pay(tenant, amount); await sql`insert into audit_logs (actor_id, action, target_type, target_id, detail) values (${ctx.ownerId}, 'billing.refund', 'payment', ${pid}, ${sql.json({ tenant, amount, ...detail })})`; };
    await add(B.tenant, 39000, { reason: '고객 요청', reasonCode: 'customer' });
    await add(B.tenant, 5000, { reason: '시험 결제 자동 취소' }); // 예전 기록(사유 코드 없음) → 시험
    await add(B.tenant, 7000, { reason: '오입금 정정' }); // → 기타
    await add(C.tenant, 100, { reason: '시험', reasonCode: 'test' }); // 시험 회사
    const s = await ctx.owner.ok('GET', '/api/platform/refund-stats');
    const by = Object.fromEntries(s.reasons.map((r) => [r.code, [r.count, r.amount]]));
    assert.deepEqual(by.customer, [1, 39000]); assert.deepEqual(by.duplicate, [1, 11000]); assert.deepEqual(by.test, [1, 5000]); assert.deepEqual(by.other, [1, 7000]);
    assert.equal(s.total.count, 4); assert.ok(s.others.some((o) => o.reason === '오입금 정정'));
    assert.equal(s.months.reduce((n, m) => n + m.count, 0), 4);
    assert.equal((await ctx.owner.ok('GET', '/api/platform/refund-stats?hideTest=0')).total.count, 5, '시험 회사 포함');
    assert.equal((await ctx.owner.ok('GET', '/api/platform/refund-stats?from=2000-01-01&to=2000-01-31')).total.count, 0);
    assert.equal((await A.c.get('/api/platform/refund-stats')).status, 404);
  });

  test('④ 여러 고객사 메일·공지: 미리 보기 → 발송 · 공지는 알림함만·금액 금지 · 광고는 (광고) 표기·수신 동의만 · 하루 상한 · 시험 회사 제외', async () => {
    const tenants = [A.tenant, B.tenant, C.tenant, 'default'];
    assert.equal((await ctx.owner.req('POST', '/api/platform/broadcast', { tenants, channel: 'notice', title: '점검 안내', body: '이번 달 22,000원 결제 안내' })).status, 400, '공지에 금액 금지');
    const pv = await ctx.owner.ok('POST', '/api/platform/broadcast', { tenants, channel: 'notice', title: '12월 1일 점검 안내', body: '새벽 2시~3시 점검합니다' });
    assert.deepEqual([pv.preview.companies, pv.preview.recipients, pv.sent], [2, 2, null], '미리 보기: 시험 회사·우리 회사 빠짐');
    const s1 = await ctx.owner.ok('POST', '/api/platform/broadcast', { tenants, channel: 'notice', title: '12월 1일 점검 안내', body: '새벽 2시~3시 점검합니다', send: true });
    assert.equal(s1.sent, 2);
    const got = await sql`select user_id from notifications where type = 'announcement' and title = '12월 1일 점검 안내'`;
    assert.deepEqual(got.map((x) => x.user_id).sort(), [A.id, B.id].sort());
    assert.equal((await sql`select count(*)::int n from notifications where user_id = ${C.id} and type = 'announcement'`)[0].n, 0);
    // 광고 메일: 수신 동의한 A 만 · 제목 (광고) · 수신 거부 안내
    const ad = await ctx.owner.ok('POST', '/api/platform/broadcast', { tenants, channel: 'mail', ad: true, title: '새 기능 소개', body: '전자계약이 빨라졌습니다' });
    assert.deepEqual([ad.preview.recipients, ad.preview.noConsent], [1, 1]);
    assert.match(ad.preview.sample.subject, /^\(광고\) \[워크인\] 새 기능 소개/); assert.match(ad.preview.sample.text, /수신 거부/);
    const svc = await ctx.owner.ok('POST', '/api/platform/broadcast', { tenants, channel: 'mail', title: '요금 안내', body: '12월부터 부가세 포함 22,000원입니다', send: true });
    assert.equal(svc.sent, 2, '서비스 안내 메일은 동의와 관계없이 · 금액 가능');
    assert.equal((await ctx.owner.req('POST', '/api/platform/broadcast', { tenants, channel: 'mail', title: '두 번째', body: '본문입니다', send: true })).status, 400, '하루 상한(시험 3통) 넘음');
    const [log] = await sql`select detail from audit_logs where action = 'platform.broadcast' and detail->>'channel' = 'mail' order by id desc limit 1`;
    assert.equal(log.detail.sent, 2); assert.ok(!JSON.stringify(log.detail).includes('@'), '받는 주소는 기록하지 않음');
    assert.equal((await A.c.req('POST', '/api/platform/broadcast', { tenants, channel: 'notice', title: '가짜', body: '가짜 공지' })).status, 404);
  });
});
