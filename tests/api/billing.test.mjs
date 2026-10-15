// 18차 나이스페이 결제 — 가짜 나이스페이 서버(공개 문서 규격: SignData·EncData·결과코드)로 시험. 실결제·실제 테스트 MID 통신은 아님
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, createDecipheriv, randomInt } from 'node:crypto';
import { Client, bootstrap, resetDb, startServer, testDb, tick, BASE } from '../helpers.mjs';

const MID = 'nictest00m', KEY = 'TESTKEYabcdefghij0123456789', BMID = 'nictest04m', BKEY = 'BILLKEY0123456789zzzz';
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
        if (f.SignData !== sha(f.AuthToken + f.MID + f.Amt + f.EdiDate + KEY)) return j({ ResultCode: 'F113', ResultMsg: '위변조' });
        const sig = sha(f.TID + f.MID + f.Amt.padStart(12, '0') + KEY);
        // 시험: 인증 토큰 앞글자로 결제 수단 흉내(vb = 가상계좌 발급, bk = 계좌이체)
        if (f.AuthToken.startsWith('vb')) return j({ ResultCode: '4100', ResultMsg: '가상계좌 발급 성공', PayMethod: 'VBANK', TID: f.TID, MID: f.MID, Amt: f.Amt.padStart(12, '0'), VbankBankName: '국민', VbankNum: '12345678901234', VbankExpDate: '20991231', Signature: sig });
        if (f.AuthToken.startsWith('bk')) return j({ ResultCode: '4000', ResultMsg: '계좌이체 성공', PayMethod: 'BANK', TID: f.TID, MID: f.MID, Amt: f.Amt.padStart(12, '0'), BankName: '신한', Signature: sig });
        return j({ ResultCode: '3001', ResultMsg: '카드 결제 성공', TID: f.TID, MID: f.MID, Amt: f.Amt.padStart(12, '0'), AuthCode: '11112222', CardName: '신한', CardNo: '45678912****9876', Signature: sig });
      }
      if (p === '/webapi/cancel_process.jsp') {
        const k = f.MID === BMID ? BKEY : KEY;
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
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', NICEPAY_MODE: 'test', NICEPAY_PAY_MID: MID, NICEPAY_PAY_KEY: KEY, NICEPAY_BILL_MID: BMID, NICEPAY_BILL_KEY: BKEY, /* V29 새 이름(MID 2개) */ NICEPAY_API_BASE: NP });
  sql = testDb();
  ctx = await bootstrap();
  platform = ctx.owner;
  owner = new Client('payer');
  const r = await owner.ok('POST', '/api/auth/signup', { email: 'payer@example.com', name: '결제씨', mode: 'team', company: '결제상사', password: 'signup-pass-1234', agree: { terms: true, privacy: true, ai: true, marketing: false } });
  await owner.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  await owner.ok('POST', '/api/auth/login', { email: 'payer@example.com', password: 'signup-pass-1234' });
  tid = (await owner.ok('GET', '/api/auth/me')).user.tenant;
});
after(async () => { srv?.proc.kill(); np?.close(); await sql?.end(); });

const postForm = (path, form) => fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://web.nicepay.co.kr' }, body: new URLSearchParams(form).toString() });
const sub = async () => (await sql`select * from tenant_subscriptions where tenant = ${tid}`)[0];

describe('18차 나이스페이 결제', () => {
  test('우리 회사·직원은 결제 칸 없음, 견적 = 1인 요금 × 최소 3인 × VAT', async () => {
    assert.equal((await ctx.owner.get('/api/billing')).status, 404, '내부 요금제 회사');
    const b = await owner.ok('GET', '/api/billing');
    assert.equal(b.enabled, true); assert.equal(b.mode, 'test');
    const team = b.quotes.find((q) => q.planCode === 'team' && q.cycle === 'monthly');
    assert.equal(team.seats, 3); assert.equal(team.amount, Math.round(3900 * 3 * 1.1));
    assert.equal(b.quotes.find((q) => q.planCode === 'team' && q.cycle === 'annual').amount, Math.round(3300 * 3 * 12 * 1.1));
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
    const r = await owner.ok('POST', '/api/billing/subscribe', { planCode: 'team' });
    assert.equal(r.amount, 12870);
    const s = await sub();
    assert.equal(s.status, 'active'); assert.equal(s.plan_code, 'team'); assert.equal(s.billing_cycle, 'monthly');
    const b = await owner.ok('GET', '/api/billing');
    assert.equal(b.payments[0].status, 'paid'); assert.equal(b.payments[0].card_no, '12345678****1234');
  });

  test('연간 결제창: 서명 파라미터 → 인증 응답(위변조면 실패) → 승인 → 연간 전환', async () => {
    const w = await owner.ok('POST', '/api/billing/window', { kind: 'annual', planCode: 'team' });
    const p = w.params;
    assert.equal(p.SignData, sha(p.EdiDate + MID + p.Amt + KEY)); assert.equal(p.MID, MID); assert.match(p.ReturnURL, /\/api\/billing\/nicepay\/return$/);
    const auth = (sig) => ({ AuthResultCode: '0000', AuthResultMsg: '인증 성공', AuthToken: 'tok123', PayMethod: 'CARD', MID, Moid: p.Moid, Amt: p.Amt, TxTid: `${MID}01012610141200001234`,
      Signature: sig, NextAppURL: `${NP}/webapi/pay_process.jsp`, NetCancelURL: `${NP}/webapi/cancel_process.jsp` });
    const bad = await postForm('/api/billing/nicepay/return', auth('tampered'));
    assert.equal(bad.status, 303); assert.match(bad.headers.get('location'), /payfail=/);
    assert.equal((await sql`select status from payments where moid = ${p.Moid}`)[0].status, 'failed');
    const w2 = await owner.ok('POST', '/api/billing/window', { kind: 'annual', planCode: 'team' });
    const ok = await postForm('/api/billing/nicepay/return', { ...auth(sha('tok123' + MID + w2.params.Amt + KEY)), Moid: w2.params.Moid, Amt: w2.params.Amt });
    assert.match(ok.headers.get('location'), /paid=1/);
    assert.equal((await sub()).billing_cycle, 'annual');
    const again = await postForm('/api/billing/nicepay/return', { ...auth(sha('tok123' + MID + w2.params.Amt + KEY)), Moid: w2.params.Moid, Amt: w2.params.Amt });
    assert.match(again.headers.get('location'), /paid=1/, '새로고침해도 한 번만');
  });

  test('결제통보: 주문번호·금액이 맞을 때만 반영, 같은 통보는 한 번만, "OK"', async () => {
    const w = await owner.ok('POST', '/api/billing/window', { kind: 'addon', addonCode: 'storage20' });
    const noti = (amt) => ({ MID, MOID: w.params.Moid, Amt: String(amt), TID: 'NOTITID000000001', ResultCode: '3001', StateCd: '0', AuthCode: '1234', PayMethod: 'CARD' });
    const wrong = await postForm('/api/billing/nicepay/notify', { ...noti(1), TID: 'NOTITID-WRONG' });
    assert.equal(await wrong.text(), 'OK');
    assert.equal((await sql`select status from payments where moid = ${w.params.Moid}`)[0].status, 'pending', '금액 다르면 무시');
    for (let k = 0; k < 2; k++) assert.equal(await (await postForm('/api/billing/nicepay/notify', noti(w.params.Amt))).text(), 'OK');
    assert.equal((await sql`select status from payments where moid = ${w.params.Moid}`)[0].status, 'paid');
    assert.equal((await sub()).addons.storage20, 1, '팩 1개만 더해짐');
  });

  test('V29 결제창 결제 수단: 가상계좌 → 입금 대기(계좌 표시) → 입금 통보 4110 에 월 구독 적용·영수증 메일 · 계좌이체는 바로 완료', async () => {
    const w = await owner.ok('POST', '/api/billing/window', { kind: 'monthly', planCode: 'team', payMethod: 'VBANK' });
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
    const s1 = await sub(); assert.equal(s1.plan_code, 'team'); assert.equal(s1.billing_cycle, 'monthly');
    const w2 = await owner.ok('POST', '/api/billing/window', { kind: 'addon', addonCode: 'storage20', payMethod: 'BANK' });
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
    await owner.ok('POST', '/api/billing/subscribe', { planCode: 'team' });
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
});
