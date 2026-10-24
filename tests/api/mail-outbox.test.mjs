// V21 메일 보내기: 메일 계정 연결 시험·암호화 저장, 명함(보내는 사람 기준), 보관함 발송·재시도·인증 실패·중복 금지·큰 첨부 → 링크·열람 기록
// 모의 SMTP 서버(smtp-server)로 시험 — 실제 네이버 연결은 로컬 세션이 대표와 확인한다(가짜 서버 통과 ≠ 실제 연동 완료)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { BASE, FAKE, bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

const SMTP_PORT = 2526;
const RESEND_PORT = 3205;
import http from 'node:http';
// V29 워크인 발송: 가짜 Resend(HTTP) — to 에 busy@ 면 첫 번 429, bounce@ 면 422
const resend = { mails: [], busy: 0 };
function startResend() {
  return http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      const j = (o, st = 200) => { res.statusCode = st; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (req.headers.authorization !== 'Bearer re_test_key') return j({ message: 'API key is invalid' }, 401);
      const m = JSON.parse(b);
      if (m.to.some((t) => t.startsWith('bounce@'))) return j({ name: 'validation_error', message: 'Invalid `to` field. email address' }, 422);
      if (m.to.some((t) => t.startsWith('busy@')) && resend.busy++ === 0) return j({ message: 'Too many requests' }, 429);
      resend.mails.push({ ...m, idem: req.headers['idempotency-key'] });
      j({ id: `re_${resend.mails.length}` });
    });
  }).listen(RESEND_PORT);
}
const PASS = 'app-pass-1234';
let srv, sql, ctx, smtp, taskId, attId, fake, libId, resendSrv;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const box = { mails: [], mode: [], pass: PASS };
function startSmtp() {
  return new Promise((resolve) => {
    const s = new SMTPServer({
      authOptional: false, allowInsecureAuth: true, disabledCommands: ['STARTTLS'], logger: false,
      onAuth(auth, _session, cb) { return auth.password === box.pass ? cb(null, { user: auth.username }) : cb(Object.assign(new Error('Authentication failed'), { responseCode: 535 })); },
      onData(stream, session, cb) {
        const chunks = [];
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', async () => {
          const mode = box.mode.shift();
          if (mode === 'drop') { session.socket?.destroy?.(); return cb(Object.assign(new Error('Try again later'), { responseCode: 451 })); }
          if (mode === '451') return cb(Object.assign(new Error('Temporary failure'), { responseCode: 451 }));
          box.mails.push(await simpleParser(Buffer.concat(chunks)));
          cb();
        });
      },
    });
    s.listen(SMTP_PORT, '127.0.0.1', () => resolve(s));
  });
}
const waitStatus = async (id, want, ms = 15000) => {
  for (let t = Date.now(); Date.now() - t < ms;) {
    const [o] = await sql`select status, attempts, error_kind, last_error from outbox where id = ${id}`;
    if (want.includes(o?.status)) return o;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`outbox ${id} 상태가 ${want} 가 되지 않음`);
};
const account = (extra = {}) => ({ provider: 'custom', host: '127.0.0.1', port: SMTP_PORT, secure: false, username: 'dagym-in', fromEmail: 'office@mail.test', fromName: '시험회사', password: PASS, ...extra });

before(async () => {
  await resetDb(); smtp = await startSmtp(); fake = await startFakeGoogle(); srv = await startServer({ RESEND_API_KEY: 're_test_key', MAIL_FROM_DOMAIN: 'mail.work-in.test', RESEND_API_BASE: `http://localhost:${RESEND_PORT}` }); resendSrv = startResend(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/org/company-profiles', { key: 'dagym', name: '시험상호 다짐', phone: '02-000-0000', isDefault: true });
  await ctx.owner.ok('PUT', '/api/org/company-profiles', { key: 'hilink', name: 'HI-LINK 시험', phone: '1555-0000', address: '시험시 시험로 36, 8층 801호', website: 'www.hilink.test' });
  taskId = (await ctx.owner.ok('POST', '/api/tasks', { title: '[하이링크 문의] 시험아파트', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
  await sql`insert into inquiries (tenant, lead_id, site, inquiry_type, organization, task_id, payload)
    values ('default', 'lead-mail-1', 'hilink', '위탁운영', '시험아파트', ${taskId}, ${sql.json({ name: '고객', email: 'customer@client.test', phone: '010-0000-0000' })})`;
  await sql`insert into task_checklist_items (task_id, text, sort) values (${taskId}, '자료/제안서 발송', 0), (${taskId}, '견적', 1)`;
  const init = await ctx.owner.ok('POST', '/api/attachments', { taskId, kind: 'file', fileName: '견적서.pdf', mimeType: 'application/pdf', size: 12 });
  await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: Buffer.from('%PDF-1.4 abc') });
  await ctx.owner.ok('POST', `/api/attachments/${init.id}/complete`, {});
  attId = init.id;
  const lf = await ctx.owner.ok('POST', '/api/library', { fileName: '하이링크 회사소개서.pdf', mimeType: 'application/pdf', size: 12, folder: '영업자료' });
  await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: Buffer.from('%PDF-1.4 abc') });
  await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`);
  libId = lf.id;
  await new Promise((r) => setTimeout(r, 1500)); // 자료 정리(AI)가 끝나기를 기다림
});
after(async () => { srv?.proc.kill(); smtp?.close(); resendSrv?.close(); fake?.server.close(); await sql?.end(); });

describe('V21 메일 계정·명함', () => {
  test('메일 계정: 권한 없는 사람 404, 연결 시험 실패면 저장 안 함, 성공하면 암호화 저장·비밀번호 안 돌려줌', async () => {
    assert.equal((await ctx.staffA.client.get('/api/org/mail-account')).status, 404);
    assert.equal((await ctx.owner.ok('GET', '/api/org/mail-account')).account, null);
    const bad = await ctx.owner.req('PUT', '/api/org/mail-account', account({ password: 'wrong' }));
    assert.equal(bad.status, 400); assert.match(bad.body.error.message, /로그인 실패/);
    assert.equal((await sql`select count(*)::int n from mail_accounts`)[0].n, 0);
    const ok = await ctx.owner.ok('PUT', '/api/org/mail-account', account());
    assert.equal(ok.testSentTo, 'office@mail.test');
    assert.equal(box.mails.length, 1); assert.match(box.mails[0].subject, /연결 시험/);
    const [row] = await sql`select password_enc from mail_accounts`;
    assert.ok(!row.password_enc.includes(PASS));
    const g = await ctx.owner.ok('GET', '/api/org/mail-account');
    assert.ok(g.account.lastOkAt); assert.ok(!JSON.stringify(g).includes(PASS));
    // 비밀번호를 비우면 저장된 값으로 다시 시험
    await ctx.owner.ok('PUT', '/api/org/mail-account', account({ password: undefined }));
  });

  test('명함: 보내는 사람 이름·직급·휴대폰 + 회사 주소·웹사이트, 문의 사이트 회사 자동 선택, 받는 사람 = 문의 이메일', async () => {
    await ctx.owner.ok('PUT', '/api/org/mail-signature', { key: 'hilink', sigIntro: '시험 소개 한 줄', sigDisclaimer: '비밀유지 안내', sigDisclaimerEn: 'Confidential' });
    const c = await ctx.owner.ok('GET', `/api/tasks/${taskId}/mail`);
    assert.equal(c.company, 'hilink'); assert.deepEqual(c.to, ['customer@client.test']); assert.equal(c.canSend, true);
    const sig = c.companies.find((x) => x.key === 'hilink').html;
    for (const s of ['김대표', 'HI-LINK 시험', '시험시 시험로 36, 8층', 'www.hilink.test', '시험 소개 한 줄', 'Confidential', 'office@mail.test']) assert.ok(sig.includes(s), s);
    assert.ok(!sig.includes('801호'), '대표 지적(10/19): 명함 주소는 층까지만');
    assert.ok(!sig.includes('ceo@dagym.test'), '로그인 이메일(개인 메일일 수 있음)은 명함에 안 나감');
    assert.ok(!/APART/i.test(sig));
    // 직원은 볼 수는 있어도 보내기 권한 없음(서버 403)
    const s = await ctx.staffA.client.ok('GET', `/api/tasks/${taskId}/mail`);
    assert.equal(s.canSend, false);
    assert.equal((await ctx.staffA.client.post('/api/mail/send', { taskId, company: 'hilink', to: ['x@client.test'], subject: 's', body: 'b' })).status, 403);
    // 다른 현장 직원은 업무 자체가 404
    assert.equal((await ctx.staffB.client.get(`/api/tasks/${taskId}/mail`)).status, 404);
  });
});

describe('V21 보관함 발송', () => {
  test('보내기 → 보관함 → 발송(첨부·고정 Message-ID·명함 HTML), 직급·휴대폰 학습, 기록·CRM 단계 체크', async () => {
    box.mails = [];
    const mail = { taskId, company: 'hilink', to: ['customer@client.test'], cc: ['boss@client.test'], subject: '견적서 송부의 건',
      body: '안녕하세요.\n\n견적서를 보내 드립니다.', attachmentIds: [attId], senderTitle: '대표', senderPhone: '010-1111-2222', senderWorkEmail: 'ceo@company.test' };
    // V38 4: 견적서는 고객에게 보내는 문서 → 기밀 이름 규칙에 없음 = 경고 없이 바로 보냄(급여명세 같은 기밀 단어는 attach-library 시험에서 경고 → 확인)
    const r = await ctx.owner.ok('POST', '/api/mail/send', mail);
    assert.equal(r.status, 'queued');
    await waitStatus(r.id, ['sent']);
    assert.equal(box.mails.length, 1);
    const m = box.mails[0];
    assert.equal(m.subject, '견적서 송부의 건'); assert.equal(m.attachments.length, 1); assert.equal(m.attachments[0].filename, '견적서.pdf');
    assert.ok(m.html.includes('HI-LINK 시험') && m.html.includes('010-1111-2222') && m.html.includes('대표') && m.html.includes('ceo@company.test'));
    const [o] = await sql`select message_id from outbox where id = ${r.id}`;
    assert.equal(m.messageId, o.message_id);
    const [u] = await sql`select title, phone from users where id = ${ctx.ownerId}`;
    assert.deepEqual([u.title, u.phone], ['대표', '010-1111-2222']);
    // '보냄' 상태가 업무 기록·체크 표시보다 먼저 저장됨 → 기록까지 기다림(10/24 한 번 먼저 읽어 실패)
    let acts = [], steps = [];
    for (let i = 0; i < 20; i++) {
      acts = (await sql`select action from activities where entity_id = ${taskId} order by id`).map((a) => a.action);
      steps = await sql`select text, done from task_checklist_items where task_id = ${taskId} order by sort`;
      if (acts.includes('mail_sent') && steps.length && steps.every((s) => s.done)) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.ok(acts.includes('mail_queued') && acts.includes('mail_sent'));
    assert.deepEqual(steps.map((s) => s.done), [true, true], '자료 첨부 → 자료/제안서 발송, 견적서 → 견적');
  });

  test('로컬 검수 10/17 보안: 자료실에서 고른 파일은 업무 첨부로 안 남고 이번 메일·링크에만 담김, 볼 수 없는 자료는 404', async () => {
    box.mails = [];
    const before = (await sql`select count(*)::int n from attachments where task_id = ${taskId} and deleted_at is null`)[0].n;
    const r = await ctx.owner.ok('POST', '/api/mail/send', { taskId, company: 'hilink', to: ['customer@client.test'], subject: '회사소개서', body: '보내 드립니다', libraryFileIds: [libId] });
    await waitStatus(r.id, ['sent']);
    assert.equal(box.mails.at(-1).attachments[0].filename, '하이링크 회사소개서.pdf');
    const share = await ctx.owner.ok('POST', '/api/mail/share', { taskId, libraryFileIds: [libId] });
    assert.ok((await fetch(`${BASE}/api/public/share/${share.url.split('/d/')[1]}/0`, { redirect: 'manual' })).status < 400, '링크로 받기');
    await sql`delete from share_link_views where link_id in (select id from share_links where files->0->>'libraryFileId' = ${libId})`; // 아래 시험의 열람 횟수와 섞이지 않게
    assert.equal((await sql`select count(*)::int n from attachments where task_id = ${taskId} and deleted_at is null`)[0].n, before, '업무 첨부 그대로');
    assert.equal((await ctx.owner.req('POST', '/api/mail/share', { taskId, libraryFileIds: ['00000000-0000-4000-8000-000000000000'] })).status, 404);
    assert.equal((await ctx.owner.req('POST', '/api/mail/share', { taskId })).status, 400, '파일 없이 링크 안 만듦');
  });

  test('연결 끊김(일시 오류) → 재시도 대기 → 정기 실행에서 다시 보내 1통만', async () => {
    box.mails = []; box.mode = ['drop'];
    const r = await ctx.owner.ok('POST', '/api/mail/send', { taskId, company: 'hilink', to: ['customer@client.test'], subject: '재시도 시험', body: '본문' });
    const o = await waitStatus(r.id, ['retry']);
    assert.equal(o.error_kind, 'transient'); assert.equal(o.attempts, 1);
    await sql`update outbox set next_attempt_at = now() where id = ${r.id}`;
    await tick();
    await waitStatus(r.id, ['sent']);
    assert.equal(box.mails.filter((m) => m.subject === '재시도 시험').length, 1);
  });

  test('같은 행을 여러 번 동시에 처리해도 1통만', async () => {
    box.mails = [];
    await sql`update outbox set status = 'canceled' where status in ('queued', 'retry')`;
    const r = await ctx.owner.ok('POST', '/api/mail/send', { taskId, company: 'hilink', to: ['customer@client.test'], subject: '중복 시험', body: '본문' });
    const run = () => fetch(`${BASE}/api/mail/run`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } });
    await Promise.all([run(), run(), run(), tick()]);
    await waitStatus(r.id, ['sent']);
    await Promise.all([run(), tick()]);
    assert.equal(box.mails.filter((m) => m.subject === '중복 시험').length, 1);
    assert.equal((await fetch(`${BASE}/api/mail/run`, { method: 'POST' })).status, 401);
  });

  test('대표 요청 10/19 예약 보내기: 그 시각 전에는 안 보냄 → 시각 바꾸기·취소 → 시각이 되면 첨부와 함께 1통 + 보낸 사람 알림, 일시 오류는 1번만 다시', async () => {
    box.mails = [];
    await sql`update outbox set status = 'canceled' where status in ('queued', 'retry')`;
    const later = (min) => new Date(Date.now() + min * 60000).toISOString();
    assert.equal((await ctx.owner.req('POST', '/api/mail/send', { taskId, company: 'hilink', to: ['customer@client.test'], subject: '과거 예약', body: '본문', sendAt: new Date(Date.now() - 60000).toISOString() })).status, 400);
    const r = await ctx.owner.ok('POST', '/api/mail/send', { taskId, company: 'hilink', to: ['customer@client.test'], subject: '예약 시험', body: '본문', attachmentIds: [attId], sendAt: later(10) });
    assert.ok(r.scheduledAt);
    await tick(); await new Promise((x) => setTimeout(x, 800));
    assert.equal((await sql`select status from outbox where id = ${r.id}`)[0].status, 'queued', '예약 시각 전에는 안 보냄');
    assert.equal(box.mails.filter((m) => m.subject === '예약 시험').length, 0);
    const h = await ctx.owner.ok('GET', `/api/tasks/${taskId}/mail?history=1`);
    assert.ok(h.items.find((i) => i.id === r.id).scheduled_at);
    assert.notEqual((await ctx.staffA.client.post(`/api/mail/outbox/${r.id}/schedule`, { cancel: true })).status, 200, '남의 예약은 못 바꿈');
    assert.equal((await ctx.owner.req('POST', `/api/mail/outbox/${r.id}/schedule`, { sendAt: new Date(Date.now() - 1000).toISOString() })).status, 400);
    const re = await ctx.owner.ok('POST', `/api/mail/outbox/${r.id}/schedule`, { sendAt: later(30) });
    assert.ok(Date.parse(re.scheduledAt) > Date.now() + 20 * 60000);
    // 시각이 됨(정기 실행)
    await sql`update outbox set next_attempt_at = now() where id = ${r.id}`;
    await tick();
    await waitStatus(r.id, ['sent']);
    const got = box.mails.filter((m) => m.subject === '예약 시험');
    assert.equal(got.length, 1); assert.equal(got[0].attachments.length, 1, '첨부 포함');
    assert.equal((await sql`select count(*)::int n from notifications where user_id = ${ctx.ownerId} and title like '예약 메일을 보냈습니다%'`)[0].n, 1);
    assert.ok((await sql`select 1 from activities where entity_id = ${taskId} and action = 'mail_scheduled'`).length, '업무 기록에 예약');
    // 취소 → 정기 실행이 와도 안 보냄, 다시 취소는 409
    const c = await ctx.owner.ok('POST', '/api/mail/send', { taskId, company: 'hilink', to: ['customer@client.test'], subject: '취소될 예약', body: '본문', sendAt: later(5) });
    await ctx.owner.ok('POST', `/api/mail/outbox/${c.id}/schedule`, { cancel: true });
    await sql`update outbox set next_attempt_at = now() where id = ${c.id}`; await tick();
    assert.equal((await sql`select status from outbox where id = ${c.id}`)[0].status, 'canceled');
    assert.equal((await ctx.owner.req('POST', `/api/mail/outbox/${c.id}/schedule`, { cancel: true })).status, 409);
    // 일시 오류 2번 → 1번 다시 보내고 실패 + '예약 메일 발송 실패' 알림
    box.mode = ['drop', 'drop'];
    const f = await ctx.owner.ok('POST', '/api/mail/send', { taskId, company: 'hilink', to: ['customer@client.test'], subject: '예약 실패 시험', body: '본문', sendAt: later(5) });
    await sql`update outbox set next_attempt_at = now() where id = ${f.id}`; await tick();
    await waitStatus(f.id, ['retry']);
    await sql`update outbox set next_attempt_at = now() where id = ${f.id}`; await tick();
    const fo = await waitStatus(f.id, ['failed']);
    assert.equal(fo.attempts, 2);
    assert.equal((await sql`select count(*)::int n from notifications where user_id = ${ctx.ownerId} and title like '예약 메일 발송 실패%'`)[0].n, 1);
    box.mode = [];
  });

  test('인증 실패(535) → 재시도 없이 즉시 실패 + 알림 + 다시 보내기', async () => {
    box.pass = 'changed';
    const r = await ctx.owner.ok('POST', '/api/mail/send', { taskId, company: 'hilink', to: ['customer@client.test'], subject: '인증 실패 시험', body: '본문' });
    const o = await waitStatus(r.id, ['failed']);
    assert.equal(o.error_kind, 'auth'); assert.equal(o.attempts, 1); assert.match(o.last_error, /로그인 실패/);
    assert.equal((await sql`select count(*)::int n from notifications where type = 'mail_status' and user_id = ${ctx.ownerId}`)[0].n >= 1, true);
    assert.match((await sql`select last_error from mail_accounts`)[0].last_error, /로그인 실패/);
    const h = await ctx.owner.ok('GET', `/api/tasks/${taskId}/mail?history=1`);
    assert.equal(h.items.find((i) => i.id === r.id).status, 'failed');
    box.pass = PASS; box.mails = [];
    await ctx.owner.ok('POST', `/api/mail/outbox/${r.id}/retry`, {});
    await waitStatus(r.id, ['sent']);
    assert.equal(box.mails.length, 1);
    assert.equal((await ctx.staffA.client.post(`/api/mail/outbox/${r.id}/retry`, {})).status, 403);
  });

  test('첨부 합계 10MB 초과 → 다운로드 링크(14일)로 바꿔 보내고, 열면 업무에 "고객이 자료를 열어봄"', async () => {
    box.mails = [];
    await sql`update attachments set size_bytes = 12 * 1024 * 1024 where id = ${attId}`;
    const r = await ctx.owner.ok('POST', '/api/mail/send', { taskId, company: 'hilink', to: ['customer@client.test'], subject: '큰 자료', body: '본문', attachmentIds: [attId] });
    assert.equal(r.asLink, true);
    await waitStatus(r.id, ['sent']);
    const m = box.mails[0];
    assert.equal(m.attachments.length, 0);
    const link = m.text.match(/(http\S+\/d\/[A-Za-z0-9_-]+)/)[1];
    const page = await fetch(link);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes('견적서.pdf'));
    const acts = (await sql`select action from activities where entity_id = ${taskId}`).map((a) => a.action);
    assert.ok(acts.includes('share_opened'));
    const token = link.split('/d/')[1];
    const dl = await fetch(`${BASE}/api/public/share/${token}/0`, { redirect: 'manual' });
    assert.equal(dl.status, 302);
    assert.equal((await sql`select count(*)::int n from share_link_views where file_index = 0`)[0].n, 1);
    assert.equal((await fetch(`${BASE}/api/public/share/wrongtoken/0`, { redirect: 'manual' })).status, 404);
    const h = await ctx.owner.ok('GET', `/api/tasks/${taskId}/mail?history=1`);
    assert.ok(h.items.find((i) => i.id === r.id).first_opened_at);
    // V35 1: 목록에 첨부 수·"열람" 상태, "첨부 있음" 필터
    const lst = await ctx.owner.ok('GET', '/api/tasks?hasAttach=1&limit=1000');
    const row = lst.tasks.find((t) => t.id === taskId);
    assert.ok(row && row.attachment_count >= 1, '첨부 있음 필터에 나옴');
    assert.equal(row.share_state, 'opened');
    assert.ok(lst.tasks.every((t) => t.attachment_count > 0), '첨부 없는 업무는 빠짐');
    const plain = await ctx.owner.ok('POST', '/api/tasks', { title: '첨부 없는 업무', assigneeId: ctx.ownerId, orgUnitId: ctx.siteA, approvalRequired: false });
    const all = await ctx.owner.ok('GET', '/api/tasks?limit=1000');
    assert.equal(all.tasks.find((t) => t.id === plain.id).share_state, null);
    assert.ok(!(await ctx.owner.ok('GET', '/api/tasks?hasAttach=1&limit=1000')).tasks.some((t) => t.id === plain.id));
  });
});

describe('V29 쉬운 메일(워크인 발송) + B1 직원별 보내는 이름·회신 주소·숨은 참조', () => {
  test('회사 메일 계정: 보내는 이름 기본 "이름 직급 (회사)"·회신 = 직원 업무 이메일, 시안에서 바꾼 값·숨은 참조 그대로', async () => {
    const ctxm = await ctx.owner.ok('GET', `/api/tasks/${taskId}/mail`);
    assert.equal(ctxm.channel, 'email:smtp', '계정이 있으면 자동 = 회사 계정');
    assert.equal(ctxm.defaults.fromName, `${(await sql`select name from users where id = ${ctx.ownerId}`)[0].name} 대표 (HI-LINK 시험)`);
    assert.equal(ctxm.defaults.replyTo, 'ceo@company.test');
    box.mails = [];
    const r = await ctx.owner.ok('POST', '/api/mail/send', { taskId, company: 'hilink', to: ['customer@client.test'], bcc: ['archive@company.test'], subject: '회신 주소 시험', body: '본문' });
    await waitStatus(r.id, ['sent']);
    const m = box.mails.at(-1);
    assert.equal(m.replyTo.value[0].address, 'ceo@company.test'); assert.equal(m.from.value[0].address, 'office@mail.test');
    assert.match(m.from.value[0].name, /대표 \(HI-LINK 시험\)/);
    const r2 = await ctx.owner.ok('POST', '/api/mail/send', { taskId, company: 'hilink', to: ['customer@client.test'], subject: '바꾼 값', body: '본문', fromName: '영업팀 김대표', replyTo: 'sales@company.test' });
    await waitStatus(r2.id, ['sent']);
    assert.equal(box.mails.at(-1).from.value[0].name, '영업팀 김대표'); assert.equal(box.mails.at(-1).replyTo.value[0].address, 'sales@company.test');
  });

  test('워크인 발송: 설정 없이 noreply@발송 도메인 · 회신 = 직원 업무 이메일 · 첨부 · 기록 · 일시 오류 재시도 · 주소 오류 즉시 실패', async () => {
    const st = await ctx.owner.ok('GET', '/api/org/mail-account');
    assert.equal(st.workin.enabled, true); assert.equal(st.mode, 'auto');
    assert.equal((await ctx.staffA.client.req('PUT', '/api/org/mail-mode', { mode: 'workin' })).status >= 400, true, '직원은 못 바꿈');
    assert.equal((await ctx.owner.ok('PUT', '/api/org/mail-mode', { mode: 'workin' })).channel, 'email:workin');
    resend.mails = [];
    const up = await ctx.owner.ok('POST', '/api/attachments', { taskId, kind: 'file', fileName: '견적서.pdf', mimeType: 'application/pdf', size: 12 });
    await fetch(BASE + up.upload.url, { method: 'PUT', headers: up.upload.headers, body: Buffer.from('%PDF-1.4 abc') });
    await ctx.owner.ok('POST', `/api/attachments/${up.id}/complete`, {});
    const r = await ctx.owner.ok('POST', '/api/mail/send', { taskId, company: 'hilink', to: ['customer@client.test'], cc: ['boss@client.test'], bcc: ['archive@company.test'], subject: '워크인 발송 시험', body: '안녕하세요', attachmentIds: [up.id] });
    assert.equal(r.channel, 'email:workin');
    await waitStatus(r.id, ['sent']);
    const m = resend.mails.at(-1);
    assert.match(m.from, /^"[^"]+ 대표 \(HI-LINK 시험\)" <noreply@mail\.work-in\.test>$/);
    assert.equal(m.reply_to, 'ceo@company.test'); assert.deepEqual(m.bcc, ['archive@company.test']); assert.deepEqual(m.cc, ['boss@client.test']);
    assert.equal(m.attachments[0].filename, '견적서.pdf'); assert.equal(Buffer.from(m.attachments[0].content, 'base64').toString(), '%PDF-1.4 abc');
    const [o] = await sql`select channel, message_id, from_email from outbox where id = ${r.id}`;
    assert.equal(o.channel, 'email:workin'); assert.equal(m.headers['Message-ID'], o.message_id); assert.equal(m.idem, o.message_id, '같은 메일 두 번 안 감');
    assert.equal(o.from_email, 'noreply@mail.work-in.test');
    // 일시 오류(429) → 재시도 대기 → 다시 보내 1통
    const busy = await ctx.owner.ok('POST', '/api/mail/send', { taskId, company: 'hilink', to: ['busy@client.test'], subject: '바쁨', body: 'x' });
    const w = await waitStatus(busy.id, ['retry', 'sent']);
    if (w.status === 'retry') { await sql`update outbox set next_attempt_at = now() where id = ${busy.id}`; await tick(); await waitStatus(busy.id, ['sent']); }
    assert.equal(resend.mails.filter((x) => x.subject === '바쁨').length, 1);
    const bad = await ctx.owner.ok('POST', '/api/mail/send', { taskId, company: 'hilink', to: ['bounce@client.test'], subject: '주소 오류', body: 'x' });
    const b = await waitStatus(bad.id, ['failed']);
    assert.equal(b.error_kind, 'address'); assert.equal(b.attempts, 1);
    await ctx.owner.ok('PUT', '/api/org/mail-mode', { mode: 'auto' });
  });
});

describe('V21 2차: AI 초안·자료 추천 / 문자 넘기기 / 전화 문의', () => {
  test('AI 초안: 제목·본문 + 자료실 추천(후보 번호만 받아들임), 사용량 기록, 연락처는 AI 에 안 보냄', async () => {
    await ctl({ anthropicReset: true, anthropicQueue: [{ content: [{ type: 'text', text: JSON.stringify({ subject: '시험아파트 제안서 송부', body: '안녕하세요.\n\n제안서를 보내 드립니다.', recommend: [1, 99] }) }], stop_reason: 'end_turn' }] });
    const r = await ctx.owner.ok('POST', '/api/mail/draft', { taskId, kind: 'proposal', company: 'hilink' });
    assert.equal(r.subject, '시험아파트 제안서 송부');
    assert.deepEqual(r.recommend.map((x) => x.id), [libId], '없는 번호(99)는 버림');
    assert.equal((await sql`select count(*)::int n from ai_usage where purpose = 'mail_draft'`)[0].n, 1);
    const st = await (await fetch(`${FAKE}/__state`)).json();
    const sent = JSON.stringify(st.anthropic.at(-1));
    assert.ok(!sent.includes('customer@client.test') && !sent.includes('010-0000-0000'), '연락처는 AI 에 안 보냄');
    assert.equal((await ctx.staffB.client.post('/api/mail/draft', { taskId, kind: 'proposal' })).status, 404);
  });

  test('문자: [보냈어요]만 기록(보관함 sms·업무 기록), 권한 없는 사람 403, 번호 형식 확인', async () => {
    const share = await ctx.owner.ok('POST', '/api/mail/share', { taskId, attachmentIds: [attId] });
    assert.match(share.url, /\/d\//);
    const r = await ctx.owner.ok('POST', '/api/mail/sms-log', { taskId, to: ['010-0000-0000'], body: '자료 보내 드립니다', shareUrl: share.url });
    const [o] = await sql`select channel, status, share_id from outbox where id = ${r.id}`;
    assert.deepEqual([o.channel, o.status, !!o.share_id], ['sms:handoff', 'sent', true]);
    assert.ok((await sql`select 1 from activities where entity_id = ${taskId} and action = 'sms_sent'`).length);
    assert.equal((await ctx.staffA.client.post('/api/mail/sms-log', { taskId, to: ['010-0000-0000'], body: 'x' })).status, 403);
    assert.equal((await ctx.owner.req('POST', '/api/mail/sms-log', { taskId, to: ['abc'], body: 'x' })).status, 400);
  });

  test('V28-2A 카카오톡: [보냈어요]만 기록(보관함 kakao·받는 사람 이름 선택·업무 기록), 권한 없는 사람 403, 다른 조직 404', async () => {
    const r = await ctx.owner.ok('POST', '/api/mail/kakao-log', { taskId, body: '견적서 보내 드렸습니다', to: '관리소장님' });
    const [o] = await sql`select channel, status, to_addrs, subject from outbox where id = ${r.id}`;
    assert.deepEqual([o.channel, o.status, o.to_addrs, o.subject], ['kakao:handoff', 'sent', ['관리소장님'], '카카오톡']);
    const r2 = await ctx.owner.ok('POST', '/api/mail/kakao-log', { taskId, body: '두 번째' });
    assert.deepEqual((await sql`select to_addrs from outbox where id = ${r2.id}`)[0].to_addrs, ['카카오톡'], '이름 없으면 카카오톡');
    assert.ok((await sql`select 1 from activities where entity_id = ${taskId} and action = 'kakao_sent'`).length);
    const h = await ctx.owner.ok('GET', `/api/tasks/${taskId}/mail?history=1`);
    assert.ok(h.items.some((i) => i.channel === 'kakao:handoff' && i.preview === '견적서 보내 드렸습니다'), '업무 보관함에 보임');
    assert.equal((await ctx.staffA.client.post('/api/mail/kakao-log', { taskId, body: 'x' })).status, 403);
    assert.equal((await ctx.owner.req('POST', '/api/mail/kakao-log', { taskId, body: '' })).status, 400);
    assert.equal((await ctx.staffB.client.post('/api/mail/kakao-log', { taskId, body: 'x' })).status, 404);
  });

  test('전화 문의 등록 → 문의 업무(유형 단계·연락처), 메일 시안 받는 사람·회사 자동, 체험 계정 404', async () => {
    const r = await ctx.staffA.client.ok('POST', '/api/inquiries/phone', { site: 'hilink', inquiryType: '위탁운영', organization: '전화아파트', name: '관리소장', phone: '010-2222-3333',
      email: 'phone@client.test', region: '화성', message: '위탁 운영 문의 전화' });
    const [t] = await sql`select title, description from tasks where id = ${r.taskId}`;
    assert.match(t.title, /^\[하이링크 전화 문의\] 전화아파트/);
    assert.match(t.description, /대표번호 전화/);
    const steps = (await sql`select text from task_checklist_items where task_id = ${r.taskId} order by sort`).map((x) => x.text);
    assert.ok(steps.includes('현장 실사') && steps.includes('자료/제안서 발송'));
    const c = await ctx.owner.ok('GET', `/api/tasks/${r.taskId}/mail`);
    assert.deepEqual(c.to, ['phone@client.test']); assert.equal(c.company, 'hilink'); assert.equal(c.contact.phone, '010-2222-3333');
    assert.equal((await ctx.staffA.client.post('/api/inquiries/phone', { site: 'dagym', inquiryType: '기타', message: '내용만' })).status, 400);
  });
});

describe('V28-1 이 업무의 AI 비서', () => {
  test('메일 초안: 업무 문맥(체크리스트·댓글·첨부 글자, 연락처 제외) → 제목·본문·고른 첨부, 대화는 업무×사람 단위로 남음, 남의 업무 404', async () => {
    await ctx.owner.ok('POST', `/api/tasks/${taskId}/comments`, { body: '관리소장님이 견적서 먼저 달라고 하심' });
    await ctl({ anthropicReset: true, anthropicQueue: [{ content: [{ type: 'text', text: JSON.stringify({ reply: '견적서를 첨부한 회신 초안입니다.', subject: '견적서 송부드립니다', body: '안녕하세요.\n\n요청하신 견적서를 보내 드립니다.', attach: [1, 7] }) }], stop_reason: 'end_turn' }] });
    const r = await ctx.owner.ok('POST', `/api/tasks/${taskId}/assist`, { action: 'mail', text: '견적서 첨부해서 회신 써줘' });
    assert.equal(r.draft.channel, 'email'); assert.equal(r.draft.subject, '견적서 송부드립니다');
    assert.deepEqual(r.draft.attachmentIds, [attId], '없는 번호(7)는 버림');
    const st = await (await fetch(`${FAKE}/__state`)).json();
    const sent = JSON.stringify(st.anthropic.at(-1).body);
    assert.ok(sent.includes('관리소장님이 견적서 먼저') && sent.includes('견적서.pdf'), '댓글·첨부 이름');
    assert.ok(!sent.includes('customer@client.test') && !sent.includes('010-0000-0000'), '연락처는 AI 에 안 보냄');
    assert.equal((await sql`select count(*)::int n from ai_usage where purpose = 'task_assist'`)[0].n, 1);
    const h = await ctx.owner.ok('GET', `/api/tasks/${taskId}/assist`);
    assert.deepEqual(h.messages.map((m) => m.role), ['user', 'assistant']);
    assert.equal((await ctx.staffA.client.ok('GET', `/api/tasks/${taskId}/assist`)).messages.length, 0, '대화는 사람마다 따로');
    assert.equal((await ctx.staffB.client.get(`/api/tasks/${taskId}/assist`)).status, 404);
    assert.equal((await ctx.owner.req('POST', `/api/tasks/${taskId}/assist`, { action: 'ask' })).status, 400);
    await ctx.owner.ok('DELETE', `/api/tasks/${taskId}/assist`);
    assert.equal((await ctx.owner.ok('GET', `/api/tasks/${taskId}/assist`)).messages.length, 0);
  });
});

describe('V14 49 업무 첨부 내려받기', () => {
  test('업무를 볼 수 있는 사람은 내려받기(json=1 서명 주소), 내려받기 기록 10분 1번, 다른 현장 404, 기밀 자료에서 온 파일은 기밀 권한 없으면 403', async () => {
    const r = await ctx.staffA.client.ok('GET', `/api/attachments/${attId}/download?json=1`);
    assert.ok(r.url.startsWith('http') && r.name === '견적서.pdf');
    await ctx.staffA.client.ok('GET', `/api/attachments/${attId}/download?json=1`);
    await ctx.staffA.client.ok('GET', `/api/attachments/${attId}/download?inline=1&json=1`);
    assert.equal((await sql`select count(*)::int n from activities where entity_id = ${taskId} and action = 'file_downloaded' and actor_id = ${ctx.staffA.id}`)[0].n, 1, '미리보기는 기록 안 함·10분 1번');
    assert.equal((await ctx.staffB.client.get(`/api/attachments/${attId}/download?json=1`)).status, 404);
    const [a] = await sql`select storage_key from attachments where id = ${attId}`;
    await sql`update library_files set storage_key = ${a.storage_key}, security = 'confidential' where id = ${libId}`;
    assert.equal((await ctx.staffA.client.get(`/api/attachments/${attId}/download?json=1`)).status, 403);
    assert.ok((await ctx.owner.ok('GET', `/api/attachments/${attId}/download?json=1`)).url, '대표(기밀 열람)는 됨');
  });
});
