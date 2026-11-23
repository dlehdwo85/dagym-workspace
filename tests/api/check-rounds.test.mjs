// 점검 2단계 — 점검하기 · 보완 흐름 (docs/check-feature-design.md 3-3 · 11절, 대표 11/18 "검토는 완료의 조건이 아니다")
//  · 코스(공간 유형 순서)대로 항목을 보고 양호·보완 필요·해당 없음 + 메모 + 사진 → 끝내기
//  · 보완 필요 = 보완 요청 = 업무 1건(사진 증빙 1장, 정중한 요청형 글, 꼬리표 '점검 보완')
//  · 담당자가 업무를 [완료]하면(검토 요청 없이) 보완 요청이 '확인 대기' → 점검자가 [양호 확인] 또는 [다시 보완](같은 업무 다시 열기·회차 +1)
//  · 같은 항목·같은 곳 3회 연속 보완 필요 → 개선 과제(업무 1건, 한 번만) · 외부 연락 기록과 회신 기한 지남 알림 · 수시 점검
//  · 권한: 점검하기(check_run) — 직원은 없는 것처럼(404), 볼 수 있는 조직 밖은 404 · 회사 분리
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Client, bootstrap, resetDb, startServer, testDb, tick, BASE } from '../helpers.mjs';

let srv, ctx, sql, cafe, jpg;
const S = {};
const upPhoto = async (c, taskId, name = 'done.jpg') => {
  const init = await c.ok('POST', '/api/attachments', { taskId, kind: 'file', fileName: name, mimeType: 'image/jpeg', size: 4, capturedAt: new Date().toISOString() });
  await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
  await c.ok('POST', `/api/attachments/${init.id}/complete`, {});
};
const day = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
const find = (round, title, stepName) => round.steps.filter((s) => !stepName || s.name === stepName).flatMap((s) => s.items.map((i) => ({ ...i, placeTypeId: s.placeTypeId }))).find((i) => i.title === title);
const put = (c, roundId, item, verdict, memo) => c.req('PUT', `/api/check/rounds/${roundId}/results`, { itemId: item.id, placeTypeId: item.placeTypeId, verdict, ...(memo ? { memo } : {}) });
const notes = async (userId, type = 'check_followup') => (await sql`select title, body from notifications where user_id = ${userId} and type = ${type} order by created_at`).map((n) => n.title);
before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  const c = new Client('ceo@check-rounds.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@check-rounds.test', password: 'signup-pass-1234', name: '김사장', mode: 'team', company: '모퉁이커피', industry: '외식·카페', agree: { terms: true, age14: true, privacy: true, ai: true, marketing: false } /* #1087 AI 동의 필수 */ });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  cafe = { c, unit: me.orgUnits[0].id };
  jpg = (await sharp({ create: { width: 64, height: 48, channels: 3, background: '#a74' } }).jpeg().toBuffer()).toString('base64');
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('권한·코스: 직원은 없는 것처럼(404) · 점검자는 기본 코스(출입구·로비 → 고객 이용 공간 → 화장실 → 직원 공간 → 창고)를 봄 · 코스 만들기는 가이드 편집 권한', async () => {
  for (const p of ['/api/check/courses', '/api/check/home', '/api/check/followups']) assert.equal((await ctx.staffA.client.req('GET', p)).status, 404, `직원 ${p}`);
  assert.equal((await ctx.staffA.client.req('POST', '/api/check/rounds', { orgUnitId: ctx.siteA })).status, 404);
  const cs = (await ctx.managerA.client.ok('GET', '/api/check/courses')).courses;
  assert.deepEqual(cs.map((c) => [c.name, c.placeTypeIds.length, c.orgUnitId, c.includeGeneral]), [['기본 매장 점검', 5, null, true]]);
  S.course = cs[0].id;
  assert.equal((await ctx.managerA.client.ok('GET', '/api/check/courses')).courses.length, 1, '다시 열어도 한 개');
  const types = (await ctx.owner.ok('GET', '/api/check/place-types')).placeTypes;
  S.toilet = types.find((t) => t.name === '화장실').id; S.door = types.find((t) => t.name === '출입구·로비').id;
  assert.equal((await ctx.managerA.client.req('POST', '/api/check/courses', { name: '화장실만', placeTypeIds: [S.toilet] })).status, 403, '현장 관리자는 가이드 보기만 → 코스 못 만듦');
  S.mini = (await ctx.owner.ok('POST', '/api/check/courses', { name: '입구·화장실 빠른 점검', orgUnitId: ctx.siteA, placeTypeIds: [S.door, S.toilet], includeGeneral: false })).id;
  assert.deepEqual((await ctx.managerA.client.ok('GET', '/api/check/courses')).courses.map((c) => c.name), ['기본 매장 점검', '입구·화장실 빠른 점검']);
  assert.equal((await ctx.owner.req('POST', '/api/check/courses', { name: '남의 유형', placeTypeIds: ['00000000-0000-4000-8000-000000000000'] })).status, 404);
});

test('점검 시작 · 코스 순서대로 항목 · 결과 적기(다시 적으면 고침) · 결과 사진 · 시작한 사람만 기록 · 범위 밖 조직은 404', async () => {
  assert.equal((await ctx.managerA.client.req('POST', '/api/check/rounds', { orgUnitId: ctx.siteB, courseId: S.course })).status, 404, '내가 볼 수 없는 조직');
  assert.equal((await ctx.managerA.client.req('POST', '/api/check/rounds', { orgUnitId: ctx.siteB, courseId: S.mini })).status, 404);
  const st = await ctx.managerA.client.ok('POST', '/api/check/rounds', { orgUnitId: ctx.siteA, courseId: S.course });
  assert.equal(st.kind, 'regular'); S.r1 = st.id;
  const r = await ctx.managerA.client.ok('GET', `/api/check/rounds/${S.r1}`);
  assert.deepEqual(r.steps.map((s) => s.name), ['출입구·로비', '고객 이용 공간', '화장실', '직원 공간', '창고', '공간 없이 보는 항목'], '코스 순서 + 공간 없는 항목은 마지막');
  assert.deepEqual([r.round.courseName, r.round.kindLabel, r.done, r.count], ['기본 매장 점검', '정기', 0, { ok: 0, fix: 0, na: 0 }]);
  const door = find(r, '출입구 바닥'); const toilet = find(r, '화장실', '화장실'); const lamp = find(r, '조명');
  assert.deepEqual([door.passCriteria, door.blindSpots, door.method, door.result], ['먼지·물기·이물 없음', ['매트 아래', '모서리'], 'look', null]);
  assert.equal(lamp.placeTypeId, null, '조명은 공간 유형이 없는 항목');
  // 같은 항목이 여러 공간 유형에 걸리면 공간마다 따로 적는다(쓰레기통: 고객 이용 공간 · 화장실 · 직원 공간)
  assert.equal(r.steps.filter((s) => s.items.some((i) => i.title === '쓰레기통')).length, 3);
  assert.equal((await put(ctx.managerA.client, S.r1, door, 'ok')).status, 200);
  const fx = await put(ctx.managerA.client, S.r1, toilet, 'fix', '세면대 아래 물기');
  assert.equal(fx.status, 200); S.res1 = fx.body.id;
  assert.equal((await put(ctx.managerA.client, S.r1, lamp, 'fix')).status, 200);
  assert.equal((await put(ctx.managerA.client, S.r1, lamp, 'na')).body.id, (await put(ctx.managerA.client, S.r1, lamp, 'na')).body.id, '다시 적으면 같은 줄을 고침');
  assert.equal((await put(ctx.owner, S.r1, door, 'fix')).status, 409, '시작한 사람만 기록');
  assert.equal((await put(ctx.managerA.client, S.r1, { id: '00000000-0000-4000-8000-000000000000', placeTypeId: null }, 'ok')).status, 404);
  // 결과 사진
  const ph = await ctx.managerA.client.ok('POST', `/api/check/rounds/${S.r1}/results/${S.res1}/photos`, { fileName: '세면대.jpg', mimeType: 'image/jpeg', data: jpg });
  assert.equal((await ctx.owner.req('POST', `/api/check/rounds/${S.r1}/results/${S.res1}/photos`, { fileName: 'x.jpg', mimeType: 'image/jpeg', data: jpg })).status, 404, '시작한 사람만 사진');
  assert.equal((await ctx.managerA.client.req('GET', `/api/check/photos/${ph.id}`)).status, 302);
  assert.equal((await ctx.staffA.client.req('GET', `/api/check/photos/${ph.id}`)).status, 404, '점검 결과 사진은 점검 권한이 있는 사람만');
  const again = await ctx.managerA.client.ok('GET', `/api/check/rounds/${S.r1}`);
  assert.deepEqual([again.done, again.count], [3, { ok: 1, fix: 1, na: 1 }]);
  assert.deepEqual(find(again, '화장실', '화장실').result, { id: S.res1, verdict: 'fix', memo: '세면대 아래 물기', photos: [{ id: ph.id }] });
  assert.equal((await ctx.managerA.client.ok('GET', '/api/check/home')).open[0].id, S.r1, '점검 홈: 이어서 할 점검');
});

test('끝내기: 보완 필요 = 업무 1건(담당·기한·사진 증빙 1장·요청형 글·꼬리표) · 한 번만 · 끝낸 뒤에는 못 고침', async () => {
  const bad = await ctx.managerA.client.req('POST', `/api/check/rounds/${S.r1}/finish`, { followups: [{ resultId: S.res1, assigneeId: '00000000-0000-4000-8000-000000000000' }] });
  assert.equal(bad.status, 400, '없는 사람');
  const due = day(2);
  const fin = await ctx.managerA.client.ok('POST', `/api/check/rounds/${S.r1}/finish`, { followups: [{ resultId: S.res1, assigneeId: ctx.staffA.id, dueDate: due, note: '오전 중에 부탁드려요' }] });
  assert.deepEqual([fin.count, fin.followups.length, fin.improvements.length], [{ ok: 1, fix: 1, na: 1 }, 1, 0]);
  S.fu1 = fin.followups[0].followupId; S.task1 = fin.followups[0].taskId;
  const d = await ctx.staffA.client.ok('GET', `/api/tasks/${S.task1}`);
  assert.deepEqual([d.task.title, d.task.assignee_id, d.task.due_date, d.task.photo_required, d.task.tags, d.task.task_type, d.task.status], ['화장실 보완 요청', ctx.staffA.id, due, 1, ['점검 보완'], 'normal', 'todo']);
  for (const re of [/다짐 강남점 화장실의 "화장실"을\(를\) 살펴봐 주세요/, /\*\*언제까지\*\*: /, /\*\*양호 기준\*\*: 바닥 물기·냄새 없음, 휴지·비누 채워짐/, /\*\*점검 때 본 것\*\*: 세면대 아래 물기/, /\*\*이렇게 해 주세요\*\*: 즉시 청소·보충/, /\*\*덧붙임\*\*: 오전 중에 부탁드려요/, /사진 1장을 올리고 \[완료\]/])
    assert.match(d.task.description, re);
  assert.ok(!/지적|불합격|재지시|시정/.test(d.task.description), '지적·평가 말투 없음');
  assert.equal((await ctx.managerA.client.req('POST', `/api/check/rounds/${S.r1}/finish`, {})).status, 409, '두 번 끝낼 수 없음');
  const r = await ctx.managerA.client.ok('GET', `/api/check/rounds/${S.r1}`);
  assert.equal((await put(ctx.managerA.client, S.r1, find(r, '출입구 바닥'), 'fix')).status, 409, '끝낸 점검은 못 고침');
  const fu = await ctx.managerA.client.ok('GET', '/api/check/followups?state=open');
  assert.deepEqual(fu.followups.map((f) => [f.itemTitle, f.state, f.assigneeName, f.dueDate, f.roundNo, f.photos, f.placeTypeName]), [['화장실', 'requested', '이직원', due, 1, 0, '화장실']]);
  assert.deepEqual(fu.counts, { requested: 1, waiting: 0, closed: 0 });
  const home = await ctx.managerA.client.ok('GET', '/api/check/home');
  assert.equal(home.open.length, 0); assert.deepEqual([home.recent[0].id, home.recent[0].ok, home.recent[0].fix], [S.r1, 1, 1]);
});

test('보완 확인: 업무가 완료돼야(검토 요청 없이 [완료]) 확인 대기 → 점검자 알림 → [다시 보완](같은 업무 다시 열기·회차 2) → 다시 완료 → [양호 확인] 닫힘', async () => {
  assert.equal((await ctx.managerA.client.req('POST', `/api/check/followups/${S.fu1}`, { ok: true })).status, 409, '조치 전에는 확인할 수 없음');
  const noPhoto = await ctx.staffA.client.patch(`/api/tasks/${S.task1}`, { status: 'done' });
  assert.equal(noPhoto.status, 409); assert.match(noPhoto.body.error.message, /사진 1장/);
  await upPhoto(ctx.staffA.client, S.task1);
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${S.task1}`, { status: 'done' }); // 검토 요청 없이 바로 완료
  assert.equal((await ctx.managerA.client.req('GET', '/api/check/followups?unitId=abc')).status, 200, '모양이 틀린 곳 값은 서버 오류가 아님');
  let fu = (await ctx.managerA.client.ok('GET', '/api/check/followups')).followups.find((f) => f.id === S.fu1);
  assert.deepEqual([fu.state, fu.photos], ['waiting', 1], '업무가 완료되면 확인 대기');
  await tick();
  assert.deepEqual(await notes(ctx.managerA.id), ['보완 확인 요청: 화장실']);
  await tick();
  assert.equal((await notes(ctx.managerA.id)).length, 1, '같은 회차는 한 번만 알림');
  // 다시 보완
  assert.equal((await ctx.staffA.client.req('POST', `/api/check/followups/${S.fu1}`, { ok: true })).status, 404, '직원은 확인 못 함');
  assert.equal((await ctx.managerA.client.req('POST', `/api/check/followups/${S.fu1}`, { ok: false })).status, 400, '다시 보완은 까닭을 적어야 함');
  const ag = await ctx.managerA.client.ok('POST', `/api/check/followups/${S.fu1}`, { ok: false, note: '칸막이 아래쪽도 한 번 더 부탁드려요' });
  assert.deepEqual([ag.state, ag.roundNo], ['requested', 2]);
  assert.notEqual(ag.taskId, S.task1, '같은 담당자에게 새 업무');
  assert.equal((await ctx.staffA.client.ok('GET', `/api/tasks/${S.task1}`)).task.status, 'done', '앞 업무는 완료 그대로(업무의 상태는 담당자만 바꿈)');
  const t2 = (await ctx.staffA.client.ok('GET', `/api/tasks/${ag.taskId}`)).task;
  assert.deepEqual([t2.title, t2.assignee_id, t2.status, t2.photo_required, t2.tags], ['화장실 보완 요청(2차)', ctx.staffA.id, 'todo', 1, ['점검 보완']]);
  assert.match(t2.description, /한 번 더 살펴봐 주세요/); assert.match(t2.description, /\*\*다시 살펴볼 것\*\*: 칸막이 아래쪽도 한 번 더 부탁드려요/);
  const [row] = await sql`select task_id, prev_task_ids from chk_followups where id = ${S.fu1}`;
  assert.deepEqual([row.task_id, row.prev_task_ids], [ag.taskId, [S.task1]]);
  assert.equal((await ctx.managerA.client.ok('GET', '/api/check/followups')).followups.find((f) => f.id === S.fu1).state, 'requested');
  // 다시 완료 → 확인 대기(회차 2 알림 한 번 더) → 양호 확인
  await upPhoto(ctx.staffA.client, ag.taskId);
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${ag.taskId}`, { status: 'done' });
  await tick();
  assert.equal((await notes(ctx.managerA.id)).length, 2);
  const ok = await ctx.managerA.client.ok('POST', `/api/check/followups/${S.fu1}`, { ok: true, note: '깔끔합니다' });
  assert.equal(ok.state, 'closed');
  assert.equal((await ctx.managerA.client.req('POST', `/api/check/followups/${S.fu1}`, { ok: true })).status, 409, '이미 닫힘');
  fu = (await ctx.managerA.client.ok('GET', '/api/check/followups?state=closed')).followups;
  assert.deepEqual(fu.map((f) => [f.id, f.state, f.roundNo, f.closeNote]), [[S.fu1, 'closed', 2, '깔끔합니다']]);
  assert.ok((await notes(ctx.staffA.id)).includes('보완 확인: 화장실 — 양호'));
});

test('개선 과제: 같은 항목·같은 곳이 3회 연속 보완 필요면 업무 1건(한 번만) · 외부 연락 기록 → 회신 기한 지나면 알림 → 결과 적으면 닫힘', async () => {
  const run = async (extra) => {
    const id = (await ctx.managerA.client.ok('POST', '/api/check/rounds', { orgUnitId: ctx.siteA, courseId: S.mini })).id;
    const r = await ctx.managerA.client.ok('GET', `/api/check/rounds/${id}`);
    assert.deepEqual(r.steps.map((s) => s.name), ['출입구·로비', '화장실'], '곳 전용 코스 · 공간 없는 항목 빼기');
    const res = await put(ctx.managerA.client, id, find(r, '출입구 바닥'), 'fix', '매트 아래 먼지');
    const wall = find(r, '바닥·벽 파손');
    const w = extra ? await put(ctx.managerA.client, id, wall, 'fix', '경사로 타일 들뜸') : null;
    const fin = await ctx.managerA.client.ok('POST', `/api/check/rounds/${id}/finish`, { followups: w ? [{ resultId: w.body.id, external: { target: '건물 관리처', replyDue: day(-1) } }] : [] });
    return { id, fin, res: res.body.id };
  };
  const a = await run(); const b = await run();
  assert.deepEqual([a.fin.improvements.length, b.fin.improvements.length], [0, 0], '1·2회째는 아직');
  // 담당·기한을 정하지 않은 보완 요청: 담당 없음 · 기한 = 오늘 + 항목의 기본 기한(출입구 바닥 0일)
  const [f0] = await sql`select f.assignee_id, f.due_date::text d from chk_followups f where f.result_id = ${a.res}`;
  assert.deepEqual([f0.assignee_id, f0.d], [null, day(0)]);
  const c = await run(true);
  assert.equal(c.fin.improvements.length, 1, '3회째에 개선 과제');
  const imp = await ctx.managerA.client.ok('GET', `/api/tasks/${c.fin.improvements[0].taskId}`);
  assert.deepEqual([imp.task.title, imp.task.tags, imp.task.assignee_id], ['[개선 과제] 출입구 바닥 — 3회 연속 보완 필요', ['개선 과제'], ctx.managerA.id]);
  assert.match(imp.task.description, /양호 기준·확인 방법을 고친다/);
  const d = await run();
  assert.equal(d.fin.improvements.length, 0, '열린 개선 과제가 있으면 또 만들지 않음');
  const home = await ctx.managerA.client.ok('GET', '/api/check/home');
  assert.deepEqual(home.improvements.map((m) => [m.item_title, m.streak]), [['출입구 바닥', 3]]);
  // 외부 연락
  assert.deepEqual(home.external.map((e) => [e.target, e.itemTitle, e.replyDue, e.closed]), [['건물 관리처', '바닥·벽 파손', day(-1), false]]);
  await tick();
  assert.ok((await notes(ctx.managerA.id)).includes('회신 기한이 지났습니다: 건물 관리처'));
  await tick();
  assert.equal((await notes(ctx.managerA.id)).filter((t) => t.startsWith('회신 기한')).length, 1, '한 번만');
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/check/external/${home.external[0].id}`, { outcome: 'x' })).status, 404);
  await ctx.managerA.client.ok('PATCH', `/api/check/external/${home.external[0].id}`, { outcome: '다음 주 화요일 보수 예정' });
  assert.equal((await ctx.managerA.client.ok('GET', '/api/check/home')).external.length, 0);
});

test('수시 점검: 코스 없이 시작 → 항목을 찾아 적기 → 끝내기', async () => {
  const st = await ctx.managerA.client.ok('POST', '/api/check/rounds', { orgUnitId: ctx.siteA });
  assert.equal(st.kind, 'adhoc');
  const found = (await ctx.managerA.client.ok('GET', `/api/check/rounds/${st.id}/items?q=${encodeURIComponent('소화기')}`)).items;
  assert.deepEqual(found.map((i) => i.title), ['소화기·비상구']);
  assert.equal((await ctx.managerA.client.req('POST', `/api/check/rounds/${st.id}/finish`, {})).status, 400, '기록 없이 끝낼 수 없음');
  await ctx.managerA.client.ok('PUT', `/api/check/rounds/${st.id}/results`, { itemId: found[0].id, verdict: 'ok', memo: '통로 이상 없음' });
  const r = await ctx.managerA.client.ok('GET', `/api/check/rounds/${st.id}`);
  assert.deepEqual([r.round.kindLabel, r.steps.length, r.steps[0].items.map((i) => [i.title, i.result.verdict]), r.total], ['수시', 1, [['소화기·비상구', 'ok']], 1]);
  const fin = await ctx.managerA.client.ok('POST', `/api/check/rounds/${st.id}/finish`, {});
  assert.deepEqual([fin.count, fin.followups], [{ ok: 1, fix: 0, na: 0 }, []]);
});

test('회사 분리: 다른 회사의 점검·보완 요청은 없는 것처럼(404) · 자기 회사 것만 셈', async () => {
  for (const [m, p, b] of [['GET', `/api/check/rounds/${S.r1}`], ['PUT', `/api/check/rounds/${S.r1}/results`, { itemId: '00000000-0000-4000-8000-000000000000', verdict: 'ok' }], ['POST', `/api/check/rounds/${S.r1}/finish`, {}],
    ['POST', `/api/check/followups/${S.fu1}`, { ok: true }], ['PATCH', `/api/check/courses/${S.mini}`, { name: '남의 코스', placeTypeIds: [] }], ['POST', '/api/check/rounds', { orgUnitId: ctx.siteA }]])
    assert.equal((await cafe.c.req(m, p, b)).status, 404, `${m} ${p}`);
  assert.deepEqual((await cafe.c.ok('GET', '/api/check/followups')).followups, []);
  const cs = (await cafe.c.ok('GET', '/api/check/courses')).courses;
  assert.deepEqual(cs.map((c) => c.name), ['기본 매장 점검']);
  const st = await cafe.c.ok('POST', '/api/check/rounds', { orgUnitId: cafe.unit, courseId: cs[0].id });
  const r = await cafe.c.ok('GET', `/api/check/rounds/${st.id}`);
  assert.ok(r.steps.some((s) => s.items.some((i) => i.title === '출입구 바닥')));
  assert.equal((await ctx.owner.req('GET', `/api/check/rounds/${st.id}`)).status, 404, '기본 회사도 다른 회사 점검은 404');
  const per = await sql`select tenant, count(*)::int n from chk_rounds group by tenant`;
  assert.deepEqual(per.map((x) => [x.tenant === 'default' ? 'default' : 'other', x.n]).sort(), [['default', 6], ['other', 1]]);
});
