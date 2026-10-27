// 200차 #706(대표 10/26 '간편결제 창 띄울 수 있을 것'): 간편결제 바로 열기 — NICEPAY_EASY_PAY 로 켠 것만 버튼 · 결제 대행 약관 동의가 있어야 열림 ·
// 결제창 파라미터(공식 문서 '제휴사 결제창 직접 호출': PayMethod·DirectShowOpt CARD, DirectEasyPay 코드, 네이버페이 EasyPayMethod E020=CARD) · 결제 내역에 간편결제 이름 · 플랫폼 결제 시험은 켜기 전에도
// 가짜 나이스페이 서버로 보는 구조 시험 — 실제 상점(MID)에서 각 간편결제가 열리는지는 운영에서 실결제 100원 시험으로 따로 확인
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { Client, bootstrap, resetDb, startServer, testDb, BASE } from '../helpers.mjs';

const MID = 'nictest00m', KEY = 'TESTKEYabcdefghij0123456789';
const NP_PORT = 3272, NP = `http://localhost:${NP_PORT}`;
const sha = (s) => createHash('sha256').update(s).digest('hex');
let np, srv, ctx, sql, owner;

before(async () => {
  await resetDb();
  np = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      const f = Object.fromEntries(new URLSearchParams(body)); res.setHeader('content-type', 'application/json');
      if (req.url === '/webapi/pay_process.jsp' && f.SignData === sha(f.AuthToken + f.MID + f.Amt + f.EdiDate + KEY))
        return res.end(JSON.stringify({ ResultCode: '3001', ResultMsg: '카드 결제 성공', TID: f.TID, MID: f.MID, Amt: f.Amt.padStart(12, '0'), AuthCode: '11112222', CardName: '네이버페이', CardNo: '45678912****9876', Signature: sha(f.TID + f.MID + f.Amt.padStart(12, '0') + KEY) }));
      if (req.url === '/webapi/cancel_process.jsp') return res.end(JSON.stringify({ ResultCode: '2001', ResultMsg: '취소 성공', CancelAmt: f.CancelAmt, TID: f.TID }));
      res.end(JSON.stringify({ ResultCode: 'F113', ResultMsg: '위변조' }));
    });
  }).listen(NP_PORT);
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', NICEPAY_MODE: 'test', NICEPAY_PAY_MID: 'walkin001m', NICEPAY_PAY_KEY: 'REAL-KEY-NEVER-USED-IN-TEST', NICEPAY_BILL_MID: 'walkin002m', NICEPAY_BILL_KEY: 'REAL-BILL-KEY-NEVER-USED',
    NICEPAY_TEST_PAY_MID: MID, NICEPAY_TEST_PAY_KEY: KEY, NICEPAY_API_BASE: NP, NICEPAY_EASY_PAY: 'naverpay, KakaoPay ,없는것' });
  sql = testDb(); ctx = await bootstrap();
  owner = new Client('payer');
  const r = await owner.ok('POST', '/api/auth/signup', { email: 'payer@example.com', name: '결제씨', mode: 'team', company: '결제상사', password: 'signup-pass-1234', agree: { terms: true, age14: true, privacy: true, ai: true, marketing: false } });
  await owner.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  await owner.ok('POST', '/api/auth/login', { email: 'payer@example.com', password: 'signup-pass-1234' });
});
after(async () => { srv?.proc.kill(); np?.close(); await sql?.end(); });

const postForm = (path, form) => fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://web.nicepay.co.kr' }, body: new URLSearchParams(form).toString() });

test('켠 간편결제만 · 약관 동의 없으면 안 열림 · 직접 호출 파라미터 · 동의 기록 · 결제 내역 이름', async () => {
  const b = await owner.ok('GET', '/api/billing');
  assert.deepEqual(b.easyPays, [{ key: 'naverpay', label: '네이버페이' }, { key: 'kakaopay', label: '카카오페이' }], '켠 것만(대소문자·빈칸 무시, 모르는 이름은 버림)');
  const W = { kind: 'monthly', planCode: 'w_standard' };
  const off = await owner.post('/api/billing/window', { ...W, easyPay: 'tosspay', agree: true });
  assert.equal(off.status, 400); assert.equal(off.body.error.message, '토스페이는 아직 열리지 않았습니다');
  const noAgree = await owner.post('/api/billing/window', { ...W, easyPay: 'naverpay' });
  assert.equal(noAgree.status, 400); assert.match(noAgree.body.error.message, /결제 대행 약관\(나이스페이\)에 동의해야/);
  assert.equal((await sql`select count(*)::int n from payments`)[0].n, 0, '안 열린 요청은 결제 기록도 없음');

  const w = await owner.ok('POST', '/api/billing/window', { ...W, payMethod: 'BANK', easyPay: 'naverpay', agree: true });
  const p = w.params;
  assert.deepEqual([p.PayMethod, p.DirectShowOpt, p.DirectEasyPay, p.EasyPayMethod, p.MID], ['CARD', 'CARD', 'E020', 'E020=CARD', MID], '네이버페이 = 카드 결제 고정');
  assert.equal(p.SignData, sha(p.EdiDate + MID + p.Amt + KEY), '서명은 그대로');
  const [pay] = await sql`select meta from payments where id = ${w.paymentId}`;
  assert.deepEqual([pay.meta.payMethod, pay.meta.easyPay], ['CARD', 'naverpay']);
  assert.match(pay.meta.easyPayAgree.text, /전자금융거래 기본약관·개인정보처리방침에 동의/); assert.ok(pay.meta.easyPayAgree.at && pay.meta.easyPayAgree.by);
  const k = await owner.ok('POST', '/api/billing/window', { ...W, easyPay: 'kakaopay', agree: true });
  assert.deepEqual([k.params.PayMethod, k.params.DirectShowOpt, k.params.DirectEasyPay, 'EasyPayMethod' in k.params], ['CARD', 'CARD', 'E016', false]);
  const plain = await owner.ok('POST', '/api/billing/window', { ...W, payMethod: 'BANK' });
  assert.deepEqual([plain.params.PayMethod, 'DirectEasyPay' in plain.params], ['BANK', false], '간편결제를 안 고르면 예전 그대로');

  // 승인 → 결제 내역에 '네이버페이'
  const ok = await postForm('/api/billing/nicepay/return', { AuthResultCode: '0000', AuthResultMsg: '인증 성공', AuthToken: 'tok706', PayMethod: 'CARD', MID, Moid: p.Moid, Amt: p.Amt, TxTid: `${MID}01012610271200007060`,
    Signature: sha('tok706' + MID + p.Amt + KEY), NextAppURL: `${NP}/webapi/pay_process.jsp`, NetCancelURL: `${NP}/webapi/cancel_process.jsp` });
  assert.match(ok.headers.get('location'), /paid=1/);
  const hist = (await owner.ok('GET', '/api/billing')).payments.find((x) => x.id === w.paymentId);
  assert.deepEqual([hist.status, hist.easy_pay, hist.pay_method], ['paid', 'naverpay', 'CARD']);
});

test('플랫폼 결제 시험: 켜기 전(토스페이)에도 직접 호출 결제창을 열어 상점 지원 여부를 볼 수 있음', async () => {
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  const w = await ctx.owner.ok('POST', '/api/platform/pay-test/tester/window', { kind: 'monthly', planCode: 'w_standard', payMethod: 'CARD', easyPay: 'tosspay', agree: true });
  assert.deepEqual([w.mode, w.params.MID, w.params.DirectEasyPay, w.params.DirectShowOpt], ['test', MID, 'E025', 'CARD']);
  assert.equal((await ctx.owner.post('/api/platform/pay-test/tester/window', { kind: 'monthly', planCode: 'w_standard', easyPay: 'tosspay' })).status, 400, '시험도 약관 동의 값은 보냄');
});
