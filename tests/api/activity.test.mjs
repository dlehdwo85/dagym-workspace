// 로컬 10/19(대표) 홈 개편: 홈 '최근 활동' 카드 → 알림 '활동' 탭(/api/notifications/activity). 보이는 업무만·멘션은 @이름·최근 30일·완료/댓글/등록
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('활동 탭: 등록·댓글(멘션 @이름)·완료, 권한 밖 업무는 없음', async () => {
  const id = (await ctx.owner.ok('POST', '/api/tasks', { title: '활동 탭 시험 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
  await ctx.owner.ok('POST', `/api/tasks/${id}/comments`, { body: `확인 부탁 @[이직원](${ctx.staffA.id})` });
  const t = (await ctx.staffA.client.ok('GET', `/api/tasks/${id}`)).task;
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'done', version: t.version });
  const items = (await ctx.owner.ok('GET', '/api/notifications/activity')).items.filter((a) => a.task_id === id);
  assert.deepEqual(items.map((a) => a.kind).sort(), ['comment', 'created', 'done']);
  const c = items.find((a) => a.kind === 'comment');
  assert.equal(c.body, '확인 부탁 @이직원', '멘션 원문·id 안 보임');
  assert.ok(items.every((a) => a.title === '활동 탭 시험 업무' && a.at));
  const other = (await ctx.owner.ok('POST', '/api/tasks', { title: '본사 비밀 업무', orgUnitId: ctx.hq, approvalRequired: false })).id;
  assert.ok(!(await ctx.staffA.client.ok('GET', '/api/notifications/activity')).items.some((a) => a.task_id === other), '권한 밖 업무 활동 없음');
  assert.ok((await ctx.owner.ok('GET', '/api/dashboard')).activity.length <= 10, '대시보드는 호환용 10건');
});
