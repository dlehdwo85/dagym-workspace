// V21 메일 보내기: 메일 계정 연결 시험·암호화 저장, 명함(보내는 사람 기준), 보관함 발송·재시도·인증 실패·중복 금지·큰 첨부 → 링크·열람 기록
// 모의 SMTP 서버(smtp-server)로 시험 — 실제 네이버 연결은 로컬 세션이 대표와 확인한다(가짜 서버 통과 ≠ 실제 연동 완료)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { BASE, FAKE, bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

const SMTP_PORT = 2526;
const PASS = 'app-pass-1234';
let srv, sql, ctx, smtp, taskId, attId, fake, libId;
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
  await resetDb(); smtp = await startSmtp(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/org/company-profiles', { key: 'dagym', name: '시험상호 다짐', phone: '02-000-0000', isDefault: true });
  await ctx.owner.ok('PUT', '/api/org/company-profiles', { key: 'hilink', name: 'HI-LINK 시험', phone: '1555-0000', address: '시험시 시험로 36, 8층', website: 'www.hilink.test' });
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
after(async () => { srv?.proc.kill(); smtp?.close(); fake?.server.close(); await sql?.end(); });

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
    const r = await ctx.owner.ok('POST', '/api/mail/send', { taskId, company: 'hilink', to: ['customer@client.test'], cc: ['boss@client.test'], subject: '견적서 송부의 건',
      body: '안녕하세요.\n\n견적서를 보내 드립니다.', attachmentIds: [attId], senderTitle: '대표', senderPhone: '010-1111-2222', senderWorkEmail: 'ceo@company.test' });
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
    const acts = (await sql`select action from activities where entity_id = ${taskId} order by id`).map((a) => a.action);
    assert.ok(acts.includes('mail_queued') && acts.includes('mail_sent'));
    const steps = await sql`select text, done from task_checklist_items where task_id = ${taskId} order by sort`;
    assert.deepEqual(steps.map((s) => s.done), [true, true], '자료 첨부 → 자료/제안서 발송, 견적서 → 견적');
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
