// 점검 4단계 가운데 "점검 리포트"(숫자·표) — docs/check-feature-design.md 12절 · 원문 범위 4번
//  · 권한: 점검 리포트(check_report — 기본 대표·관리자). 직원·점검하기만 있는 사람은 없는 주소(404)
//  · 셈: 기간 안에 끝낸 점검 · 양호율 = 양호 ÷ (양호 + 보완 필요), 해당 없음 제외 · 곳별·분야별·항목별 · 반복 항목(같은 곳 2번 이상, 지금 연속)
//  · 보완 처리 기간(요청 → 양호 확인) · 기한 넘김 · 다시 보완 · 지난 기간과 견줌 · 곳 범위 · 회사 분리 · 엑셀
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb, BASE } from '../helpers.mjs';

let srv, ctx, sql, cafe;
const S = {};
const SITE_B = '하이링크 판교 위탁현장'; // 시험 기본 자료의 두 번째 곳(bootstrap)
const day = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
const rep = (c, qs = '') => c.ok('GET', `/api/check/report${qs ? `?${qs}` : ''}`);
const item = (round, step, title) => { const s = round.steps.find((x) => x.name === step); const i = s.items.find((x) => x.title === title); return { itemId: i.id, placeTypeId: s.placeTypeId }; };
const put = (c, roundId, it, verdict, memo) => c.ok('PUT', `/api/check/rounds/${roundId}/results`, { ...it, verdict, ...(memo ? { memo } : {}) });
const finishTask = async (c, taskId) => {
  const init = await c.ok('POST', '/api/attachments', { taskId, kind: 'file', fileName: 'done.jpg', mimeType: 'image/jpeg', size: 4, capturedAt: new Date().toISOString() });
  await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  await c.ok('POST', `/api/attachments/${init.id}/complete`, {});
  await c.ok('PATCH', `/api/tasks/${taskId}`, { status: 'done' });
};
before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  const c = new Client('ceo@check-report.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@check-report.test', password: 'signup-pass-1234', name: '김사장', mode: 'team', company: '모퉁이커피', industry: '외식·카페', agree: { terms: true, age14: true, privacy: true, ai: false, marketing: false } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  cafe = { c, unit: (await c.ok('GET', '/api/auth/me')).orgUnits[0].id };
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('권한: 직원·점검하기만 있는 사람은 404 · 대표는 빈 리포트(끝낸 점검 0, 양호율 없음) · 기간 검사', async () => {
  for (const c of [ctx.staffA.client, ctx.managerA.client]) for (const p of ['/api/check/report', '/api/check/report/export']) assert.equal((await c.req('GET', p)).status, 404, p);
  assert.equal((await new Client('anon-report').get('/api/check/report')).status, 401);
  const r = await rep(ctx.owner);
  assert.deepEqual([r.period.from, r.period.to, r.summary.rounds, r.summary.rate, r.summary.prevRate, r.byUnit, r.repeats, r.followups.total], [`${day(0).slice(0, 7)}-01`, day(0), 0, null, null, [], [], 0], '기본 기간 = 이번 달 1일 ~ 오늘');
  assert.equal((await ctx.owner.req('GET', `/api/check/report?from=${day(1)}&to=${day(0)}`)).status, 400, '시작이 끝보다 뒤');
  assert.equal((await ctx.owner.req('GET', `/api/check/report?from=${day(-400)}&to=${day(0)}`)).status, 400, '366일까지');
  assert.equal((await ctx.owner.req('GET', `/api/check/report?unitId=${cafe.unit}`)).status, 404, '다른 회사의 곳');
});

test('셈: 양호율(해당 없음 제외) · 곳별·분야별·항목별 · 반복 항목과 지금 연속 · 보완 처리 기간(당일 닫힘) · 진행 중 점검은 빼고 셈', async () => {
  const m = ctx.managerA.client;
  S.course = (await m.ok('GET', '/api/check/courses')).courses[0].id;
  // 강남점 1회차: 화장실 보완 필요 · 출입구 바닥 양호 · 거울·유리문 해당 없음
  S.r1 = (await m.ok('POST', '/api/check/rounds', { orgUnitId: ctx.siteA, courseId: S.course })).id;
  const g1 = await m.ok('GET', `/api/check/rounds/${S.r1}`);
  S.toilet = item(g1, '화장실', '화장실'); S.floor = item(g1, '출입구·로비', '출입구 바닥'); S.glass = item(g1, '출입구·로비', '거울·유리문');
  const fx1 = await put(m, S.r1, S.toilet, 'fix', '세면대 아래 물기'); await put(m, S.r1, S.floor, 'ok'); await put(m, S.r1, S.glass, 'na');
  const fin1 = await m.ok('POST', `/api/check/rounds/${S.r1}/finish`, { followups: [{ resultId: fx1.id, assigneeId: ctx.staffA.id, dueDate: day(2) }] });
  S.fu1 = fin1.followups[0].followupId; S.task1 = fin1.followups[0].taskId;
  // 강남점 2회차: 화장실 또 보완 필요 · 출입구 바닥 양호
  S.r2 = (await m.ok('POST', '/api/check/rounds', { orgUnitId: ctx.siteA, courseId: S.course })).id;
  const fx2 = await put(m, S.r2, S.toilet, 'fix', '휴지 떨어짐'); await put(m, S.r2, S.floor, 'ok');
  const fin2 = await m.ok('POST', `/api/check/rounds/${S.r2}/finish`, { followups: [{ resultId: fx2.id, assigneeId: ctx.staffA.id, dueDate: day(2) }] });
  S.fu2 = fin2.followups[0].followupId; S.task2 = fin2.followups[0].taskId;
  // 다른 곳(대표가 점검): 출입구 바닥 양호 1 — 끝냄 · 그리고 하다 만 점검 1(셈에서 빠짐)
  S.r3 = (await ctx.owner.ok('POST', '/api/check/rounds', { orgUnitId: ctx.siteB, courseId: S.course })).id;
  await put(ctx.owner, S.r3, S.floor, 'ok'); await ctx.owner.ok('POST', `/api/check/rounds/${S.r3}/finish`, {});
  S.open = (await ctx.owner.ok('POST', '/api/check/rounds', { orgUnitId: ctx.siteB, courseId: S.course })).id;
  await put(ctx.owner, S.open, S.toilet, 'fix', '아직 끝내지 않은 점검');
  // 1회차 보완: 담당자 완료 → 양호 확인(같은 날 닫힘)
  await finishTask(ctx.staffA.client, S.task1);
  await m.ok('POST', `/api/check/followups/${S.fu1}`, { ok: true });

  const r = await rep(ctx.owner);
  const s = r.summary;
  assert.deepEqual([s.rounds, s.roundsByKind, s.openRounds, s.ok, s.fix, s.na, s.rate], [3, { regular: 3, sample: 0, adhoc: 0 }, 1, 3, 2, 1, 60], '양호 3 ÷ (양호 3 + 보완 2) = 60% — 해당 없음 1 과 하다 만 점검은 뺌');
  assert.deepEqual([s.followups, s.followupsOpen, s.avgDays, s.prevRate], [2, 1, 0, null]);
  assert.deepEqual(r.byUnit.map((x) => [x.name, x.rounds, x.ok, x.fix, x.na, x.rate, x.followupsOpen, x.avgDays]), [['다짐 강남점', 2, 2, 2, 1, 50, 1, 0], [SITE_B, 1, 1, 0, 0, 100, 0, null]]);
  assert.equal(r.byCategory.reduce((n, x) => n + x.ok + x.fix + x.na, 0), 6, '분야별 합 = 결과 수');
  assert.ok(r.byCategory.every((x) => x.name) && r.byCategory[0].fix === 2, '보완이 많은 분야가 위');
  assert.deepEqual(r.byItem.map((x) => [x.title, x.ok, x.fix, x.na, x.rate]), [['화장실', 0, 2, 0, 0], ['출입구 바닥', 3, 0, 0, 100], ['거울·유리문', 0, 0, 1, null]], '보완 필요가 많은 순 · 본 것이 없으면 양호율 없음');
  assert.deepEqual(r.repeats.map((x) => [x.title, x.unitName, x.fix, x.streak, x.improvement]), [['화장실', '다짐 강남점', 2, 2, false]]);
  assert.deepEqual(r.followups, { total: 2, closed: 1, waiting: 0, requested: 1, canceled: 0, avgDays: 0, maxDays: 0, buckets: { d0: 1, d1_3: 0, d4_7: 0, d8: 0 }, overdue: 0, again: 0 });
});

test('보완 처리 기간(며칠 걸림 · 기한 넘김 · 다시 보완) · 지난 기간과 견줌 · 기간 경계는 서울 날짜', async () => {
  const m = ctx.managerA.client;
  // 1회차 보완을 5일 전에 보낸 것으로(기한은 3일 전) → 처리 5일 · 닫혔지만 기한을 넘김
  await sql`update chk_followups set created_at = now() - interval '5 days', due_date = ${day(-3)} where id = ${S.fu1}`;
  // 2회차 보완: 기한을 어제로 → 아직 열려 있고 기한 지남. 담당자 완료 → [다시 보완] → 2차
  await sql`update chk_followups set due_date = ${day(-1)} where id = ${S.fu2}`;
  let r = await rep(ctx.owner, `from=${day(-10)}&to=${day(0)}`);
  assert.deepEqual([r.followups.avgDays, r.followups.maxDays, r.followups.buckets, r.followups.overdue, r.followups.again], [5, 5, { d0: 0, d1_3: 0, d4_7: 1, d8: 0 }, 2, 0]);
  await finishTask(ctx.staffA.client, S.task2);
  assert.equal((await rep(ctx.owner, `from=${day(-10)}&to=${day(0)}`)).followups.waiting, 1, '담당자가 끝내면 확인 대기');
  await m.ok('POST', `/api/check/followups/${S.fu2}`, { ok: false, note: '칸막이 아래도 부탁드려요' });
  r = await rep(ctx.owner, `from=${day(-10)}&to=${day(0)}`);
  assert.deepEqual([r.followups.again, r.followups.requested, r.followups.waiting], [1, 1, 0], '다시 보완 = 2차, 다시 조치 중');
  // 1회차 점검을 15일 전에 끝낸 것으로 → 최근 10일 리포트에서는 빠지고(끝낸 점검 2), 바로 앞 11일(지난 기간)의 양호율로 잡힘
  await sql`update chk_rounds set ended_at = now() - interval '15 days' where id = ${S.r1}`;
  r = await rep(ctx.owner, `from=${day(-10)}&to=${day(0)}`);
  assert.deepEqual([r.period.days, r.period.prevFrom, r.period.prevTo, r.summary.rounds, r.summary.ok, r.summary.fix, r.summary.rate, r.summary.prevRate], [11, day(-21), day(-11), 2, 2, 1, 66.7, 50], '지난 기간: 양호 1 · 보완 1 = 50%');
  assert.deepEqual(r.repeats, [], '이 기간에는 같은 곳 보완이 1번뿐');
  assert.equal((await rep(ctx.owner, `from=${day(-30)}&to=${day(0)}`)).summary.rounds, 3, '기간을 넓히면 다시 들어옴');
  // 끝낸 날이 서울 날짜로 어제 23:30 이면 '어제까지' 기간에 들어가고 '오늘만' 기간에서는 빠짐
  await sql`update chk_rounds set ended_at = (${day(0)}::date::timestamp - interval '30 minutes') at time zone 'Asia/Seoul' where id = ${S.r3}`;
  assert.equal((await rep(ctx.owner, `from=${day(0)}&to=${day(0)}`)).byUnit.some((x) => x.name === SITE_B), false);
  assert.equal((await rep(ctx.owner, `from=${day(-1)}&to=${day(-1)}`)).byUnit.some((x) => x.name === SITE_B), true);
});

test('곳 범위(볼 수 있는 곳만) · 곳 하나만 보기 · 회사 분리 · 엑셀', async () => {
  // 현장 관리자에게 리포트 권한을 주면 자기 곳만 보임
  await sql`insert into menu_user_perms (menu, user_id, level) values ('check_report', ${ctx.managerA.id}, 'view')`;
  const mine = await rep(ctx.managerA.client, `from=${day(-30)}&to=${day(0)}`);
  assert.deepEqual(mine.byUnit.map((x) => x.name), ['다짐 강남점']);
  assert.equal((await ctx.managerA.client.req('GET', `/api/check/report?unitId=${ctx.siteB}`)).status, 404, '볼 수 없는 곳');
  const b = await rep(ctx.owner, `from=${day(-30)}&to=${day(0)}&unitId=${ctx.siteB}`);
  assert.deepEqual([b.byUnit.map((x) => x.name), b.summary.rounds, b.summary.openRounds, b.followups.total], [[SITE_B], 1, 1, 0]);
  // 다른 회사: 자기 것만(0) — 우리 점검이 섞이지 않음
  const c = await rep(cafe.c, `from=${day(-30)}&to=${day(0)}`);
  assert.deepEqual([c.summary.rounds, c.byUnit, c.followups.total], [0, [], 0]);
  // 엑셀
  const x = await fetch(`${BASE}/api/check/report/export?from=${day(-30)}&to=${day(0)}`, { headers: { cookie: ctx.owner.cookie } });
  assert.equal(x.status, 200); assert.match(x.headers.get('content-type') ?? '', /spreadsheetml/);
  const buf = Buffer.from(await x.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString(), 'PK'); assert.ok(buf.length > 1500);
  assert.match(decodeURIComponent(x.headers.get('content-disposition') ?? ''), /점검리포트_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx/);
});
