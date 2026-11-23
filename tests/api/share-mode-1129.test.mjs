// #1129(대표 11/23): 자료실·업무 공개 방식 — 회사 설정 하나('부서·팀별' 기본 = 지금 동작 / '회사 전체 공유') + 항목마다 바꾸기 + 바꾸기 전 영향 건수
// 회사 전체 공유 = 보기·댓글만 넓어짐(고치기 권한 그대로) · 격리 팀 구성원·격리 팀 자료는 넓어지지 않음 · 바꾸기는 대표만 · 감사 기록
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql; const T = {}; const N = {};
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  T.ops = (await ctx.owner.ok('POST', '/api/teams', { name: '운영팀', kind: 'dept', members: [{ userId: ctx.staffA.id, lead: true }] })).id;
  T.sales = (await ctx.owner.ok('POST', '/api/teams', { name: '영업팀', kind: 'dept', members: [{ userId: ctx.staffB.id, lead: true }] })).id;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });
const mode = (m) => ctx.owner.ok('PUT', '/api/org/share-mode', { mode: m });
const taskIds = async (c) => (await c.ok('GET', '/api/tasks')).tasks.map((t) => t.id);

test('기본은 부서·팀별(지금 동작): 다른 지점 직원은 업무를 못 봄 · 설정 보기는 누구나, 바꾸기·영향 건수는 대표만', async () => {
  N.task = (await ctx.owner.ok('POST', '/api/tasks', { title: '강남점 시설 점검', assigneeId: ctx.managerA.id, orgUnitId: ctx.siteA })).id;
  assert.equal((await ctx.staffB.client.req('GET', `/api/tasks/${N.task}`)).status, 404);
  assert.ok(!(await taskIds(ctx.staffB.client)).includes(N.task));
  const own = await ctx.owner.ok('GET', '/api/org/share-mode');
  assert.deepEqual([own.mode, own.canEdit], ['team', true]); assert.ok(own.affected.tasks >= 1, `영향 업무 ${own.affected.tasks}`);
  const st = await ctx.staffA.client.ok('GET', '/api/org/share-mode');
  assert.deepEqual([st.mode, st.canEdit, st.affected], ['team', false, undefined]);
  assert.equal((await ctx.staffA.client.req('PUT', '/api/org/share-mode', { mode: 'company' })).status, 403, '대표만');
  assert.equal((await ctx.managerA.client.req('PUT', '/api/org/share-mode', { mode: 'company' })).status, 403);
});

test('회사 전체 공유: 다른 지점 직원도 업무를 보고 댓글은 달지만 고치지는 못함 · 감사 기록 · 다시 부서·팀별이면 안 보임', async () => {
  const r = await mode('company');
  assert.equal(r.changed, true);
  assert.equal((await ctx.staffB.client.req('GET', `/api/tasks/${N.task}`)).status, 200);
  assert.ok((await taskIds(ctx.staffB.client)).includes(N.task), '목록에도');
  assert.equal((await ctx.staffB.client.req('PATCH', `/api/tasks/${N.task}`, { title: '바꿈' })).status, 403, '고치기는 그대로 막힘');
  const [a] = await sql`select detail from audit_logs where action = 'org.share_mode' order by id desc limit 1`;
  assert.deepEqual([a.detail.from, a.detail.to], ['team', 'company']);
  await mode('team');
  assert.equal((await ctx.staffB.client.req('GET', `/api/tasks/${N.task}`)).status, 404);
});

test('업무마다: 부서·팀 모드에서 이 업무만 회사 전체 / 회사 전체 모드에서 이 업무만 부서·팀 · 바꾸기는 요청자·담당자·관리자', async () => {
  assert.equal((await ctx.staffB.client.req('PUT', `/api/tasks/${N.task}/share`, { share: 'company' })).status, 404, '못 보는 사람은 존재도 모름');
  await ctx.owner.ok('PUT', `/api/tasks/${N.task}/share`, { share: 'company' });
  assert.equal((await ctx.staffB.client.req('GET', `/api/tasks/${N.task}`)).status, 200, '이 업무만 회사 전체');
  assert.equal((await ctx.staffB.client.req('PUT', `/api/tasks/${N.task}/share`, { share: null })).status, 403, '보기만 하는 사람은 못 바꿈');
  await mode('company');
  await ctx.managerA.client.ok('PUT', `/api/tasks/${N.task}/share`, { share: 'team' }); // 담당자
  assert.equal((await ctx.staffB.client.req('GET', `/api/tasks/${N.task}`)).status, 404, '회사 전체 모드에서도 이 업무는 부서·팀만');
  assert.equal((await ctx.owner.ok('GET', `/api/tasks/${N.task}`)).task.share, 'team');
  await ctx.owner.ok('PUT', `/api/tasks/${N.task}/share`, { share: null });
  assert.equal((await ctx.staffB.client.req('GET', `/api/tasks/${N.task}`)).status, 200, '비우면 회사 설정(회사 전체)');
  await mode('team');
});

test("자료실 '우리 팀' 자료: 회사 전체 공유면 다른 팀도 봄 · 파일마다 '이 팀만' · 기밀 등급은 그대로 · 바꾸기는 올린 사람·관리자", async () => {
  const r = await ctx.staffA.client.ok('POST', '/api/library', { fileName: '운영팀 점검표.txt', mimeType: 'text/plain', size: 4, folder: '공개시험', scope: 'team', teamId: T.ops });
  await fetch(BASE + r.upload.url, { method: 'PUT', headers: r.upload.headers, body: Buffer.from('abcd') });
  await ctx.staffA.client.ok('POST', `/api/library/${r.id}/complete`);
  N.file = r.id;
  const seen = async () => (await ctx.staffB.client.ok('GET', '/api/library?scope=team')).files.some((f) => f.id === N.file);
  assert.equal(await seen(), false);
  assert.equal((await ctx.staffB.client.req('GET', `/api/library/${N.file}`)).status, 404);
  await mode('company');
  assert.equal(await seen(), true, '회사 전체 공유면 다른 팀 목록에도');
  assert.equal((await ctx.staffB.client.req('GET', `/api/library/${N.file}`)).status, 200);
  assert.equal((await ctx.staffB.client.req('PUT', `/api/library/${N.file}/share`, { share: 'team' })).status, 403, '올린 사람·관리자만');
  await ctx.staffA.client.ok('PUT', `/api/library/${N.file}/share`, { share: 'team' });
  assert.equal(await seen(), false, "이 파일만 '이 팀만'");
  assert.equal((await ctx.staffB.client.req('GET', `/api/library/${N.file}`)).status, 404);
  await ctx.staffA.client.ok('PUT', `/api/library/${N.file}/share`, { share: null });
  await sql`update library_files set security = 'confidential' where id = ${N.file}`;
  assert.equal(await seen(), false, '기밀 등급은 회사 전체 공유에도 그대로 막힘');
  await sql`update library_files set security = 'internal' where id = ${N.file}`;
  assert.equal(await seen(), true);
  await mode('team');
});

test('격리 팀: 회사 전체 공유여도 격리 팀 구성원은 넓어지지 않고, 격리 팀 업무도 다른 사람에게 열리지 않음', async () => {
  await mode('company');
  await sql`update teams set isolated = true where id = ${T.sales}`; // 영업팀(staffB)을 '회사 안의 작은 회사'로
  assert.equal((await ctx.staffB.client.req('GET', `/api/tasks/${N.task}`)).status, 404, '격리 팀 구성원은 넓어지지 않음');
  const iso = (await ctx.staffB.client.ok('POST', '/api/tasks', { title: '영업팀 내부 업무', assigneeId: ctx.staffB.id, teamId: T.sales })).id;
  assert.equal((await ctx.staffA.client.req('GET', `/api/tasks/${iso}`)).status, 404, '격리 팀 업무는 회사 전체 공유에도 안 열림');
  await sql`update teams set isolated = false where id = ${T.sales}`;
  await mode('team');
});
