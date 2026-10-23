// #194 앱 1.1.3 웹 몫: 딥링크 해석(workos://tasks/{id}·workos://app/…·workos://open/…·https) · 문자 바로 첨부 계획(합계 10MB·10개) · [보냈어요] 기록에 붙인 파일
// 앱 쪽(위젯 새로고침·문자앱 첨부)은 휴대폰에서만 — 로컬이 실기기에서 확인(구조 시험 통과 ≠ 실제 연동 완료)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const { deepPath } = await import('../../src/lib/deepLink.ts'); // Node 22 형식 제거로 .ts 직접 불러옴
const { planSmsAttach, SMS_ATTACH_MAX_BYTES } = await import('../../src/lib/smsAttach.ts');

test('딥링크 → 앱 안 주소: 서버 위젯 links·앱 위젯/알람·소셜 로그인·앱 링크, /api 는 열지 않음', () => {
  const cases = [
    ['workos://tasks/3f1c2b9a-0000-4000-8000-000000000001', '/tasks/3f1c2b9a-0000-4000-8000-000000000001'], // 전에는 '/3f1c…' 로 열렸다
    ['workos://tasks?new=1', '/tasks?new=1'],
    ['workos://calendar?view=timeGridDay', '/calendar?view=timeGridDay'],
    ['workos://assistant', '/assistant'],
    ['workos://app/tasks/abc', '/tasks/abc'],
    ['workos://app/tasks?new=1', '/tasks?new=1'],
    ['workos://app', '/'],
    ['workos://open/auth/app?code=x&state=y', '/auth/app?code=x&state=y'],
    ['https://work-in.dev/tasks/abc#c1', '/tasks/abc#c1'],
    ['https://work-in.dev', '/'],
    ['workos:///messages', '/messages'],
    ['workos://app//evil.test/x', '/evil.test/x'],
    ['workos://api/auth/logout', '/'],
    ['workos://app/api/tasks', '/'],
    ['아무 글자', '/'],
    ['', '/'],
  ];
  for (const [raw, want] of cases) assert.equal(deepPath(raw), want, raw);
});

test('문자 바로 첨부 계획: 고른 순서대로 합계 10MB·10개까지, 넘치는 파일만 링크', () => {
  const MB = 1024 * 1024;
  const p = planSmsAttach([{ id: 'a', size: 9 * MB }, { id: 'b', size: 2 * MB }, { id: 'c', size: MB }]);
  assert.deepEqual([p.direct.map((x) => x.id), p.link.map((x) => x.id), p.bytes], [['a', 'c'], ['b'], 10 * MB]);
  assert.deepEqual(planSmsAttach([{ id: 'big', size: SMS_ATTACH_MAX_BYTES + 1 }]).link.map((x) => x.id), ['big'], '10MB 넘는 한 파일 = 링크');
  assert.equal(planSmsAttach([{ id: 'x', size: SMS_ATTACH_MAX_BYTES }]).direct.length, 1, '딱 10MB 는 붙임');
  const many = planSmsAttach(Array.from({ length: 12 }, (_, i) => ({ id: String(i), size: 1000 })));
  assert.deepEqual([many.direct.length, many.link.length], [10, 2]);
  assert.deepEqual(planSmsAttach([]), { direct: [], link: [], bytes: 0 });
});

let srv, sql, ctx, taskId;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  taskId = (await ctx.owner.ok('POST', '/api/tasks', { title: '문자 첨부 시험 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id; });
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('[보냈어요] 기록: 문자에 바로 붙인 파일 → 보관함 첨부 n개·업무 기록 · 형식 검사', async () => {
  const files = [{ name: '견적서.pdf', size: 120_000 }, { name: '현장 사진.jpg', size: 2_400_000 }];
  const r = await ctx.owner.ok('POST', '/api/mail/sms-log', { taskId, to: ['010-0000-0000'], body: '견적서와 사진 보내 드립니다', files });
  const [o] = await sql`select channel, status, files, share_id from outbox where id = ${r.id}`;
  assert.deepEqual([o.channel, o.status, o.files, o.share_id], ['sms:handoff', 'sent', files, null]);
  const h = await ctx.owner.ok('GET', `/api/tasks/${taskId}/mail?history=1`);
  assert.deepEqual(h.items.find((x) => x.id === r.id).files.map((f) => f.name), ['견적서.pdf', '현장 사진.jpg'], '보관함 줄에 첨부 2개');
  const [a] = await sql`select changes from activities where entity_id = ${taskId} and action = 'sms_sent' order by created_at desc limit 1`;
  assert.deepEqual(a.changes.files, ['견적서.pdf', '현장 사진.jpg']);
  // 옛 앱·PC(파일 없이 링크): 지금처럼 files 없음
  const r2 = await ctx.owner.ok('POST', '/api/mail/sms-log', { taskId, to: ['010-0000-0000'], body: '링크로 보냅니다' });
  assert.deepEqual((await sql`select files from outbox where id = ${r2.id}`)[0].files, []);
  assert.equal((await ctx.owner.req('POST', '/api/mail/sms-log', { taskId, to: ['010-0000-0000'], body: 'x', files: [{ name: 'a', size: 200 * 1024 * 1024 }] })).status, 400, '100MB 넘는 크기');
  assert.equal((await ctx.owner.req('POST', '/api/mail/sms-log', { taskId, to: ['010-0000-0000'], body: 'x', files: Array.from({ length: 21 }, (_, i) => ({ name: `f${i}`, size: 1 })) })).status, 400, '21개');
});
