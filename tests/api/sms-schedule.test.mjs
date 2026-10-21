// #177 문자 예약 발송(서버는 못 보내므로 '보낼 시간' 알림 → 문자앱 → [보냈어요]) + V32 7 문자 초안 규칙(빈칸 경고·의도·호칭·첨부) · 명함형 3줄 서명(대표번호 토글)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, FAKE, BASE, ensureTls, tick } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql, taskId;
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
const later = (min) => new Date(Date.now() + min * 60000).toISOString();
const P = {};
before(async () => {
  await resetDb(); await ensureTls();
  fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  taskId = (await ctx.owner.ok('POST', '/api/tasks', { title: '[하이링크 문의] 시험아파트 간판 교체', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, dueDate: '2026-11-07' })).id;
  await sql`update users set phone = '010-1234-5678', title = '대표', work_email = 'ceo@dagym.test' where id = ${ctx.ownerId}`;
  await ctx.owner.ok('PUT', '/api/org/company-profiles', { key: 'hilink', name: 'HI-LINK 시험', phone: '1555-0000' });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('#177 문자 예약', () => {
  test('예약 → 보관함 queued·scheduled_at · 과거 시각 400 · 권한 없으면 403 · 업무 기록 sms_scheduled', async () => {
    assert.equal((await ctx.owner.req('POST', '/api/mail/sms-schedule', { taskId, to: ['010-0000-0000'], body: '내일 방문 안내', sendAt: new Date(Date.now() - 60000).toISOString() })).status, 400);
    assert.equal((await ctx.staffA.client.req('POST', '/api/mail/sms-schedule', { taskId, to: ['010-0000-0000'], body: 'x', sendAt: later(10) })).status, 403);
    const r = await ctx.owner.ok('POST', '/api/mail/sms-schedule', { taskId, to: ['010-0000-0000'], body: '내일 10시에 방문드리겠습니다.\n\n김대표 대표 · 다짐', sendAt: later(10) });
    P.id = r.id; assert.ok(r.scheduledAt);
    const h = await ctx.owner.ok('GET', `/api/tasks/${taskId}/mail?history=1`);
    const it = h.items.find((x) => x.id === r.id);
    assert.deepEqual([it.channel, it.status, !!it.scheduled_at], ['sms:handoff', 'queued', true]);
    assert.match(it.sms_body, /^내일 10시에/, '예약 문자는 본문을 다시 열 수 있게 돌려줌');
    assert.ok((await sql`select 1 from activities where entity_id = ${taskId} and action = 'sms_scheduled'`).length);
  });
  test('시각이 되면 tick 이 due 로 바꾸고 보낸 사람에게 sms_due 알림(링크 ?sms=) · 메일은 안 보냄 · [보냈어요](outboxId) → sent', async () => {
    await sql`update outbox set next_attempt_at = now() where id = ${P.id}`;
    let st = null;
    for (let i = 0; i < 12 && st !== 'due'; i++) { await tick(); st = (await sql`select status from outbox where id = ${P.id}`)[0].status; if (st !== 'due') await new Promise((r) => setTimeout(r, 1000)); }
    assert.equal(st, 'due');
    const n = (await ctx.owner.ok('GET', '/api/notifications')).items.find((x) => x.type === 'sms_due');
    assert.ok(n, '보낼 시간 알림'); assert.match(n.title, /예약한 문자를 보낼 시간입니다: 010-0000-0000/); assert.equal(n.link, `/tasks/${taskId}?sms=${P.id}`);
    const [{ c }] = await sql`select count(*)::int c from notification_deliveries d join notifications n on n.id = d.notification_id where n.id = ${n.id}`;
    assert.ok(c >= 0); // 푸시 구독이 없으면 0 — 종류 기본 푸시 켬은 prefs 에서 확인
    const p = await ctx.owner.ok('GET', '/api/notifications/prefs');
    assert.equal(p.types.find((t) => t.type === 'sms_due')?.push, true, 'sms_due 는 기본 푸시 켬');
    assert.equal((await ctx.staffA.client.req('POST', '/api/mail/sms-log', { taskId, to: ['010-0000-0000'], body: 'x', outboxId: P.id })).status, 403);
    const done = await ctx.owner.ok('POST', '/api/mail/sms-log', { taskId, to: ['010-0000-0000'], body: '내일 10시에 방문드리겠습니다.', outboxId: P.id });
    assert.equal(done.id, P.id);
    const [o] = await sql`select status, sent_at from outbox where id = ${P.id}`;
    assert.equal(o.status, 'sent'); assert.ok(o.sent_at);
    assert.equal((await ctx.owner.req('POST', '/api/mail/sms-log', { taskId, to: ['010-0000-0000'], body: 'x', outboxId: P.id })).status, 409, '두 번 처리 안 됨');
  });
  test('예약 시각 바꾸기·취소(due 도 취소 가능) · 자료 링크 있는 문자는 13일 안으로만', async () => {
    const r = await ctx.owner.ok('POST', '/api/mail/sms-schedule', { taskId, to: ['010-1111-2222'], body: '바꿀 예약', sendAt: later(20) });
    const re = await ctx.owner.ok('POST', `/api/mail/outbox/${r.id}/schedule`, { sendAt: later(40) });
    assert.ok(Date.parse(re.scheduledAt) > Date.now() + 30 * 60000);
    await sql`update outbox set status = 'due' where id = ${r.id}`;
    assert.equal((await ctx.owner.ok('POST', `/api/mail/outbox/${r.id}/schedule`, { cancel: true })).status, 'canceled');
    const att = await ctx.owner.ok('POST', '/api/attachments', { taskId, kind: 'file', fileName: '견적.pdf', mimeType: 'application/pdf', size: 3 });
    await fetch(`${BASE}${att.upload.url}`, { method: 'PUT', headers: att.upload.headers, body: Buffer.from('pdf') });
    await ctx.owner.ok('POST', `/api/attachments/${att.id}/complete`);
    const share = await ctx.owner.ok('POST', '/api/mail/share', { taskId, attachmentIds: [att.id] });
    assert.equal((await ctx.owner.req('POST', '/api/mail/sms-schedule', { taskId, to: ['010-1111-2222'], body: '자료', sendAt: new Date(Date.now() + 20 * 86400000).toISOString(), shareUrl: share.url })).status, 400);
    const ok = await ctx.owner.ok('POST', '/api/mail/sms-schedule', { taskId, to: ['010-1111-2222'], body: '자료', sendAt: later(30), shareUrl: share.url });
    assert.ok((await sql`select share_id from outbox where id = ${ok.id}`)[0].share_id, '공유 링크 연결');
  });
});

describe('V32 7 문자 초안 규칙·명함형 서명', () => {
  test('초안: 의도·첨부·마감·호칭이 프롬프트에 들어가고, 빈칸([날짜])이 남으면 warnings · "담당자님" 제거', async () => {
    await queue([say(JSON.stringify({ subject: '자료 송부', body: '담당자님, 안녕하세요.\n요청하신 자료를 [날짜]까지 보내드리겠습니다.', recommend: [] }))]);
    const r = await ctx.owner.ok('POST', '/api/mail/draft', { taskId, kind: 'material', channel: 'sms', intent: 'send', hasFiles: true });
    const req = (await fakeState()).anthropic.at(-1).body;
    assert.match(req.system, /대괄호 빈칸/); assert.match(req.system, /담당자님" 금지/);
    const u = req.messages[0].content;
    assert.match(u, /\[의도\] 자료 보냄/); assert.match(u, /\[첨부\] 있음/); assert.match(u, /\[업무 마감\] 11월 7일\(토\)/);
    assert.ok(!/담당자님/.test(r.body), '호칭 없으면 담당자님 제거');
    assert.equal(r.warnings.length, 1); assert.match(r.warnings[0], /빈칸이 남아 있습니다: \[날짜\]/);
    assert.equal((await ctx.owner.req('POST', '/api/mail/draft', { taskId, kind: 'material', intent: 'nope' })).status, 400);
  });
  test('명함형 서명 3줄(이름 직급 · 회사 / 휴대폰 / 메일) · 대표번호는 회사 설정으로 켤 때만 · 편집 권한 없으면 403', async () => {
    const c = await ctx.owner.ok('GET', `/api/tasks/${taskId}/mail`);
    const line = c.companies[0].smsLine.split('\n');
    assert.match(line[0], /^김대표 대표 · /); assert.equal(line[1], '휴대폰 010-1234-5678'); assert.equal(line[2], '메일 ceo@dagym.test'); assert.equal(line.length, 3, '대표번호 없음(기본 끔)');
    assert.ok([403, 404].includes((await ctx.staffA.client.req('PUT', '/api/org/sms-sign', { companyPhone: true })).status), '편집 권한 없는 메뉴는 숨김(404)');
    assert.deepEqual(await ctx.owner.ok('PUT', '/api/org/sms-sign', { companyPhone: true }), { companyPhone: true });
    const c2 = await ctx.owner.ok('GET', `/api/tasks/${taskId}/mail`);
    assert.equal(c2.companies[0].smsLine.split('\n').at(-1), '대표 1555-0000');
  });
});
