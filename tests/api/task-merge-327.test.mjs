// 327차(로컬 11/02 8·9 — 대표 지시 '사람별로 따로 만든 같은 업무를 내용 합쳐서 공동 업무로'):
// ① 중복 업무 통합은 관리자도(요청자가 다른 사람인 원본 — 전엔 '삭제 = 요청자만' 규칙으로 대표 계정이 403)
// ② 사람마다 따로 만든 같은 업무 찾기('각자 1건씩' 묶음 · 같은 제목·같은 요청자·만든 시각 10분 안, 담당이 서로 다름) → 고른 묶음을 공동 업무 1건으로(요청자·관리자)
//    담당이 한 사람뿐인 묶음(시험 데이터)·만든 시각이 먼 것(주차 다른 자동 알림)은 묶음 아님 · 직원은 자기가 요청한 묶음만 봄
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });
const mk = (client, body, unit) => client.ok('POST', '/api/tasks', { orgUnitId: unit ?? ctx.hq, approvalRequired: false, ...body }); // 직원·매니저는 자기 조직(siteA)에

test('① 중복 통합: 요청자가 직원 A 인 원본을 관리자(대표)가 대상에 통합 → 200 · 요청자도 관리자도 아닌 현장 관리자는 403 · 원본 휴지통·담당은 함께 담당·댓글 한 줄(관리자 통합)', async () => {
  const x = await mk(ctx.staffA.client, { title: '하이링크 운영 및 변동사항 공유 회의', assigneeId: ctx.staffA.id }, ctx.siteA);
  const y = await mk(ctx.staffA.client, { title: '하이링크 운영 및 변동사항 공유 회의', assigneeId: ctx.staffB.id }, ctx.siteA);
  assert.equal((await ctx.managerA.client.req('POST', `/api/tasks/${x.id}/merge`, { intoId: y.id })).status, 403, '같은 조직 현장 관리자(요청자도 관리자도 아님)는 못 함');
  const r = await ctx.owner.ok('POST', `/api/tasks/${x.id}/merge`, { intoId: y.id });
  assert.equal(r.id, y.id);
  assert.ok((await sql`select deleted_at from tasks where id = ${x.id}`)[0].deleted_at, '원본은 휴지통');
  const [c] = await sql`select body from comments where task_id = ${y.id} order by created_at desc limit 1`;
  assert.match(c.body, /^\[중복 통합\].*\(관리자 통합\)$/);
  assert.deepEqual((await sql`select user_id from task_assignees where task_id = ${y.id}`).map((a) => a.user_id), [ctx.staffA.id], '원본 담당은 함께 담당으로');
  assert.equal((await sql`select count(*)::int n from activities where entity_id = ${y.id} and action = 'merged_from'`)[0].n, 1);
});

test('② 묶음 찾기·합치기: 각자 1건씩 3명 + 같은 제목(띄어쓰기만 다름)·요청자 2건은 묶음 · 담당 1명 2건·1주일 떨어진 2건은 아님 · 직원 A 0건·매니저 2묶음·관리자 전부 · 권한 403·다른 제목 400 · 합치면 함께 담당·댓글 옮김·다시 하면 건너뜀', async () => {
  const b = await ctx.managerA.client.ok('POST', '/api/tasks', { title: '고척 오픈 센터 16일 현장 방문시 체크리스트', assigneeId: ctx.staffA.id, assigneeIds: [ctx.staffA.id, ctx.staffB.id, ctx.managerA.id], orgUnitId: ctx.siteA, approvalRequired: false });
  assert.ok(b.batchId);
  const t1 = await mk(ctx.managerA.client, { title: '고천대방지구 디에트르센트럴 소장 미팅', assigneeId: ctx.staffA.id }, ctx.siteA);
  const t2 = await mk(ctx.managerA.client, { title: '고천대방지구  디에트르센트럴 소장  미팅', assigneeId: ctx.staffB.id }, ctx.siteA); // 띄어쓰기만 다름
  const s1 = await mk(ctx.owner, { title: '[영업] [시험] 리드 광고 신청 — 다음 연락', assigneeId: ctx.ownerId });
  await mk(ctx.owner, { title: '[영업] [시험] 리드 광고 신청 — 다음 연락', assigneeId: ctx.ownerId }); // 담당이 같은 한 사람 → 묶음 아님
  const w1 = await mk(ctx.owner, { title: '[마케팅] 문의 0건 7일째', assigneeId: ctx.staffA.id });
  await mk(ctx.owner, { title: '[마케팅] 문의 0건 7일째', assigneeId: ctx.staffB.id });
  await sql`update tasks set created_at = created_at - interval '7 days' where id = ${w1.id}`; // 주차가 다른 자동 알림 → 묶음 아님
  const all = (await ctx.owner.ok('GET', '/api/tasks/dupes')).sets;
  assert.deepEqual(all.map((s) => s.title.replace(/\s+/g, ' ')).sort(), ['고천대방지구 디에트르센트럴 소장 미팅', '고척 오픈 센터 16일 현장 방문시 체크리스트'].sort());
  const bs = all.find((s) => s.batch); assert.equal(bs.tasks.length, 3); assert.equal(bs.requesterId, ctx.managerA.id);
  const ts = all.find((s) => !s.batch); assert.deepEqual(ts.tasks.map((x) => x.id).sort(), [t1.id, t2.id].sort());
  assert.deepEqual(ts.tasks.map((x) => x.assigneeName).sort(), ['박직원', '이직원'].sort());
  assert.equal((await ctx.staffA.client.ok('GET', '/api/tasks/dupes')).sets.length, 0, '직원 A 가 요청한 묶음은 없음');
  assert.equal((await ctx.managerA.client.ok('GET', '/api/tasks/dupes')).sets.length, 2, '매니저 A 는 자기가 요청한 2묶음');
  assert.equal((await ctx.staffA.client.req('POST', '/api/tasks/dupes', { sets: [[t1.id, t2.id]] })).status, 403, '요청자·관리자만');
  assert.equal((await ctx.owner.req('POST', '/api/tasks/dupes', { sets: [[t1.id, s1.id]] })).status, 400, '다른 제목끼리는 못 합침');
  await ctx.staffB.client.ok('POST', `/api/tasks/${t2.id}/comments`, { body: 'B: 소장 연락처 받아 둠' });
  await ctx.staffB.client.ok('POST', `/api/tasks/${t2.id}/checklist`, { text: '회의 자료 출력' });
  const r = await ctx.owner.ok('POST', '/api/tasks/dupes', { sets: [[t1.id, t2.id], bs.tasks.map((x) => x.id)] });
  assert.equal(r.merged.length, 2); assert.equal(r.skipped.length, 0);
  const keep = r.merged.find((m) => m.title.startsWith('고천대방지구')).keep;
  assert.equal(keep, t1.id, '먼저 만든 업무를 남김');
  assert.ok((await sql`select deleted_at from tasks where id = ${t2.id}`)[0].deleted_at, '나머지는 휴지통');
  assert.deepEqual((await sql`select user_id from task_assignees where task_id = ${keep}`).map((a) => a.user_id), [ctx.staffB.id], '다른 담당은 함께 담당');
  assert.equal((await sql`select count(*)::int n from comments where task_id = ${keep} and body = 'B: 소장 연락처 받아 둠'`)[0].n, 1, '댓글 옮김');
  assert.equal((await sql`select count(*)::int n from task_checklist_items where task_id = ${keep} and text = '회의 자료 출력'`)[0].n, 1, '체크리스트 옮김');
  const bk = r.merged.find((m) => m.title.startsWith('고척')).keep;
  assert.equal((await sql`select count(*)::int n from task_assignees where task_id = ${bk}`)[0].n, 2, '세 사람 = 주 담당 + 함께 담당 2');
  assert.equal((await sql`select batch_id from tasks where id = ${bk}`)[0].batch_id, null);
  const d = (await ctx.staffB.client.ok('GET', `/api/tasks/${keep}`)).task;
  assert.ok((d.co_assignees ?? []).some((c) => c.id === ctx.staffB.id), '직원 B 화면에 공동 업무로');
  assert.equal((await ctx.owner.ok('GET', '/api/tasks/dupes')).sets.length, 0, '합친 뒤 묶음 없음');
  const again = await ctx.owner.ok('POST', '/api/tasks/dupes', { sets: [[t1.id, t2.id]] });
  assert.deepEqual([again.merged.length, again.skipped.length], [0, 1], '이미 합친 묶음은 건너뜀');
});
