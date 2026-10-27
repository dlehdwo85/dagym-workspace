// 18차 나이스페이 결제 — 가짜 나이스페이 서버(공개 문서 규격: SignData·EncData·결과코드)로 시험. 실결제·실제 테스트 MID 통신은 아님
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, createDecipheriv, randomInt } from 'node:crypto';
import { Client, bootstrap, resetDb, startServer, testDb, tick, BASE } from '../helpers.mjs';

const MID = 'nictest00m', KEY = 'TESTKEYabcdefghij0123456789', BMID = 'nictest04m', BKEY = 'BILLKEY0123456789zzzz';
const LIVE_MID = 'walkin001m', LIVE_KEY = 'REAL-KEY-NEVER-USED-IN-TEST'; // V36 8 실결제 소액 시험만 실 상점(가짜 서버)
const NP_PORT = 3202, NP = `http://localhost:${NP_PORT}`;
const sha = (s) => createHash('sha256').update(s).digest('hex');
const state = { failBids: new Set(), calls: [] };
let np, srv, ctx, sql;

function fakeNice() {
  return http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      const f = Object.fromEntries(new URLSearchParams(body));
      state.calls.push({ path: req.url, f });
      const j = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      const p = req.url;
      if (p === '/webapi/billing/billing_regist.jsp') {
        if (f.SignData !== sha(f.MID + f.EdiDate + f.Moid + BKEY)) return j({ ResultCode: 'F113', ResultMsg: '위변조' });
        const d = createDecipheriv('aes-128-ecb', Buffer.from(BKEY.slice(0, 16)), null);
        const plain = Buffer.concat([d.update(Buffer.from(f.EncData, 'hex')), d.final()]).toString();
        const card = new URLSearchParams(plain).get('CardNo');
        if (card.endsWith('0000')) return j({ ResultCode: 'F112', ResultMsg: '유효하지않은 카드번호' });
        return j({ ResultCode: 'F100', ResultMsg: '빌키가 정상적으로 생성되었습니다.', BID: `BIKY${BMID}${Date.now()}${randomInt(1000)}`, CardName: '[KB국민]', CardCode: '02', TID: 'x' });
      }
      if (p === '/webapi/billing/billing_approve.jsp') {
        if (f.SignData !== sha(f.MID + f.EdiDate + f.Moid + f.Amt + f.BID + BKEY)) return j({ ResultCode: 'F113', ResultMsg: '위변조' });
        if (state.failBids.has('*')) return j({ ResultCode: '3011', ResultMsg: '카드 한도 초과' });
        return j({ ResultCode: '3001', ResultMsg: '카드 결제 성공', TID: f.TID, Moid: f.Moid, Amt: f.Amt.padStart(12, '0'), AuthCode: '30042096', CardName: 'KB국민', CardNo: '12345678****1234', MID: f.MID });
      }
      if (p === '/webapi/billing/billkey_remove.jsp') return j({ ResultCode: f.SignData === sha(f.MID + f.EdiDate + f.Moid + f.BID + BKEY) ? 'F101' : 'F113', BID: f.BID });
      if (p === '/webapi/pay_process.jsp') {
        const PK = f.MID === LIVE_MID ? LIVE_KEY : KEY;
        if (f.SignData !== sha(f.AuthToken + f.MID + f.Amt + f.EdiDate + PK)) return j({ ResultCode: 'F113', ResultMsg: '위변조' });
        const sig = sha(f.TID + f.MID + f.Amt.padStart(12, '0') + PK);
        // 시험: 인증 토큰 앞글자로 결제 수단 흉내(vb = 가상계좌 발급, bk = 계좌이체)
        if (f.AuthToken.startsWith('vb')) return j({ ResultCode: '4100', ResultMsg: '가상계좌 발급 성공', PayMethod: 'VBANK', TID: f.TID, MID: f.MID, Amt: f.Amt.padStart(12, '0'), VbankBankName: '국민', VbankNum: '12345678901234', VbankExpDate: '20991231', Signature: sig });
        if (f.AuthToken.startsWith('bk')) return j({ ResultCode: '4000', ResultMsg: '계좌이체 성공', PayMethod: 'BANK', TID: f.TID, MID: f.MID, Amt: f.Amt.padStart(12, '0'), BankName: '신한', Signature: sig });
        return j({ ResultCode: '3001', ResultMsg: '카드 결제 성공', TID: f.TID, MID: f.MID, Amt: f.Amt.padStart(12, '0'), AuthCode: '11112222', CardName: '신한', CardNo: '45678912****9876', Signature: sig });
      }
      if (p === '/webapi/cancel_process.jsp') {
        const k = f.MID === BMID ? BKEY : f.MID === LIVE_MID ? LIVE_KEY : KEY;
        if (f.SignData !== sha(f.MID + f.CancelAmt + f.EdiDate + k)) return j({ ResultCode: '2003', ResultMsg: '위변조' });
        return j({ ResultCode: '2001', ResultMsg: '취소 성공', CancelAmt: f.CancelAmt, TID: f.TID });
      }
      res.statusCode = 404; res.end('no');
    });
  }).listen(NP_PORT);
}

let owner, tid, platform;
before(async () => {
  await resetDb();
  np = fakeNice();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', NICEPAY_MODE: 'test', NICEPAY_PAY_MID: 'walkin001m', NICEPAY_PAY_KEY: 'REAL-KEY-NEVER-USED-IN-TEST', NICEPAY_BILL_MID: 'walkin002m', NICEPAY_BILL_KEY: 'REAL-BILL-KEY-NEVER-USED', /* 실 키는 있어도 시험 모드에선 안 씀 */ NICEPAY_TEST_PAY_MID: MID, NICEPAY_TEST_PAY_KEY: KEY, NICEPAY_TEST_BILL_MID: BMID, NICEPAY_TEST_BILL_KEY: BKEY, NICEPAY_API_BASE: NP });
  sql = testDb();
  ctx = await bootstrap();
  platform = ctx.owner;
  owner = new Client('payer');
  const r = await owner.ok('POST', '/api/auth/signup', { email: 'payer@example.com', name: '결제씨', mode: 'team', company: '결제상사', password: 'signup-pass-1234', agree: { terms: true, age14: true, privacy: true, ai: true, marketing: false } });
  await owner.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  await owner.ok('POST', '/api/auth/login', { email: 'payer@example.com', password: 'signup-pass-1234' });
  tid = (await owner.ok('GET', '/api/auth/me')).user.tenant;
});
after(async () => { srv?.proc.kill(); np?.close(); await sql?.end(); });

const postForm = (path, form) => fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://web.nicepay.co.kr' }, body: new URLSearchParams(form).toString() });
const sub = async () => (await sql`select * from tenant_subscriptions where tenant = ${tid}`)[0];

describe('18차 나이스페이 결제', () => {
  test('우리 회사·직원은 결제 칸 없음, 견적 = 1인 요금 × 최소 3인 × VAT', async () => {
    assert.deepEqual((await ctx.owner.ok('GET', '/api/billing')), { enabled: false, internal: true }, '내부 요금제 회사 — 결제 없음(404 아님)');
    const b = await owner.ok('GET', '/api/billing');
    assert.equal(b.enabled, true); assert.equal(b.mode, 'test');
    assert.deepEqual(b.easyPays, [], '200차 #706 간편결제는 NICEPAY_EASY_PAY 로 켜지 않으면 없음');
    assert.equal((await owner.post('/api/billing/window', { kind: 'monthly', planCode: 'w_standard', easyPay: 'naverpay', agree: true })).status, 400, '켜지 않은 간편결제는 안 열림');
    const team = b.quotes.find((q) => q.planCode === 'w_standard' && q.cycle === 'monthly');
    assert.equal(team.seats, 3); assert.equal(team.amount, Math.round(4500 * 3 * 1.1));
    assert.equal(b.quotes.find((q) => q.planCode === 'w_standard' && q.cycle === 'annual').amount, Math.round(3600 * 3 * 12 * 1.1));
  });

  test('카드 등록: 실패 카드 400, 성공하면 끝 4자리만(카드번호 저장 안 함), 서명·암호화 규격', async () => {
    assert.equal((await owner.post('/api/billing/card', { cardNo: '4111111111110000', expYear: '29', expMonth: '12' })).status, 400);
    const r = await owner.ok('POST', '/api/billing/card', { cardNo: '4111111111111234', expYear: '29', expMonth: '12', idNo: '900101', cardPw: '12' });
    assert.equal(r.card.card_last4, '1234');
    const [c] = await sql`select * from billing_cards where tenant = ${tid}`;
    assert.ok(!JSON.stringify(c).includes('4111111111111234') && !c.bid_enc.startsWith('BIKY'), '카드번호·빌키 원문 없음');
    const regs = state.calls.filter((x) => x.path.endsWith('billing_regist.jsp'));
    assert.ok(regs.every((x) => !JSON.stringify(x.f).includes('4111111111111234')), '카드번호는 암호화되어 전송');
  });

  test('월 구독: 바로 첫 달 결제 → active·다음 결제일 한 달 뒤, 결제 내역', async () => {
    assert.equal((await owner.post('/api/billing/subscribe', { planCode: 'w_standard' })).status, 400, 'V34-B 정기결제 동의 없으면 결제 안 함');
    assert.equal((await sql`select count(*)::int c from payments where tenant = ${tid} and kind = 'subscription'`)[0].c, 0);
    const r = await owner.ok('POST', '/api/billing/subscribe', { planCode: 'w_standard', consent: true });
    assert.equal(r.amount, 14850);
    const [bc] = await sql`select plan_code, amount_krw, cycle, text, terms_version, user_id from billing_consents where tenant = ${tid}`;
    assert.deepEqual([bc.plan_code, bc.amount_krw, bc.cycle, bc.user_id], ['w_standard', 14850, 'monthly', (await owner.ok('GET', '/api/auth/me')).user.id]);
    assert.match(bc.text, /매월 14,850원/); assert.match(bc.text, /해지/); assert.ok(bc.terms_version);
    assert.equal((await owner.ok('GET', '/api/billing')).autoRenewConsent.amount_krw, 14850);
    const s = await sub();
    assert.equal(s.status, 'active'); assert.equal(s.plan_code, 'w_standard'); assert.equal(s.billing_cycle, 'monthly');
    const b = await owner.ok('GET', '/api/billing');
    assert.equal(b.payments[0].status, 'paid'); assert.equal(b.payments[0].card_no, '12345678****1234');
  });

  test('연간 결제창: 서명 파라미터 → 인증 응답(위변조면 실패) → 승인 → 연간 전환', async () => {
    const w = await owner.ok('POST', '/api/billing/window', { kind: 'annual', planCode: 'w_standard' });
    const p = w.params;
    assert.equal(p.SignData, sha(p.EdiDate + MID + p.Amt + KEY)); assert.equal(p.MID, MID); assert.match(p.ReturnURL, /\/api\/billing\/nicepay\/return$/);
    const auth = (sig) => ({ AuthResultCode: '0000', AuthResultMsg: '인증 성공', AuthToken: 'tok123', PayMethod: 'CARD', MID, Moid: p.Moid, Amt: p.Amt, TxTid: `${MID}01012610141200001234`,
      Signature: sig, NextAppURL: `${NP}/webapi/pay_process.jsp`, NetCancelURL: `${NP}/webapi/cancel_process.jsp` });
    const bad = await postForm('/api/billing/nicepay/return', auth('tampered'));
    assert.equal(bad.status, 303); assert.match(bad.headers.get('location'), /payfail=/);
    assert.equal((await sql`select status from payments where moid = ${p.Moid}`)[0].status, 'failed');
    const w2 = await owner.ok('POST', '/api/billing/window', { kind: 'annual', planCode: 'w_standard' });
    const ok = await postForm('/api/billing/nicepay/return', { ...auth(sha('tok123' + MID + w2.params.Amt + KEY)), Moid: w2.params.Moid, Amt: w2.params.Amt });
    assert.match(ok.headers.get('location'), /paid=1/);
    assert.equal((await sub()).billing_cycle, 'annual');
    const again = await postForm('/api/billing/nicepay/return', { ...auth(sha('tok123' + MID + w2.params.Amt + KEY)), Moid: w2.params.Moid, Amt: w2.params.Amt });
    assert.match(again.headers.get('location'), /paid=1/, '새로고침해도 한 번만');
  });

  test('결제통보: 주문번호·금액이 맞을 때만 반영, 같은 통보는 한 번만, "OK"', async () => {
    const w = await owner.ok('POST', '/api/billing/window', { kind: 'addon', addonCode: 'storage50_v27' });
    const noti = (amt) => ({ MID, MOID: w.params.Moid, Amt: String(amt), TID: 'NOTITID000000001', ResultCode: '3001', StateCd: '0', AuthCode: '1234', PayMethod: 'CARD' });
    const wrong = await postForm('/api/billing/nicepay/notify', { ...noti(1), TID: 'NOTITID-WRONG' });
    assert.equal(await wrong.text(), 'OK');
    assert.equal((await sql`select status from payments where moid = ${w.params.Moid}`)[0].status, 'pending', '금액 다르면 무시');
    for (let k = 0; k < 2; k++) assert.equal(await (await postForm('/api/billing/nicepay/notify', noti(w.params.Amt))).text(), 'OK');
    assert.equal((await sql`select status from payments where moid = ${w.params.Moid}`)[0].status, 'paid');
    assert.equal((await sub()).addons.storage50_v27, 1, '팩 1개만 더해짐');
  });

  test('V29 결제창 결제 수단: 가상계좌 → 입금 대기(계좌 표시) → 입금 통보 4110 에 월 구독 적용·영수증 메일 · 계좌이체는 바로 완료', async () => {
    const w = await owner.ok('POST', '/api/billing/window', { kind: 'monthly', planCode: 'w_standard', payMethod: 'VBANK' });
    assert.equal(w.params.PayMethod, 'VBANK'); assert.match(w.params.VbankExpDate, /^\d{8}$/); assert.equal(w.params.MID, MID, '결제창 MID');
    const auth = (tok, p) => ({ AuthResultCode: '0000', AuthToken: tok, PayMethod: 'VBANK', MID, Moid: p.Moid, Amt: p.Amt, TxTid: `${MID}03012610150900001111`,
      Signature: sha(tok + MID + p.Amt + KEY), NextAppURL: `${NP}/webapi/pay_process.jsp`, NetCancelURL: `${NP}/webapi/cancel_process.jsp` });
    const before = await sub();
    const r = await postForm('/api/billing/nicepay/return', auth('vbtok1', w.params));
    assert.equal(new URL(r.headers.get('location')).searchParams.get('vbank'), '국민 12345678901234 으로 입금하면 바로 적용됩니다');
    let [pay] = await sql`select * from payments where moid = ${w.params.Moid}`;
    assert.equal(pay.status, 'pending'); assert.equal(pay.meta.vbank.num, '12345678901234');
    assert.equal((await sub()).plan_code, before.plan_code, '입금 전에는 그대로');
    const b = await owner.ok('GET', '/api/billing');
    assert.equal(b.payments.find((x) => x.id === pay.id).vbank.bank, '국민');
    assert.equal(await (await postForm('/api/billing/nicepay/notify', { MID, MOID: w.params.Moid, Amt: w.params.Amt, TID: pay.tid, ResultCode: '4110', StateCd: '0', PayMethod: 'VBANK' })).text(), 'OK');
    [pay] = await sql`select * from payments where moid = ${w.params.Moid}`;
    assert.equal(pay.status, 'paid'); assert.equal(pay.result_msg, '가상계좌 입금 확인'); assert.ok(pay.meta.receiptSentAt, '영수증 메일');
    const s1 = await sub(); assert.equal(s1.plan_code, 'w_standard'); assert.equal(s1.billing_cycle, 'monthly');
    const w2 = await owner.ok('POST', '/api/billing/window', { kind: 'addon', addonCode: 'storage50_v27', payMethod: 'BANK' });
    const r2 = await postForm('/api/billing/nicepay/return', { ...auth('bktok', w2.params), PayMethod: 'BANK' });
    assert.match(r2.headers.get('location'), /paid=1/);
    assert.equal((await sql`select meta->>'payMethod' pm from payments where moid = ${w2.params.Moid}`)[0].pm, 'BANK');
  });

  test('V28 B2 던닝: 결제 실패 → 알림·메일·3일 뒤 재시도 → 7일 미납 읽기 전용(402) → 30일 이용 중지(보기도 402, 결제 화면은 열림) → 유예 연장 → 결제 성공하면 즉시 복구', async () => {
    await sql`update tenant_subscriptions set billing_cycle = 'monthly', next_billing_on = current_date, past_due_since = null, retry_count = 0, billing_lock = null where tenant = ${tid}`;
    state.failBids.add('*');
    await tick();
    let s = await sub();
    assert.ok(s.past_due_since); assert.equal(s.status, 'active'); assert.equal(s.billing_lock, null);
    assert.equal(String(s.next_retry_on).slice(0, 10) > new Date().toISOString().slice(0, 10), true, '3일 뒤 재시도 예약');
    const n = await sql`select n.title from notifications n join users u on u.id = n.user_id where u.email = 'payer@example.com' and n.title = '구독 결제에 실패했습니다'`;
    assert.equal(n.length, 1);
    // 7일 미납 → 읽기 전용
    await sql`update tenant_subscriptions set past_due_since = now() - interval '8 days', next_retry_on = current_date, retry_count = 1 where tenant = ${tid}`;
    await tick();
    s = await sub();
    assert.equal(s.billing_lock, 'read_only'); assert.equal(s.status, 'active');
    assert.equal((await owner.post('/api/tasks', { title: '막힘' })).status, 402);
    assert.equal((await owner.get('/api/tasks')).status, 200, '읽기 전용은 보기 가능');
    // 30일 미납 → 이용 중지(보기도 막힘, 결제·요금 화면은 열림)
    await sql`update tenant_subscriptions set past_due_since = now() - interval '31 days', next_retry_on = null where tenant = ${tid}`;
    await tick();
    assert.equal((await sub()).billing_lock, 'suspended');
    const blocked = await owner.get('/api/tasks');
    assert.equal(blocked.status, 402); assert.equal(blocked.body.error.code, 'suspended');
    assert.equal((await owner.get('/api/billing')).status, 200, '결제 화면은 열림');
    // 플랫폼 유예 → 잠금 풀림, 유예 동안 다시 잠그지 않음
    const pf = ctx.owner; await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
    await pf.ok('POST', `/api/platform/tenants/${tid}/billing`, { action: 'grace', days: 7 });
    assert.equal((await sub()).billing_lock, null);
    await tick();
    assert.equal((await sub()).billing_lock, null, '유예 중에는 잠그지 않음');
    assert.equal((await owner.post(`/api/platform/tenants/${tid}/billing`, { action: 'unlock' })).status, 404, '플랫폼 운영자만');
    // 결제 성공 → 즉시 복구
    state.failBids.clear();
    await sql`update tenant_subscriptions set billing_lock = 'suspended', billing_grace_until = null where tenant = ${tid}`;
    await owner.ok('POST', '/api/billing/subscribe', { planCode: 'w_standard', consent: true });
    s = await sub();
    assert.equal(s.billing_lock, null); assert.equal(s.past_due_since, null);
    await owner.ok('POST', '/api/tasks', { title: '다시 씀' });
  });

  test('해지 예약 → 다음 결제일에 결제 없이 종료(읽기 전용), 해지 취소 가능', async () => {
    await owner.ok('POST', '/api/billing/autorenew', { renew: false });
    assert.equal((await sub()).cancel_at_period_end, true);
    await owner.ok('POST', '/api/billing/autorenew', { renew: true });
    await owner.ok('POST', '/api/billing/autorenew', { renew: false });
    const before = (await sql`select count(*)::int n from payments where tenant = ${tid}`)[0].n;
    await sql`update tenant_subscriptions set next_billing_on = current_date where tenant = ${tid}`;
    await tick();
    assert.equal((await sub()).status, 'expired');
    assert.equal((await sql`select count(*)::int n from payments where tenant = ${tid}`)[0].n, before, '결제하지 않음');
  });

  test('환불: 플랫폼 운영자만, 부분 → 전체, 남은 금액 초과 400', async () => {
    const [p] = await sql`select id, amount from payments where tenant = ${tid} and status = 'paid' and kind = 'subscription' order by created_at limit 1`;
    assert.ok([402, 404].includes((await owner.post(`/api/platform/payments/${p.id}/refund`, { amount: 100, reason: 'x' })).status), '플랫폼 운영자만');
    await platform.ok('POST', `/api/platform/payments/${p.id}/refund`, { amount: 1000, reason: '부분 환불' });
    assert.equal((await sql`select status, canceled_amount from payments where id = ${p.id}`)[0].status, 'partial_canceled');
    assert.equal((await platform.req('POST', `/api/platform/payments/${p.id}/refund`, { amount: p.amount, reason: '초과' })).status, 400);
    await platform.ok('POST', `/api/platform/payments/${p.id}/refund`, { reason: '나머지' });
    assert.equal((await sql`select status from payments where id = ${p.id}`)[0].status, 'canceled');
    const cancel = state.calls.filter((x) => x.path.endsWith('cancel_process.jsp')).at(-1);
    assert.equal(cancel.f.MID, BMID, '빌링 결제는 빌링 MID 로 취소');
  });
  test('V32 1 결제 시험 회사: 플랫폼만 만듦 → 시험 상점 결제창 → 승인 후 자동 확인 → 자동 결제 제외 → 취소하면 원복 · 1시간 지난 시험 결제 자동 취소', async () => {
    await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
    assert.equal((await ctx.staffA.client.post('/api/platform/pay-test', {})).status, 404, '플랫폼 운영자만');
    const t = await platform.ok('POST', '/api/platform/pay-test', { name: '결제시험A' });
    assert.match(t.id, /^test_/);
    assert.equal((await sql`select is_test from tenants where id = ${t.id}`)[0].is_test, true);
    assert.equal((await sql`select count(*)::int n from users where tenant = ${t.id}`)[0].n, 0, '로그인 계정 없음');
    assert.equal((await platform.req('POST', `/api/platform/pay-test/${tid}/window`, { kind: 'monthly', planCode: 'w_standard', payMethod: 'CARD' })).status, 400, '시험 회사만');
    const w = await platform.ok('POST', `/api/platform/pay-test/${t.id}/window`, { kind: 'monthly', planCode: 'w_standard', payMethod: 'CARD' });
    assert.equal(w.mode, 'test'); assert.equal(w.params.MID, MID, '시험 상점');
    const [pay] = await sql`select id, meta from payments where moid = ${w.params.Moid}`;
    assert.equal(pay.meta.test, true); assert.equal(pay.meta.prev.plan_code, 'trial');
    const r = await postForm('/api/billing/nicepay/return', { AuthResultCode: '0000', AuthResultMsg: '인증 성공', AuthToken: 'tok777', PayMethod: 'CARD', MID, Moid: w.params.Moid, Amt: w.params.Amt,
      TxTid: `${MID}01012610141200007777`, Signature: sha('tok777' + MID + w.params.Amt + KEY), NextAppURL: `${NP}/webapi/pay_process.jsp`, NetCancelURL: `${NP}/webapi/cancel_process.jsp` });
    assert.equal(r.headers.get('location'), `${BASE}/platform?tab=paytest&check=${pay.id}`);
    let c = await platform.ok('GET', `/api/platform/pay-test/check?payment=${pay.id}`);
    const st = (k) => c.checks.find((x) => x.key === k).state;
    assert.deepEqual(['approved', 'plan', 'history', 'receipt', 'ledger', 'revert'].map(st), ['ok', 'ok', 'ok', 'ok', 'later', 'wait']);
    // 자동 결제·가입 목록에서 빠짐
    await sql`update tenant_subscriptions set next_billing_on = current_date where tenant = ${t.id}`;
    await tick();
    assert.equal((await sql`select count(*)::int n from payments where tenant = ${t.id}`)[0].n, 1, '자동 결제 안 함');
    assert.ok(!(await platform.ok('GET', '/api/platform/signups')).tenants.some((x) => x.id === t.id), '가입 목록 제외');
    // 취소 → 원복
    await platform.ok('POST', `/api/platform/payments/${pay.id}/refund`, { reason: '시험 결제 취소', revertPlan: true });
    c = await platform.ok('GET', `/api/platform/pay-test/check?payment=${pay.id}`);
    assert.equal(st('revert'), 'ok');
    const s2 = (await sql`select plan_code, status from tenant_subscriptions where tenant = ${t.id}`)[0];
    assert.deepEqual([s2.plan_code, s2.status], ['trial', 'trial']);
    // 1시간 지난 시험 결제는 정기 실행이 취소
    const w2 = await platform.ok('POST', `/api/platform/pay-test/${t.id}/window`, { kind: 'annual', planCode: 'w_standard', payMethod: 'CARD' });
    await postForm('/api/billing/nicepay/return', { AuthResultCode: '0000', AuthResultMsg: '인증 성공', AuthToken: 'tok778', PayMethod: 'CARD', MID, Moid: w2.params.Moid, Amt: w2.params.Amt,
      TxTid: `${MID}01012610141200007778`, Signature: sha('tok778' + MID + w2.params.Amt + KEY), NextAppURL: `${NP}/webapi/pay_process.jsp`, NetCancelURL: `${NP}/webapi/cancel_process.jsp` });
    await sql`update payments set paid_at = now() - interval '2 hours' where moid = ${w2.params.Moid}`;
    await tick();
    assert.equal((await sql`select status from payments where moid = ${w2.params.Moid}`)[0].status, 'canceled');
    assert.equal((await sql`select plan_code from tenant_subscriptions where tenant = ${t.id}`)[0].plan_code, 'trial');
    // 빈 통보는 운영자 알림 없이 OK
    const before = (await sql`select count(*)::int n from error_logs`.catch(() => [{ n: 0 }]))[0].n;
    assert.equal(await (await postForm('/api/billing/nicepay/notify', {})).text(), 'OK');
    assert.equal((await sql`select count(*)::int n from error_logs`.catch(() => [{ n: 0 }]))[0].n, before);
  });
  test('시험 모드는 실제 MID·키를 쓰지 않음(결제 서버로 간 요청 전부 시험 상점)', async () => {
    assert.ok(state.calls.length > 0);
    assert.ok(state.calls.every((c) => !['walkin001m', 'walkin002m'].includes(c.f.MID)), '실 MID 로 나간 요청 없음');
    assert.ok(!JSON.stringify(state.calls).includes('REAL-'), '실 키로 서명한 흔적 없음');
  });
  test('V36 8 실결제 소액 시험: 운영자·시험 회사·확인 문구·100원·실 상점 → 요금제 그대로 → 하루 3회 → 1시간 뒤 자동 취소(실 상점으로)', async () => {
    await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
    const t = await platform.ok('POST', '/api/platform/pay-test', { name: '실결제시험' });
    assert.equal((await platform.req('POST', `/api/platform/pay-test/${t.id}/live`, { confirm: '네' })).status, 400, '확인 문구');
    assert.equal((await ctx.staffA.client.post(`/api/platform/pay-test/${t.id}/live`, { confirm: '실결제 100원' })).status, 404);
    assert.equal((await platform.req('POST', `/api/platform/pay-test/${tid}/live`, { confirm: '실결제 100원' })).status, 400, '시험 회사만');
    const w = await platform.ok('POST', `/api/platform/pay-test/${t.id}/live`, { confirm: '실결제 100원' });
    assert.equal(w.mode, 'live'); assert.equal(w.params.MID, LIVE_MID); assert.equal(Number(w.params.Amt), 100);
    assert.equal(w.params.SignData, sha(w.params.EdiDate + LIVE_MID + w.params.Amt + LIVE_KEY));
    const r = await postForm('/api/billing/nicepay/return', { AuthResultCode: '0000', AuthResultMsg: '인증 성공', AuthToken: 'tok900', PayMethod: 'CARD', MID: LIVE_MID, Moid: w.params.Moid, Amt: w.params.Amt,
      TxTid: `${LIVE_MID}01012610141200009000`, Signature: sha('tok900' + LIVE_MID + w.params.Amt + LIVE_KEY), NextAppURL: `${NP}/webapi/pay_process.jsp`, NetCancelURL: `${NP}/webapi/cancel_process.jsp` });
    assert.equal(r.headers.get('location'), `${BASE}/platform?tab=paytest&check=${w.paymentId}`);
    assert.equal((await sql`select status from payments where id = ${w.paymentId}`)[0].status, 'paid');
    assert.equal((await sql`select plan_code from tenant_subscriptions where tenant = ${t.id}`)[0].plan_code, 'trial', '요금제 그대로');
    const c = await platform.ok('GET', `/api/platform/pay-test/check?payment=${w.paymentId}`);
    assert.equal(c.checks.find((x) => x.key === 'plan').state, 'later'); assert.equal(c.payment.live, true);
    await platform.ok('POST', `/api/platform/pay-test/${t.id}/live`, { confirm: '실결제 100원' });
    await platform.ok('POST', `/api/platform/pay-test/${t.id}/live`, { confirm: '실결제 100원' });
    assert.equal((await platform.req('POST', `/api/platform/pay-test/${t.id}/live`, { confirm: '실결제 100원' })).status, 429, '하루 3번');
    await sql`update payments set paid_at = now() - interval '2 hours' where id = ${w.paymentId}`;
    await tick();
    assert.equal((await sql`select status from payments where id = ${w.paymentId}`)[0].status, 'canceled');
    assert.equal(state.calls.filter((x) => x.path.endsWith('cancel_process.jsp')).at(-1).f.MID, LIVE_MID, '실 상점으로 취소');
    assert.ok((await sql`select 1 from audit_logs where action = 'platform.live_smoke_started'`).length);
  });
  test('192차 결제 시험 화면(대표 10/27): 결제 모듈 상태(정상↔확인 필요) · 숨은 시험 계정 하나를 다시 씀 · 다음 시험 전 지난 시험 결제 자동 취소 · 고객사 목록에 없음', async () => {
    await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
    const W = { kind: 'monthly', planCode: 'w_standard', payMethod: 'CARD' };
    assert.equal((await ctx.staffA.client.req('GET', '/api/platform/pay-test')).status, 404, '플랫폼 운영자만');
    assert.equal((await ctx.staffA.client.post('/api/platform/pay-test/tester/window', W)).status, 404);
    let h = await platform.ok('GET', '/api/platform/pay-test');
    assert.equal(h.tester, null, '처음엔 시험 계정 없음(첫 [시험 결제] 때 만듦)');
    assert.deepEqual([h.status.mode, h.status.liveKeys], ['test', true], '운영 결제 방식 = 시험 상점(NICEPAY_MODE=test) · 실 상점 키 있음');
    assert.ok(!JSON.stringify(h).includes('REAL-'), '키 값은 응답에 없음');
    // 상태: 실제 회사(시험 아님)의 마지막 결제가 실패 → 확인 필요(사유) · 그 뒤 승인 → 정상
    const mo = () => `T192${Math.random().toString(36).slice(2, 10)}`;
    await sql`insert into payments (tenant, kind, moid, amount, status, result_msg, created_at) values (${tid}, 'subscription', ${mo()}, 14850, 'failed', '카드 한도 초과', now())`;
    h = await platform.ok('GET', '/api/platform/pay-test');
    assert.equal(h.status.state, 'warn');
    assert.ok(h.status.reasons.some((r) => /최근 실제 결제가 실패로 끝났고 그 뒤 승인이 없습니다 — 카드 한도 초과/.test(r)), JSON.stringify(h.status.reasons));
    assert.ok(h.status.fail7 >= 1);
    await sql`insert into payments (tenant, kind, moid, amount, status, paid_at, created_at) values (${tid}, 'subscription', ${mo()}, 14850, 'paid', now() + interval '1 second', now())`;
    h = await platform.ok('GET', '/api/platform/pay-test');
    assert.deepEqual([h.status.state, h.status.reasons], ['ok', []], '그 뒤 승인 → 정상');
    // [시험 결제] = 숨은 시험 계정(처음이면 만듦) → 시험 상점 결제창
    const w = await platform.ok('POST', '/api/platform/pay-test/tester/window', W);
    assert.deepEqual([w.mode, w.params.MID], ['test', MID]);
    const [p1] = await sql`select tenant from payments where id = ${w.paymentId}`;
    const [tt] = await sql`select is_test, name from tenants where id = ${p1.tenant}`;
    assert.deepEqual([tt.is_test, tt.name], [true, '결제 시험(고정)']);
    h = await platform.ok('GET', '/api/platform/pay-test');
    assert.equal(h.tester.id, p1.tenant);
    const r = await postForm('/api/billing/nicepay/return', { AuthResultCode: '0000', AuthResultMsg: '인증 성공', AuthToken: 'tok192', PayMethod: 'CARD', MID, Moid: w.params.Moid, Amt: w.params.Amt,
      TxTid: `${MID}01012610271200001920`, Signature: sha('tok192' + MID + w.params.Amt + KEY), NextAppURL: `${NP}/webapi/pay_process.jsp`, NetCancelURL: `${NP}/webapi/cancel_process.jsp` });
    assert.equal(r.headers.get('location'), `${BASE}/platform?tab=paytest&check=${w.paymentId}`);
    assert.equal((await sql`select plan_code from tenant_subscriptions where tenant = ${p1.tenant}`)[0].plan_code, 'w_standard');
    const tests0 = (await sql`select count(*)::int n from tenants where is_test`)[0].n;
    // 다음 시험 → 같은 계정 · 지난 시험 결제 자동 취소 · 요금제 결제 전으로
    const w2 = await platform.ok('POST', '/api/platform/pay-test/tester/window', { ...W, kind: 'annual' });
    assert.equal((await sql`select tenant from payments where id = ${w2.paymentId}`)[0].tenant, p1.tenant, '같은 시험 계정');
    assert.equal((await sql`select count(*)::int n from tenants where is_test`)[0].n, tests0, '시험 회사 늘지 않음');
    assert.equal((await sql`select status from payments where id = ${w.paymentId}`)[0].status, 'canceled', '지난 시험 결제 자동 취소');
    assert.equal((await sql`select plan_code from tenant_subscriptions where tenant = ${p1.tenant}`)[0].plan_code, 'trial', '요금제 결제 전으로');
    assert.ok((await sql`select 1 from audit_logs where action = 'billing.refund' and detail->>'reason' = '다음 시험 전 자동 취소'`).length, '취소 감사 기록');
    // 고객사 목록에 시험 계정(시험 회사 전부) 없음
    const all = await platform.ok('GET', '/api/platform/tenants');
    assert.ok((all.tenants ?? all.rows ?? []).every((x) => !x.is_test), '고객사 목록에 시험 회사 없음');
    // 마지막 시험 결제 실패 → 확인 필요
    await sql`update payments set status = 'failed', result_msg = '시험 승인 실패', updated_at = now() + interval '2 seconds' where id = ${w2.paymentId}`;
    h = await platform.ok('GET', '/api/platform/pay-test');
    assert.equal(h.status.state, 'warn');
    assert.ok(h.status.reasons.some((x) => /마지막 시험 결제가 실패했습니다 — 시험 승인 실패/.test(x)));
    assert.equal(h.status.lastTest.id, w2.paymentId);
    assert.ok(h.payments.some((x) => x.id === w2.paymentId && x.status === 'failed'), '최근 시험 결제 목록');
    // 실결제 100원 시험도 같은 계정으로(하루 3번 제한은 그대로 — 앞 시험분은 이틀 전으로)
    await sql`update payments set created_at = now() - interval '2 days' where meta->>'liveSmoke' = 'true'`;
    const lv = await platform.ok('POST', '/api/platform/pay-test/tester/live', { confirm: '실결제 100원' });
    assert.deepEqual([lv.mode, lv.params.MID, Number(lv.params.Amt)], ['live', LIVE_MID, 100]);
    assert.equal((await sql`select tenant from payments where id = ${lv.paymentId}`)[0].tenant, p1.tenant);
    // 시험 계정이 지워졌으면(숨김) 다음 [시험 결제] 때 새로 만듦
    await sql`update tenants set deleted_at = now(), status = 'deleted' where id = ${p1.tenant}`;
    const w3 = await platform.ok('POST', '/api/platform/pay-test/tester/window', W);
    const t3 = (await sql`select tenant from payments where id = ${w3.paymentId}`)[0].tenant;
    assert.notEqual(t3, p1.tenant);
    assert.equal((await platform.ok('GET', '/api/platform/pay-test')).tester.id, t3);
  });
});
