// 394차(대표 11/13 "각 페이지별 알람이 보일 수 있도록"): 알림을 링크 앞부분(화면)별로 셈 — 메뉴·하단 탭 숫자와 화면 위 '이 화면 새 알림' 줄,
// 알림 화면 ?area= 로 그 화면 알림만, [모두 읽음]은 그 화면 것만(다른 화면 알림은 그대로)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('화면별 안 읽은 알림 수 · ?area= 로 그 화면 알림만 · [모두 읽음]은 그 화면 것만', async () => {
  const uid = ctx.ownerId; let k = 0;
  const ins = (type, link, read = false) => sql`insert into notifications (user_id, type, title, body, link, dedupe_key, read_at) values (${uid}, ${type}, ${`394 ${type} ${link}`}, '', ${link}, ${`394:${k++}`}, ${read ? new Date() : null})`;
  await sql`update notifications set read_at = now() where user_id = ${uid}`; // 앞 준비 알림은 읽음으로
  await ins('task_assigned', '/tasks/aaa'); await ins('comment', '/tasks/bbb?c=1'); await ins('task_assigned', '/tasks/ccc', true);
  await ins('event_changed', '/calendar?event=e1'); await ins('approval', '/approvals/9'); await ins('lead', '/s/sales/leads?id=1');
  await ins('mkt', '/s/marketing/approvals?c=2'); await ins('chat', '/messages?room=r1'); await ins('info', '/');
  const r = await ctx.owner.ok('GET', '/api/notifications?unread=1');
  assert.equal(r.unread, 7, '메신저 빼고 안 읽은 7건');
  assert.deepEqual([r.areas['/tasks'], r.areas['/calendar'], r.areas['/approvals'], r.areas['/s/sales/leads'], r.areas['/s/marketing/approvals'], r.areas['/messages']],
    [2, 1, 1, 1, 1, undefined], JSON.stringify(r.areas));
  const only = await ctx.owner.ok('GET', '/api/notifications?area=/tasks');
  assert.deepEqual(only.items.map((n) => n.link).sort(), ['/tasks/aaa', '/tasks/bbb?c=1', '/tasks/ccc'], '업무 화면 알림만(읽은 것 포함)');
  assert.equal((await ctx.owner.ok('GET', '/api/notifications?area=/x%27;drop')).items.length, (await ctx.owner.ok('GET', '/api/notifications')).items.length, '이상한 area 는 무시(전체)');
  const rd = await ctx.owner.ok('POST', '/api/notifications/read', { area: '/tasks' });
  assert.deepEqual([rd.changed, rd.unread], [2, 5], '업무 화면 것만 읽음');
  const r2 = await ctx.owner.ok('GET', '/api/notifications?unread=1');
  assert.deepEqual([r2.areas['/tasks'], r2.areas['/calendar']], [undefined, 1], '다른 화면 알림은 그대로');
  assert.equal((await ctx.owner.req('POST', '/api/notifications/read', { area: "/tasks'--" })).status, 400);
  // 다른 사람 알림은 세지 않음
  assert.equal(((await ctx.staffA.client.ok('GET', '/api/notifications?unread=1')).areas['/calendar'] ?? 0), 0);
});
