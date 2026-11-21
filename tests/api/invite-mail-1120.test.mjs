// 대표 11/20 결정(#1083): 관리자가 이메일로 직원을 초대하면 초대 메일을 자동으로 보낸다(가짜 발송 서버로 받아 확인 — 실제 받은편지함·스팸함은 운영에서 로컬이 확인).
// 메일: 회사 이름 · 초대한 사람(직책) · [초대 수락] 단추 + 주소 글자 · 휴대폰 앱 받기 주소 · 만료일 / 글자 판에도 같은 주소
// · 응답에 보낸 결과(mail) · 사용자 목록에 '메일 보냄·못 보냄·시각' · [초대 메일 다시 보내기] = 새 링크(예전 링크 무효) + 새 메일
// · 메일이 실패해도 초대는 만들어지고 링크로 가입됨 · 앱 심사용 계정은 메일을 보내지 않음 · 267 마이그레이션 전(칸 없음)에도 초대·메일은 그대로
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const RESEND_PORT = 3383;
let srv, sql, ctx, mailSrv;
const mails = [];
const to = (addr) => mails.filter((m) => m.to.includes(addr));
before(async () => {
  mailSrv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const m = JSON.parse(b); res.setHeader('content-type', 'application/json');
    if (m.to.some((x) => x.startsWith('bounce'))) { res.statusCode = 500; return res.end('{"message":"fake failure"}'); } // 실패 흉내
    mails.push(m); res.end(JSON.stringify({ id: `re_${mails.length}` }));
  }); }).listen(RESEND_PORT);
  await resetDb();
  srv = await startServer({ RESEND_API_KEY: 're_test_key', MAIL_FROM: '워크인 <no-reply@mail.work-in.test>', RESEND_API_BASE: `http://localhost:${RESEND_PORT}`, APP_URL: 'https://app.work-in.test' });
  sql = testDb(); ctx = await bootstrap();
  await sql`update tenants set name = '시험회사' where id = 'default'`;
  await sql`update users set title = '대표이사', title_short = '대표' where id = ${ctx.ownerId}`;
});
after(async () => { srv?.proc.kill(); mailSrv?.close(); await sql?.end(); });

describe('직원 초대 메일 자동 발송', () => {
  let firstToken;
  test('초대하면 메일 한 통: 회사·초대한 사람(직책)·[초대 수락] 단추와 주소 글자·앱 받기·만료일 · 응답 mail=sent · 사용자 목록에 보낸 시각', async () => {
    const r = await ctx.owner.ok('POST', '/api/admin/users', { email: 'newbie@dagym.test', name: '정신입', role: 'staff' });
    assert.equal(r.mail, 'sent'); assert.ok(r.path.startsWith('/invite/')); firstToken = r.path.split('/').pop();
    const [m] = to('newbie@dagym.test'); assert.ok(m, '메일이 감');
    assert.equal(m.subject, '[워크인] 시험회사에서 초대했습니다');
    const link = `https://app.work-in.test/invite/${firstToken}`;
    assert.match(m.html, new RegExp(`<a href="${link}"[^>]*>초대 수락</a>`), '누르면 열리는 [초대 수락] 단추');
    assert.ok(m.html.split(link).length - 1 >= 3, '단추 + 아래 주소 글자(링크·보이는 글자)');
    assert.match(m.html, /정신입님, 김대표 대표님이 시험회사 워크인에 초대했습니다/);
    assert.match(m.html, /<a href="https:\/\/www\.work-in\.dev\/app"[^>]*>www\.work-in\.dev\/app<\/a>/, '앱 받기 주소(눌림)');
    const exp = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' }).format(new Date(r.expiresAt));
    assert.ok(m.html.includes(exp) && /까지, 한 번만 쓸 수 있습니다/.test(m.html), `만료일 ${exp}`);
    assert.match(m.text, new RegExp(`초대 수락: ${link}`)); assert.match(m.text, /휴대폰 앱 받기: https:\/\/www\.work-in\.dev\/app/);
    assert.doesNotMatch(m.html + m.text, /무료|체험|요금|결제/, '요금 글자 없음');
    const u = (await ctx.owner.ok('GET', '/api/admin/users')).users.find((x) => x.email === 'newbie@dagym.test');
    assert.equal(u.status, 'invited'); assert.equal(u.invite_mail.status, 'sent'); assert.ok(u.invite_mail.at, '보낸 시각');
  });

  test('[초대 메일 다시 보내기] = 새 링크(예전 링크는 취소됨) + 새 메일 · 새 링크로 가입', async () => {
    const r = await ctx.owner.ok('POST', '/api/admin/users', { email: 'newbie@dagym.test', name: '정신입', role: 'staff' });
    assert.equal(r.mail, 'sent'); const token = r.path.split('/').pop(); assert.notEqual(token, firstToken);
    assert.equal(to('newbie@dagym.test').length, 2, '두 번째 메일');
    // 로컬 11/21 운영 시험: 같은 제목이면 지메일이 한 대화로 묶어 위의 예전 메일 단추('취소된 초대')를 누르게 됨 → 다시 보낸 메일은 제목·첫 줄로 구분
    const [m1, m2] = to('newbie@dagym.test');
    assert.equal(m2.subject, '[워크인] 시험회사에서 초대했습니다(새 링크)'); assert.doesNotMatch(m1.subject, /새 링크/);
    assert.match(m2.text, /^시험회사 워크인 초대\n\n이전에 받은 초대 메일의 링크는 쓸 수 없습니다\. 이 메일의 \[초대 수락\]을 눌러 주세요\./); assert.doesNotMatch(m1.text, /이전에 받은/);
    assert.ok(to('newbie@dagym.test')[1].html.includes(`/invite/${token}`), '새 링크가 메일에');
    const old = await new Client('x').req('GET', `/api/invitations/${firstToken}`); assert.equal(old.status, 400); assert.match(old.body.error.message, /취소된 초대/);
    await new Client('newbie').ok('POST', `/api/invitations/${token}/accept`, { password: 'newbie-pass-1' });
    assert.equal((await ctx.owner.ok('GET', '/api/admin/users')).users.find((x) => x.email === 'newbie@dagym.test').status, 'active');
  });

  test('메일이 실패해도 초대는 만들어짐: 응답 mail=failed · 목록에 못 보냄 · 링크로 가입됨 · 감사 기록', async () => {
    const r = await ctx.owner.ok('POST', '/api/admin/users', { email: 'bounce@dagym.test', name: '반송', role: 'staff' });
    assert.equal(r.mail, 'failed'); assert.equal(to('bounce@dagym.test').length, 0);
    const u = (await ctx.owner.ok('GET', '/api/admin/users')).users.find((x) => x.email === 'bounce@dagym.test');
    assert.equal(u.invite_mail.status, 'failed');
    const [inv] = await sql`select mail_status, mail_error from invitations where email = 'bounce@dagym.test' and revoked_at is null`;
    assert.equal(inv.mail_status, 'failed'); assert.match(inv.mail_error, /메일 발송 실패 \(500\)/);
    assert.equal((await sql`select count(*)::int n from audit_logs where action = 'user.invite_mail_failed'`)[0].n, 1);
    await new Client('bounce').ok('POST', `/api/invitations/${r.path.split('/').pop()}/accept`, { password: 'bounce-pass-1' });
  });

  test('앱 심사용 계정은 초대 메일을 보내지 않음(링크만)', async () => {
    const before = mails.length;
    const r = await ctx.owner.ok('POST', '/api/admin/review-account', { email: 'review@workin.test' });
    assert.ok(r.invitePath?.startsWith('/invite/')); assert.equal(mails.length, before, '메일 없음');
    const [inv] = await sql`select mail_status from invitations where email = 'review@workin.test' and revoked_at is null`; assert.equal(inv.mail_status, null);
  });

  test('[초대 취소](로컬 11/21): 링크 취소 + 사용 중지 · 감사 기록 · 다시 취소 400 · 직원 막힘 · 모양 틀린 id 404 · 같은 이메일로 다시 초대하면 가입됨', async () => {
    const r = await ctx.owner.ok('POST', '/api/admin/users', { email: 'oops@dagym.test', name: '잘못보냄', role: 'staff' });
    const token = r.path.split('/').pop();
    const u = (await ctx.owner.ok('GET', '/api/admin/users')).users.find((x) => x.email === 'oops@dagym.test');
    assert.equal((await ctx.staffA.client.post(`/api/admin/users/${u.id}/cancel-invite`, {})).status >= 403, true, '직원은 못 함');
    assert.equal((await ctx.owner.req('POST', '/api/admin/users/not-a-uuid/cancel-invite', {})).status, 404, '모양이 틀린 id 는 404(500 아님)');
    assert.equal((await ctx.owner.req('DELETE', '/api/admin/invitations/not-a-uuid')).status, 404, '예전 초대 취소 API 도 404');
    const c = await ctx.owner.ok('POST', `/api/admin/users/${u.id}/cancel-invite`, {});
    assert.equal(c.revoked, 1);
    const after = (await ctx.owner.ok('GET', '/api/admin/users')).users.find((x) => x.id === u.id);
    assert.equal(after.status, 'disabled'); assert.equal(after.has_password, false); assert.equal(after.last_login_at, null, '화면은 "초대 취소됨"으로 표시');
    const old = await new Client('o').req('GET', `/api/invitations/${token}`); assert.equal(old.status, 400); assert.match(old.body.error.message, /취소된 초대/);
    assert.equal((await sql`select count(*)::int n from audit_logs where action = 'user.invite_cancel' and target_id = ${u.id}`)[0].n, 1);
    assert.equal((await ctx.owner.req('POST', `/api/admin/users/${u.id}/cancel-invite`, {})).status, 400, '이미 취소됨');
    assert.equal((await ctx.owner.req('POST', `/api/admin/users/${ctx.staffA.id}/cancel-invite`, {})).status, 400, '가입한 사람은 초대 취소 대상 아님');
    const again = await ctx.owner.ok('POST', '/api/admin/users', { email: 'oops@dagym.test', name: '다시초대', role: 'staff' });
    assert.equal((await ctx.owner.ok('GET', '/api/admin/users')).users.find((x) => x.id === u.id).status, 'invited', '다시 초대하면 초대됨으로');
    await new Client('oops').ok('POST', `/api/invitations/${again.path.split('/').pop()}/accept`, { password: 'oops-pass-1234' });
    assert.equal((await ctx.owner.ok('GET', '/api/admin/users')).users.find((x) => x.id === u.id).status, 'active');
  });

  test('직원·다른 회사는 초대 못 함(그대로) · 267 마이그레이션 전(칸 없음)에도 초대·메일·목록이 오류 없이 동작', async () => {
    assert.equal((await ctx.staffA.client.post('/api/admin/users', { email: 'x@dagym.test', name: 'x', role: 'staff' })).status === 403 || (await ctx.staffA.client.post('/api/admin/users', { email: 'x@dagym.test', name: 'x', role: 'staff' })).status === 404, true);
    await sql`alter table invitations drop column mail_status, drop column mail_at, drop column mail_error`;
    const r = await ctx.owner.ok('POST', '/api/admin/users', { email: 'premig@dagym.test', name: '이전판', role: 'staff' });
    assert.equal(r.mail, 'sent'); assert.equal(to('premig@dagym.test').length, 1);
    const u = (await ctx.owner.ok('GET', '/api/admin/users')).users.find((x) => x.email === 'premig@dagym.test');
    assert.equal(u.invite_mail.status, null, '칸이 없으면 표시만 없음');
  });
});
