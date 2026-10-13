// 알림 신뢰성 (WORKIN_NOTIFY_RELIABILITY): 요청 편승 정기 실행 · 쓰기 뒤 즉시 푸시 발송
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays, ensureTls, BASE } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
before(async () => {
  await resetDb();
  await ensureTls();
  fake = await startFakeGoogle();
  srv = await startServer({ PIGGYBACK_TICK: '1', PIGGYBACK_CHECK_MS: '500' });
  sql = testDb();
  ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('정기 실행이 10분 넘게 없으면 로그인 사용자의 요청 뒤에 한 번만 편승 실행 → 기한 지남 알림 생성', async () => {
  const id = (await ctx.owner.ok('POST', '/api/tasks', { title: '편승 시험 지난 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: addDays(seoulToday(), -1) })).id;
  await wait(3000); // 준비 단계(로그인 등)에서 돈 편승 실행이 끝나기를 기다린 뒤 기록을 비워 "10분 넘게 없음" 상태로
  await sql`delete from job_runs`; await sql`delete from job_locks`;
  await wait(600);
  for (let i = 0; i < 5; i++) await ctx.staffA.client.ok('GET', '/api/tasks?limit=5');
  for (let i = 0; i < 40; i++) { const r = await sql`select count(*)::int n from job_runs where trigger = 'piggyback' and status = 'ok'`; if (r[0].n) break; await wait(250); }
  const runs = await sql`select trigger, status from job_runs where job = 'tick'`;
  assert.equal(runs.filter((r) => r.trigger === 'piggyback' && r.status !== 'skipped').length, 1, `한 번만 (${JSON.stringify(runs)})`);
  const [{ n }] = await sql`select count(*)::int n from notifications where entity_id = ${id} and type = 'overdue'`;
  assert.ok(n >= 1, '편승 실행이 기한 지남 알림을 만듦');
  // 방금 실행했으니 더 요청해도 다시 돌지 않음 (10분 안)
  await wait(1100);
  for (let i = 0; i < 3; i++) { await ctx.owner.ok('GET', '/api/tasks?limit=5'); await wait(600); }
  await wait(1500);
  const again = await sql`select count(*)::int n from job_runs where trigger = 'piggyback' and status <> 'skipped'`;
  assert.equal(again[0].n, 1);
  const health = await (await fetch(BASE + '/api/health')).json();
  assert.equal(health.scheduler.lastTrigger, 'piggyback');
});

test('담당자 변경(PATCH) 직후 대기 중 푸시가 남지 않음 (정기 실행을 기다리지 않음)', async () => {
  await ctx.staffB.client.ok('POST', '/api/push/subscribe', { kind: 'fcm', endpoint: 'fcm-token-good', platform: 'android' });
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: '담당 변경 푸시', orgUnitId: ctx.siteB });
  const d = await ctx.owner.ok('GET', `/api/tasks/${t.id}`);
  await ctx.owner.ok('PATCH', `/api/tasks/${t.id}`, { assigneeId: ctx.staffB.id, version: d.task.version });
  let rows = [];
  for (let i = 0; i < 40; i++) {
    rows = await sql`select d.status from notification_deliveries d join notifications n on n.id = d.notification_id where n.entity_id = ${t.id} and n.type = 'task_assigned'`;
    if (rows.length && rows.every((r) => r.status !== 'pending')) break;
    await wait(250);
  }
  assert.ok(rows.length >= 1 && rows.every((r) => r.status === 'sent'), JSON.stringify(rows));
});
