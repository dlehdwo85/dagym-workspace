// 점검 2단계 남은 것(11/20): 홈 '점검' 카드 요약(/api/check/summary) · 업무 목록 '점검 보완만' 거름(/api/tasks?tag=)
//  · 요약: 점검하기 권한이 없으면 show:false(404 아님 — 홈이 오류를 받지 않게) · 점검을 한 번도 하지 않은 회사는 show:false
//    진행 중인 내 점검(이어서) · 보완 요청의 조치 중/확인 대기 수 = 점검 화면과 같은 셈 · 마지막 점검 · 회사 분리
//  · 거름: 꼬리표가 정확히 '점검 보완'인 업무만 · 볼 수 있는 업무 안에서만(권한 규칙 그대로)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb, BASE } from '../helpers.mjs';

let srv, ctx, sql, cafe;
const S = {};
const TAG = encodeURIComponent('점검 보완');
const sum = (c) => c.ok('GET', '/api/check/summary');
before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  const c = new Client('ceo@check-home.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@check-home.test', password: 'signup-pass-1234', name: '김사장', mode: 'team', company: '모퉁이커피', industry: '외식·카페', agree: { terms: true, age14: true, privacy: true, ai: false, marketing: false } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  cafe = { c };
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('요약: 권한 없는 직원·점검을 쓰지 않는 회사는 show:false → 점검을 시작하면 "이어서" 1건(시작한 사람에게만)', async () => {
  assert.deepEqual(await sum(ctx.staffA.client), { show: false }, '점검하기 권한 없음 — 404 가 아니라 안 보임');
  assert.deepEqual(await sum(ctx.owner), { show: false }, '점검을 한 번도 안 한 회사의 홈에는 카드 없음');
  assert.equal((await new Client('anon-check-home').get('/api/check/summary')).status, 401);
  S.course = (await ctx.managerA.client.ok('GET', '/api/check/courses')).courses[0].id;
  S.r1 = (await ctx.managerA.client.ok('POST', '/api/check/rounds', { orgUnitId: ctx.siteA, courseId: S.course })).id;
  const s = await sum(ctx.managerA.client);
  assert.deepEqual([s.show, s.open.map((r) => [r.id, r.orgUnitName, r.name, r.done]), s.waiting, s.requested, s.last], [true, [[S.r1, '다짐 강남점', '기본 매장 점검', 0]], 0, 0, null]);
  assert.deepEqual(await sum(ctx.owner), { show: false }, '남이 하던 점검은 내 홈에 없음(끝낸 점검·보완 요청도 아직 없음)');
});

test('보완 요청 수: 끝내면 조치 중 1 → 담당자가 완료하면 확인 대기 1 → 양호 확인하면 0 · 점검 화면의 셈과 같음 · 마지막 점검', async () => {
  const round = await ctx.managerA.client.ok('GET', `/api/check/rounds/${S.r1}`);
  const step = round.steps.find((x) => x.name === '화장실'); const item = step.items.find((i) => i.title === '화장실');
  const res = await ctx.managerA.client.ok('PUT', `/api/check/rounds/${S.r1}/results`, { itemId: item.id, placeTypeId: step.placeTypeId, verdict: 'fix', memo: '세면대 아래 물기' });
  assert.equal((await sum(ctx.managerA.client)).open[0].done, 1, '적은 개수');
  const fin = await ctx.managerA.client.ok('POST', `/api/check/rounds/${S.r1}/finish`, { followups: [{ resultId: res.id, assigneeId: ctx.staffA.id }] });
  S.fu = fin.followups[0].followupId; S.task = fin.followups[0].taskId;
  let s = await sum(ctx.managerA.client);
  assert.deepEqual([s.open, s.waiting, s.requested, s.last.orgUnitName, s.last.name], [[], 0, 1, '다짐 강남점', '기본 매장 점검']);
  const o = await sum(ctx.owner);
  assert.deepEqual([o.show, o.open, o.waiting, o.requested], [true, [], 0, 1], '대표 홈에도(회사 전체 범위)');
  // 담당자가 사진 올리고 완료 → 확인 대기
  const init = await ctx.staffA.client.ok('POST', '/api/attachments', { taskId: S.task, kind: 'file', fileName: 'done.jpg', mimeType: 'image/jpeg', size: 4, capturedAt: new Date().toISOString() });
  await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  await ctx.staffA.client.ok('POST', `/api/attachments/${init.id}/complete`, {});
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${S.task}`, { status: 'done' });
  s = await sum(ctx.managerA.client);
  const home = await ctx.managerA.client.ok('GET', '/api/check/home');
  assert.deepEqual([s.waiting, s.requested], [1, 0]);
  assert.deepEqual([home.counts.waiting, home.counts.requested], [s.waiting, s.requested], '점검 화면의 셈과 같음');
  await ctx.managerA.client.ok('POST', `/api/check/followups/${S.fu}`, { ok: true });
  s = await sum(ctx.managerA.client);
  assert.deepEqual([s.show, s.waiting, s.requested, !!s.last], [true, 0, 0, true], '열린 것이 없어도 점검을 해 본 회사면 카드는 남음(마지막 점검 — 휴대폰에서 점검으로 들어가는 길)');
  await sql`update chk_rounds set ended_at = now() - interval '45 days' where id = ${S.r1}`;
  s = await sum(ctx.managerA.client);
  assert.equal(s.show, true, '오래전에 한 점검이어도 남음'); assert.ok(Date.now() - new Date(s.last.endedAt).getTime() > 44 * 864e5);
  await sql`update chk_rounds set ended_at = now() where id = ${S.r1}`;
});

test("업무 목록 '점검 보완만': 꼬리표가 정확히 '점검 보완'인 업무만 · 볼 수 있는 업무 안에서만 · 다른 회사에는 없음", async () => {
  await ctx.owner.ok('POST', '/api/tasks', { title: '보통 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: false });
  await ctx.owner.ok('POST', '/api/tasks', { title: '꼬리표가 비슷한 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: false, tags: ['점검 보완 참고'] });
  const list = async (c, qs) => (await c.ok('GET', `/api/tasks?limit=100&includeDone=1&${qs}`)).tasks.map((t) => t.title).sort();
  assert.deepEqual(await list(ctx.owner, `tag=${TAG}`), ['화장실 보완 요청']);
  assert.deepEqual(await list(ctx.staffA.client, `tag=${TAG}`), ['화장실 보완 요청'], '담당 직원에게도(자기 업무)');
  assert.deepEqual(await list(ctx.staffB.client, `tag=${TAG}`), [], '볼 수 없는 사람에게는 없음(권한 규칙 그대로)');
  assert.deepEqual(await list(ctx.owner, `tag=${encodeURIComponent('없는 꼬리표')}`), []);
  assert.ok((await list(ctx.owner, '')).length >= 3, '거름이 없으면 전부');
  assert.deepEqual(await list(cafe.c, `tag=${TAG}`), [], '다른 회사');
  assert.deepEqual(await sum(cafe.c), { show: false }, '다른 회사 홈 카드에는 우리 점검이 안 셈');
});
