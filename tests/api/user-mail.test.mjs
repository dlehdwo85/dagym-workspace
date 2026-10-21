// V33 4 (#184) 직원이 자기 회사 메일 계정으로 보내기: 회사 정책(허용·허용 도메인) → 설정 › 내 메일 계정 연결 시험(모의 SMTP) → 본인 발송은 본인 계정(outbox.account_user_id) → 관리자 연결 현황 → 허용 끄면 회사 기본 방식
// 모의 SMTP 서버(smtp-server)로 시험 — 실제 네이버·회사 메일 서버 연결은 로컬 세션이 대표와 확인한다(가짜 서버 통과 ≠ 실제 연동 완료)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

const SMTP_PORT = 2527;
const PASS = 'app-pass-1234';
let srv, sql, ctx, smtp, taskId;
const box = { mails: [], auths: [] };
function startSmtp() {
  return new Promise((resolve) => {
    const s = new SMTPServer({
      authOptional: false, allowInsecureAuth: true, disabledCommands: ['STARTTLS'], logger: false,
      onAuth(auth, _session, cb) { box.auths.push(auth.username); return auth.password === PASS ? cb(null, { user: auth.username }) : cb(Object.assign(new Error('Authentication failed'), { responseCode: 535 })); },
      onData(stream, _session, cb) { const chunks = []; stream.on('data', (c) => chunks.push(c)); stream.on('end', async () => { box.mails.push(await simpleParser(Buffer.concat(chunks))); cb(); }); },
    });
    s.listen(SMTP_PORT, '127.0.0.1', () => resolve(s));
  });
}
const waitStatus = async (id, want, ms = 15000) => {
  for (let t = Date.now(); Date.now() - t < ms;) {
    const [o] = await sql`select status, last_error from outbox where id = ${id}`;
    if (want.includes(o?.status)) return o;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`outbox ${id} 상태가 ${want} 가 되지 않음`);
};
const account = (fromEmail, extra = {}) => ({ provider: 'custom', host: '127.0.0.1', port: SMTP_PORT, secure: false, username: fromEmail, fromEmail, fromName: '시험', password: PASS, ...extra });

before(async () => {
  await resetDb(); smtp = await startSmtp(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/org/company-profiles', { key: 'dagym', name: '시험상호 다짐', phone: '02-000-0000', isDefault: true });
  taskId = (await ctx.owner.ok('POST', '/api/tasks', { title: '[문의] 시험 고객', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
});
after(async () => { srv?.proc.kill(); smtp?.close(); await sql?.end(); });

describe('#184 직원 개인 메일 계정', () => {
  test('기본은 꺼짐: 직원 GET allowed=false · PUT 403 · 관리자가 허용 + 도메인(mail.test) 저장 → 현황에 보임', async () => {
    const g = await ctx.staffA.client.ok('GET', '/api/account/mail');
    assert.deepEqual([g.account, g.allowed, g.domains], [null, false, []]); assert.ok(g.presets.length >= 3);
    assert.equal((await ctx.staffA.client.req('PUT', '/api/account/mail', account('kim@mail.test'))).status, 403);
    assert.equal((await ctx.owner.req('PUT', '/api/org/mail-mode', { staffDomains: ['bad domain'] })).status, 400);
    await ctx.owner.ok('PUT', '/api/org/mail-mode', { staffAccounts: true, staffDomains: ['Mail.test'] });
    const adm = await ctx.owner.ok('GET', '/api/org/mail-account');
    assert.deepEqual([adm.staff.allowed, adm.staff.domains, adm.staff.connections], [true, ['mail.test'], []]);
    assert.equal((await ctx.staffA.client.ok('GET', '/api/account/mail')).allowed, true);
  });
  test('연결: 허용 도메인 아니면 400 · 비밀번호 틀리면 시험 실패 400(저장 안 함) · 맞으면 시험 메일 1통 + 저장(비밀번호는 안 돌려줌)', async () => {
    assert.equal((await ctx.staffA.client.req('PUT', '/api/account/mail', account('kim@other.test'))).status, 400, '허용 도메인 아님');
    const bad = await ctx.staffA.client.req('PUT', '/api/account/mail', account('kim@mail.test', { password: 'wrong' }));
    assert.equal(bad.status, 400); assert.equal(bad.body.error.code, 'mail_test_failed');
    assert.equal((await sql`select count(*)::int c from user_mail_accounts`)[0].c, 0, '실패하면 저장 안 함');
    const n0 = box.mails.length;
    const r = await ctx.staffA.client.ok('PUT', '/api/account/mail', account('kim@mail.test'));
    assert.equal(r.testSentTo, 'kim@mail.test'); assert.equal(r.account.fromEmail, 'kim@mail.test'); assert.equal('password' in r.account, false);
    assert.equal(box.mails.length - n0, 1); assert.match(box.mails.at(-1).subject, /내 메일 계정 연결 시험/);
    const g = await ctx.staffA.client.ok('GET', '/api/account/mail');
    assert.equal(g.account.fromEmail, 'kim@mail.test'); assert.ok(g.account.lastOkAt);
    const adm = await ctx.owner.ok('GET', '/api/org/mail-account');
    assert.deepEqual(adm.staff.connections.map((c) => [c.name, c.fromEmail]), [['이직원', 'kim@mail.test']]);
    assert.ok((await sql`select 1 from audit_logs where action = 'user_mail_account.save' and actor_id = ${ctx.staffA.id}`).length);
  });
  test('본인 발송은 본인 계정으로: 시안 보내는 주소 = 내 계정(mine) · 회신 주소 기본 = 내 계정 · 보관함 account_user_id · 모의 SMTP 에 그 계정으로 로그인해 발송', async () => {
    await ctx.owner.ok('PUT', '/api/account/mail', account('ceo@mail.test'));
    const c = await ctx.owner.ok('GET', `/api/tasks/${taskId}/mail`);
    assert.deepEqual([c.channel, c.account.fromEmail, c.account.mine, c.defaults.replyTo], ['email:smtp', 'ceo@mail.test', true, 'ceo@mail.test']);
    box.auths = []; const n0 = box.mails.length;
    const r = await ctx.owner.ok('POST', '/api/mail/send', { taskId, company: 'dagym', to: ['customer@client.test'], subject: '개인 계정 발송 시험', body: '본문' });
    const [o] = await sql`select account_user_id, from_email, reply_to from outbox where id = ${r.id}`;
    assert.deepEqual([o.account_user_id, o.from_email, o.reply_to], [ctx.ownerId, 'ceo@mail.test', 'ceo@mail.test']);
    await tick(); await waitStatus(r.id, ['sent']);
    assert.equal(box.mails.length - n0, 1);
    const m = box.mails.at(-1);
    assert.match(m.from.text, /ceo@mail\.test/); assert.ok(box.auths.includes('ceo@mail.test'), '개인 계정 아이디로 로그인');
    assert.ok((await sql`select last_ok_at from user_mail_accounts where user_id = ${ctx.ownerId}`)[0].last_ok_at);
  });
  test('허용을 끄면 회사 기본 방식으로(계정은 남아 있지만 안 씀) · 연결 끊기 · 다른 회사 설정은 404', async () => {
    await ctx.owner.ok('PUT', '/api/org/mail-mode', { staffAccounts: false });
    const c = await ctx.owner.ok('GET', `/api/tasks/${taskId}/mail`);
    assert.equal(c.account, null, '회사 계정도 워크인 발송도 없으니 보낼 방법 없음'); assert.equal(c.channel, null);
    assert.equal((await ctx.owner.req('POST', '/api/mail/send', { taskId, company: 'dagym', to: ['customer@client.test'], subject: 'x', body: 'y' })).status, 409);
    const g = await ctx.staffA.client.ok('GET', '/api/account/mail');
    assert.deepEqual([g.allowed, g.account?.fromEmail], [false, 'kim@mail.test']);
    assert.equal((await ctx.staffA.client.ok('DELETE', '/api/account/mail')).ok, true);
    assert.equal((await ctx.staffA.client.ok('GET', '/api/account/mail')).account, null);
    assert.equal((await sql`select count(*)::int c from user_mail_accounts`)[0].c, 1, '대표 계정만 남음');
  });
});
