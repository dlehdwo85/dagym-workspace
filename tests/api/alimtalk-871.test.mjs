// 304차 #871(대표 11/01 결정: 카카오 알림톡은 결제할 때·이용약관 동의할 때만, 관리자에게만, 정보성) —
// 관리자 본인 휴대폰·동의(명함 전화와 따로) · 가입 화면 선택 동의 → 이메일 확인 끝나면 가입 완료 알림톡 · 체험 3일 전·당일 · 템플릿 번호 없는 종류는 안 보냄 ·
// 운영자 시험 발송 · 업체 실패해도 오류 없이 기록만(메일은 원래 경로)
// (구조 시험 — 가짜 솔라피 서버. 실제 카카오톡 도착·솔라피 항목 이름 최종 확인은 운영에서 [시험 발송]으로)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { Client, bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

const SECRET = 'alim-secret-test';
const TPL = { trial_d3: 'TPL-D3', trial_d0: 'TPL-D0', pay_ok: 'TPL-PAY', signup: 'TPL-SIGNUP' }; // pay_fail 은 일부러 없음(그 종류만 안 보냄)
let srv, sql, ctx, fake; const got = []; const N = {}; let failNext = false;

before(async () => {
  fake = createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
      let body = null; try { body = JSON.parse(b); } catch { /* 무시 */ }
      got.push({ path: req.url, auth: req.headers.authorization, body });
      res.writeHead(failNext ? 400 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(failNext ? { errorCode: 'ValidationError', errorMessage: '템플릿이 검수되지 않았습니다' } : { groupId: 'G-1', messageId: `M-${got.length}`, statusCode: '2000', statusMessage: '정상 접수(이통사로 접수 예정)' }));
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', ALIMTALK_PROVIDER: 'solapi', ALIMTALK_API_KEY: 'alim-key-test', ALIMTALK_API_SECRET: SECRET, ALIMTALK_PF_ID: 'PF-TEST',
    ALIMTALK_TEMPLATES: JSON.stringify(TPL), ALIMTALK_API_BASE: `http://127.0.0.1:${fake.address().port}` });
  sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

const mine = (to) => got.filter((g) => g.body?.message?.to === to);

test('관리자 본인 휴대폰·동의: 관리자만 · 번호 형식 · 동의엔 번호 필수 · 명함 전화와 따로 · 동의 기록(consents) · 운영자 시험 발송(인증 헤더·대체 문자 끔) · 업체 실패는 오류 없이 기록', async () => {
  assert.equal((await ctx.staffA.client.req('GET', '/api/account/alimtalk')).status, 403, '직원은 못 봄');
  assert.equal((await ctx.staffA.client.req('PUT', '/api/account/alimtalk', { phone: '010-1111-2222', ok: true })).status, 403);
  const g0 = await ctx.owner.ok('GET', '/api/account/alimtalk');
  assert.deepEqual([g0.service, g0.ok, g0.phone, g0.canTest], [true, false, '', true]);
  assert.deepEqual(g0.kinds.filter((k) => !k.ready).map((k) => k.kind), ['pay_fail'], '템플릿 번호 없는 종류 표시');
  assert.equal((await ctx.owner.req('PUT', '/api/account/alimtalk', { phone: '', ok: true })).status, 400, '동의엔 번호 필수');
  assert.equal((await ctx.owner.req('PUT', '/api/account/alimtalk', { phone: '02-123-4567', ok: true })).status, 400, '휴대폰만');
  const [card0] = await sql`select phone from users where id = ${ctx.ownerId}`;
  const s = await ctx.owner.ok('PUT', '/api/account/alimtalk', { phone: '010-1234-5678', ok: true });
  assert.deepEqual([s.phone, s.ok, !!s.okAt], ['01012345678', true, true]);
  const [u] = await sql`select phone, alimtalk_phone, alimtalk_ok from users where id = ${ctx.ownerId}`;
  assert.deepEqual([u.phone, u.alimtalk_phone, u.alimtalk_ok], [card0.phone, '01012345678', true], '명함 전화는 그대로');
  assert.deepEqual((await sql`select kind, agreed from consents where user_id = ${ctx.ownerId} and kind = 'alimtalk'`).map((c) => c.agreed), [true]);
  // 운영자 시험 발송 — 솔라피 v4 단건 · HMAC-SHA256(date+salt, secret) · 템플릿 번호 · 변수 #{이름} · 대체 문자 끔
  got.length = 0;
  const t = await ctx.owner.ok('POST', '/api/platform/alimtalk', { kind: 'pay_ok' });
  assert.deepEqual([t.result, t.to], ['sent', '010-****-5678']);
  assert.equal(got.length, 1); const q = got[0];
  assert.equal(q.path, '/messages/v4/send');
  const m = /^HMAC-SHA256 apiKey=alim-key-test, date=(\S+), salt=([0-9a-f]{32}), signature=([0-9a-f]{64})$/.exec(q.auth);
  assert.ok(m, q.auth);
  assert.equal(m[3], createHmac('sha256', SECRET).update(m[1] + m[2]).digest('hex'), '서명');
  assert.deepEqual([q.body.message.to, q.body.message.type, q.body.message.kakaoOptions.pfId, q.body.message.kakaoOptions.templateId, q.body.message.kakaoOptions.disableSms], ['01012345678', 'ATA', 'PF-TEST', 'TPL-PAY', true]);
  assert.deepEqual(Object.keys(q.body.message.kakaoOptions.variables).sort(), ['#{결제일시}', '#{금액}', '#{상품}', '#{회사명}'].sort());
  assert.equal((await ctx.owner.req('POST', '/api/platform/alimtalk', { kind: 'pay_fail' })).status, 400, '템플릿 번호 없으면 시험도 막음');
  assert.equal((await ctx.staffA.client.req('POST', '/api/platform/alimtalk', { kind: 'pay_ok' })).status, 404, '운영자만');
  // 업체가 거절해도 오류 없이 결과·기록만
  failNext = true;
  const bad = await ctx.owner.ok('POST', '/api/platform/alimtalk', { kind: 'signup' });
  failNext = false;
  assert.equal(bad.result, 'failed'); assert.match(bad.error, /검수/);
  const st = await ctx.owner.ok('GET', '/api/platform/alimtalk');
  assert.deepEqual([st.on, st.sent30d, st.failed30d], [true, 1, 1]); assert.match(st.lastError, /검수/);
  const logs = await sql`select * from alimtalk_logs order by id`;
  assert.ok(logs.every((l) => !JSON.stringify(l).includes('01012345678')), '보낸 기록에 전화번호 없음');
  // 동의 끄기 = 기록 남김
  await ctx.owner.ok('PUT', '/api/account/alimtalk', { phone: '010-1234-5678', ok: false });
  assert.deepEqual((await sql`select agreed from consents where user_id = ${ctx.ownerId} and kind = 'alimtalk'`).map((c) => c.agreed), [false], '지금 동의 상태');
  assert.ok((await sql`select 1 from audit_logs where action = 'account.alimtalk' and actor_id = ${ctx.ownerId}`).length >= 2, '바꾼 이력은 감사 기록');
});

test('가입: 알림톡 선택 동의 + 휴대폰 → 이메일 확인 끝나면 가입·약관 동의 완료 알림톡 1번(본인) · 동의만 하고 번호가 틀리면 가입 막음 · 동의 안 하면 번호 저장 안 함', async () => {
  const a = new Client('alim-signup');
  const agree = { terms: true, age14: true, privacy: true, ai: false, marketing: false };
  assert.equal((await a.req('POST', '/api/auth/signup', { email: 'alim1@example.com', name: '알림씨', mode: 'team', company: '알림상사', password: 'alim-pass-1234', agree: { ...agree, alimtalk: true }, phone: '123' })).status, 400);
  got.length = 0;
  const r = await a.ok('POST', '/api/auth/signup', { email: 'alim1@example.com', name: '알림씨', mode: 'team', company: '알림상사', password: 'alim-pass-1234', agree: { ...agree, alimtalk: true }, phone: '010 9876 5432' });
  assert.equal(got.length, 0, '이메일 확인 전엔 안 보냄');
  await a.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const s = mine('01098765432');
  assert.equal(s.length, 1, JSON.stringify(got.map((g) => g.body)));
  const v = s[0].body.message.kakaoOptions;
  assert.equal(v.templateId, 'TPL-SIGNUP');
  assert.deepEqual([v.variables['#{이름}'], v.variables['#{회사명}']], ['알림씨', '알림상사']);
  assert.match(v.variables['#{체험종료일}'], /\d{4}년/);
  const [u] = await sql`select id, alimtalk_phone, alimtalk_ok from users where email = 'alim1@example.com'`;
  assert.deepEqual([u.alimtalk_phone, u.alimtalk_ok], ['01098765432', true]);
  assert.deepEqual((await sql`select agreed from consents where user_id = ${u.id} and kind = 'alimtalk'`).map((c) => c.agreed), [true]);
  // 동의 안 하면 번호를 보내도 저장·발송 안 함
  const b = new Client('alim-signup-2'); got.length = 0;
  const r2 = await b.ok('POST', '/api/auth/signup', { email: 'alim2@example.com', name: '안받음', mode: 'team', company: '안받음상사', password: 'alim-pass-1234', agree, phone: '010-5555-6666' });
  await b.ok('POST', '/api/auth/verify', { token: r2.devLink.split('/').pop() });
  const [u2] = await sql`select tenant, alimtalk_phone, alimtalk_ok from users where email = 'alim2@example.com'`;
  assert.deepEqual([u2.alimtalk_phone, u2.alimtalk_ok, got.length], [null, false, 0]);
  N.t = (await sql`select tenant from users where email = 'alim1@example.com'`)[0].tenant;
  N.t2 = u2.tenant;
});

test('체험 3일 전·당일: 동의한 관리자에게만 1번씩(같은 단계 두 번 안 보냄) · 동의 안 한 회사는 안 보냄', async () => {
  await sql`update tenant_subscriptions set trial_ends_at = now() + interval '2 days 2 hours', trial_notified = '{}'::jsonb where tenant in ${sql([N.t, N.t2])}`;
  got.length = 0;
  await tick();
  const d3 = mine('01098765432');
  assert.equal(d3.length, 1, JSON.stringify(got.map((g) => [g.body?.message?.to, g.body?.message?.kakaoOptions?.templateId])));
  assert.equal(d3[0].body.message.kakaoOptions.templateId, 'TPL-D3');
  assert.deepEqual([d3[0].body.message.kakaoOptions.variables['#{회사명}'], d3[0].body.message.kakaoOptions.variables['#{남은일수}']], ['알림상사', '2']);
  assert.equal(got.length, 1, '동의 안 한 회사(안받음상사)는 안 보냄');
  await tick();
  assert.equal(mine('01098765432').length, 1, '같은 단계 두 번 안 보냄');
  // 당일
  await sql`update tenant_subscriptions set trial_ends_at = now() + interval '2 hours' where tenant = ${N.t}`;
  await tick();
  const d0 = mine('01098765432').filter((g) => g.body.message.kakaoOptions.templateId === 'TPL-D0');
  assert.equal(d0.length, 1);
  assert.ok(d0[0].body.message.kakaoOptions.variables['#{종료일}']);
  // 기록: 종류별 성공 1건씩
  const [{ n }] = await sql`select count(*)::int n from alimtalk_logs where tenant = ${N.t} and ok`;
  assert.equal(n, 3, 'signup·trial_d3·trial_d0');
});
