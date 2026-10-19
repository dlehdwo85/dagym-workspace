// V32 2 정산: 장부(순매출·공급가·VAT·수수료 추정·입금 예정·정산 예정일 D+5 영업일)·월 집계·전월·시험 결제 제외/포함·플랫폼 운영자만(404) · 엑셀 ·
// 입금 대사(CSV: TID 맞음 → 정산 완료+실제 수수료, 금액 다름 → 차이, 장부에 없음, TID 없이 거래일+금액으로 맞춤) · 대사 기록 · 직접 표시 · 미수 목록 · 세금계산서 요청(고객 관리자 → 운영자 발행 체크, 중복 400, 직원 거절) · 회사 상세 정산 상태
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const kst = (iso) => new Date(`${iso}T10:00:00+09:00`);
const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
const d1 = `${month}-01`, d2 = `${month}-02`, d3 = `${month}-03`;
async function bizDays(from, n) { // 주말·공휴일 제외 n 영업일 뒤
  const hol = new Set((await sql`select to_char(date, 'YYYY-MM-DD') as d from holidays`).map((r) => r.d));
  const d = new Date(`${from}T00:00:00Z`); let k = 0;
  while (k < n) { d.setUTCDate(d.getUTCDate() + 1); const dow = d.getUTCDay(); if (dow !== 0 && dow !== 6 && !hol.has(d.toISOString().slice(0, 10))) k++; }
  return d.toISOString().slice(0, 10);
}
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  await sql`insert into tenants (id, name, kind, status, is_test) values ('test_pay', '결제 시험 회사', 'company', 'active', true) on conflict (id) do nothing`;
  const ins = (tenant, kind, plan, moid, tid, amount, canceled, status, paidAt, method, meta = {}) => sql`insert into payments (tenant, kind, plan_code, moid, tid, auth_code, amount, canceled_amount, status, paid_at, card_name, meta, created_by)
    values (${tenant}, ${kind}, ${plan}, ${moid}, ${tid}, ${'A' + tid}, ${amount}, ${canceled}, ${status}, ${paidAt}, ${method === 'CARD' ? '[KB국민]' : null}, ${sql.json({ payMethod: method, ...meta })}, ${ctx.ownerId})`;
  await ins('default', 'subscription', 'w_standard', 'M1', 'T1', 14850, 0, 'paid', kst(d1), 'CARD');
  await ins('default', 'annual', 'w_standard', 'M2', 'T2', 165000, 0, 'paid', kst(d2), 'BANK');
  await ins('default', 'addon', null, 'M3', 'T3', 33000, 3000, 'partial_canceled', kst(d3), 'VBANK');
  await ins('default', 'subscription', 'w_standard', 'M4', 'T4', 14850, 14850, 'canceled', kst(d3), 'CARD');
  await ins('test_pay', 'subscription', 'w_standard', 'M9', 'T9', 14850, 0, 'paid', kst(d1), 'CARD', { test: true });
  await ins('default', 'subscription', 'w_standard', 'M8', 'T8', 9900, 0, 'paid', new Date(kst(d1).getTime() - 20 * 86400_000), 'CARD'); // 전월
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('V32 2 정산', () => {
  test('장부·집계: 순매출/공급가/VAT/수수료 추정/입금 예정, 정산 예정일 D+5 영업일, 시험 결제 제외(포함 옵션), 전월 비교, 직원·일반 관리자는 404', async () => {
    assert.equal((await ctx.staffA.client.req('GET', '/api/platform/settlement')).status, 404);
    const o = await ctx.owner.ok('GET', `/api/platform/settlement?month=${month}`);
    assert.equal(o.ledger.length, 4, '시험 회사 결제는 빠짐');
    const t1 = o.ledger.find((r) => r.tid === 'T1'), t2 = o.ledger.find((r) => r.tid === 'T2'), t3 = o.ledger.find((r) => r.tid === 'T3'), t4 = o.ledger.find((r) => r.tid === 'T4');
    assert.deepEqual([t1.net, t1.supply, t1.vat, t1.fee, t1.feeEstimated, t1.deposit, t1.settlement, t1.pay_method_label], [14850, 13500, 1350, 490, true, 14360, 'pending', '카드']);
    assert.deepEqual([t2.fee, t2.pay_method_label], [2970, '계좌이체'], '계좌이체 1.8%');
    assert.deepEqual([t3.net, t3.fee, t3.deposit, t3.pay_method_label], [30000, 300, 29700, '가상계좌'], '부분 취소 → 순매출, 가상계좌 건당 300원');
    assert.deepEqual([t4.net, t4.fee, t4.settlement], [0, 0, 'canceled'], '전체 취소');
    assert.equal(t1.expected_on, await bizDays(d1, 5), '정산 예정일 = 결제일 + 5 영업일');
    const s = o.summary;
    assert.deepEqual([s.count, s.gross, s.canceled, s.net, s.vat, s.fee, s.deposit, s.pending], [4, 227700, 17850, 209850, 209850 - Math.round(14850 / 1.1) - Math.round(165000 / 1.1) - Math.round(30000 / 1.1), 490 + 2970 + 300, 209850 - 3760, 3]);
    assert.deepEqual(s.byMethod.map((b) => b.key), ['계좌이체', '가상계좌', '카드'], '순매출 큰 순');
    assert.deepEqual([o.prev.count, o.prev.net], [1, 9900], '전월');
    assert.equal(o.daily.length, 3);
    const withTest = await ctx.owner.ok('GET', `/api/platform/settlement?month=${month}&test=1`);
    assert.equal(withTest.ledger.length, 5); assert.equal(withTest.ledger.find((r) => r.tid === 'T9').test, true);
    const x = await fetch(`${BASE}/api/platform/settlement/export?month=${month}`, { headers: { cookie: ctx.owner.cookie, origin: BASE } });
    assert.equal(x.status, 200); assert.equal(Buffer.from(await x.arrayBuffer()).subarray(0, 2).toString(), 'PK');
    assert.equal((await fetch(`${BASE}/api/platform/settlement/export`, { headers: { cookie: ctx.staffA.client.cookie, origin: BASE } })).status, 404);
  });
  test('입금 대사 CSV: TID 맞음 → 정산 완료·실제 수수료·입금일, 금액 다름 → 차이, 장부에 없는 줄, TID 없이 거래일+금액 맞춤 · 대사 기록 · 직접 표시', async () => {
    const csv = `나이스페이 정산 내역\n거래일시,TID,주문번호,거래금액,정산금액,수수료,정산일\n${d1} 10:00:00,T1,M1,14850,14360,490,${month}-08\n${d2} 10:00:00,T2,M2,160000,157000,3000,${month}-09\n${d3} 10:00:00,,,30000,29700,300,${month}-10\n${d1} 10:00:00,TX,MX,5000,4900,100,${month}-08\n합계,,,209850,,,`;
    const r = await ctx.owner.ok('POST', '/api/platform/settlement/reconcile', { fileName: '정산내역.csv', data: b64(csv) });
    assert.deepEqual(r.counts, { rows: 4, matched: 2, mismatched: 1, unmatched: 1 });
    assert.deepEqual(r.rows.map((x) => [x.status, x.moid ?? null]), [['settled', 'M1'], ['mismatch', 'M2'], ['settled', 'M3'], ['unmatched', 'MX']]);
    assert.match(r.rows[1].note, /금액 다름/);
    const o = await ctx.owner.ok('GET', `/api/platform/settlement?month=${month}`);
    const t1 = o.ledger.find((x) => x.tid === 'T1'), t2 = o.ledger.find((x) => x.tid === 'T2'), t3 = o.ledger.find((x) => x.tid === 'T3');
    assert.deepEqual([t1.settlement, t1.settled_on, t1.settled_amount, t1.fee, t1.feeEstimated], ['settled', `${month}-08`, 14360, 490, false]);
    assert.deepEqual([t2.settlement, t2.fee], ['mismatch', 3000], '차이 건도 파일 수수료는 반영');
    assert.deepEqual([t3.settlement, t3.settled_on], ['settled', `${month}-10`], '거래일+금액으로 맞춤');
    assert.deepEqual([o.summary.settled, o.summary.mismatch, o.summary.pending], [2, 1, 0]);
    const up = await ctx.owner.ok('GET', '/api/platform/settlement/uploads');
    assert.deepEqual([up.uploads.length, up.uploads[0].file_name, up.uploads[0].matched, up.uploads[0].unmatched], [1, '정산내역.csv', 2, 1]);
    assert.equal((await ctx.owner.req('POST', '/api/platform/settlement/reconcile', { fileName: 'x.csv', data: b64('이름,나이\n홍,3') })).status, 400, 'TID·주문번호 열 없음');
    // 운영자가 차이 건을 확인하고 직접 정산 완료 표시
    await ctx.owner.ok('PATCH', `/api/platform/settlement/${t2.id}`, { status: 'settled', settledOn: `${month}-09`, settledAmount: 157000, note: '부분 환불 반영 확인' });
    const o2 = await ctx.owner.ok('GET', `/api/platform/settlement?month=${month}`);
    assert.deepEqual([o2.ledger.find((x) => x.tid === 'T2').settlement, o2.summary.settled, o2.summary.mismatch], ['settled', 3, 0]);
    assert.equal((await ctx.staffA.client.req('PATCH', `/api/platform/settlement/${t2.id}`, { status: 'pending' })).status, 404);
  });
  test('미수(던닝) 목록 · 회사 상세 결제 줄에 정산 상태', async () => {
    const r = await sql`insert into tenant_subscriptions (tenant, plan_code, past_due_since, billing_amount, retry_count) values ('default', (select code from plans order by sort limit 1), now() - interval '3 days', 14850, 1)
      on conflict (tenant) do update set past_due_since = excluded.past_due_since, billing_amount = excluded.billing_amount, retry_count = excluded.retry_count`;
    assert.equal(r.count, 1);
    const o = await ctx.owner.ok('GET', `/api/platform/settlement?month=${month}`);
    assert.deepEqual(o.late.map((l) => [l.tenant, l.unpaid, l.days, l.retry_count]), [['default', 14850, 3, 1]]);
    await sql`update tenant_subscriptions set past_due_since = null, retry_count = 0 where tenant = 'default'`;
    const detail = await ctx.owner.ok('GET', '/api/platform/tenants/default/detail');
    const p1 = detail.payments.find((p) => p.id === o.ledger.find((x) => x.tid === 'T1').id);
    assert.deepEqual([p1.settlement, p1.settled_on], ['settled', `${month}-08`]);
  });
  test('세금계산서: 고객 관리자 요청(사업자번호 정리·결제 완료 건만·중복 400·직원 거절) → 운영자 목록 → 발행 체크 → 고객 화면에 발행됨', async () => {
    const [p] = await sql`select id from payments where tid = 'T1'`;
    const [pc] = await sql`select id from payments where tid = 'T4'`;
    assert.ok([403, 404].includes((await ctx.staffA.client.req('POST', '/api/billing/tax-invoice', { paymentId: p.id, companyName: '다짐', bizNo: '1234567890', email: 'tax@dagym.test' })).status));
    assert.equal((await ctx.owner.req('POST', '/api/billing/tax-invoice', { paymentId: pc.id, companyName: '다짐', bizNo: '1234567890', email: 'tax@dagym.test' })).status, 400, '전체 취소 건은 안 됨');
    assert.equal((await ctx.owner.req('POST', '/api/billing/tax-invoice', { paymentId: p.id, companyName: '다짐', bizNo: '12-34', email: 'tax@dagym.test' })).status, 400, '사업자번호 형식');
    const r = await ctx.owner.ok('POST', '/api/billing/tax-invoice', { paymentId: p.id, companyName: '주식회사 다짐', bizNo: '1234567890', ceo: '김대표', email: 'Tax@dagym.test' });
    assert.equal((await ctx.owner.req('POST', '/api/billing/tax-invoice', { paymentId: p.id, companyName: '다짐', bizNo: '1234567890', email: 'tax@dagym.test' })).status, 400, '중복');
    const mine = await ctx.owner.ok('GET', '/api/billing/tax-invoice');
    assert.deepEqual([mine.requests.length, mine.requests[0].biz_no, mine.requests[0].email, mine.requests[0].amount, mine.requests[0].status], [1, '123-45-67890', 'tax@dagym.test', 14850, 'requested']);
    assert.deepEqual((await ctx.staffA.client.ok('GET', '/api/billing/tax-invoice')).defaults, null, '직원은 기본값 없음(버튼 숨김)');
    const list = await ctx.owner.ok('GET', '/api/platform/tax-invoices');
    assert.deepEqual([list.requests.length, list.requests[0].tenant_name !== undefined, list.requests[0].plan_code], [1, true, 'w_standard']);
    assert.equal((await ctx.owner.ok('GET', `/api/platform/settlement?month=${month}`)).taxOpen, 1);
    await ctx.owner.ok('PATCH', `/api/platform/tax-invoices/${r.id}`, { status: 'issued' });
    const after_ = await ctx.owner.ok('GET', '/api/billing/tax-invoice');
    assert.equal(after_.requests[0].status, 'issued'); assert.ok(after_.requests[0].issued_at);
    assert.equal((await ctx.owner.ok('GET', `/api/platform/settlement?month=${month}`)).taxOpen, 0);
    assert.equal((await ctx.staffA.client.req('GET', '/api/platform/tax-invoices')).status, 404);
  });
});
