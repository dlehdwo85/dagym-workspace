// 238차(#742 대표 10/28 '화면 전환이 느림'): 220 마이그레이션 = 이 앱 DB 역할의 JIT 끔 — 큰 SQL(업무 건수 칩·목록·홈 요약)이 컴파일에 1초 넘게 쓰던 원인.
// 서버 새 접속이 jit=off 인지(/api/health dbJit) · 건수 칩 API 가 그대로 같은 값을 주는지(결과는 JIT 와 무관)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('220 마이그레이션: 앱 DB 역할 jit=off(새 접속부터) · 건강 점검에 dbJit · 기록표에 220', async () => {
  const h = await (await fetch(`${BASE}/api/health`)).json();
  assert.equal(h.dbJit, 'off', JSON.stringify({ dbJit: h.dbJit, migration: h.migration }));
  assert.ok(String(h.migration) >= '220_jit_off.sql', h.migration);
  const [r] = await sql`select exists (select 1 from pg_roles, unnest(rolconfig) c where rolname = current_user and c = 'jit=off') as off`;
  assert.equal(r.off, true, '역할 설정에 jit=off');
});

test('건수 칩 API 는 그대로(값은 JIT 와 무관) — 내 업무 2 · 지연 1', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const past = new Date(Date.parse(today) - 2 * 864e5).toISOString().slice(0, 10);
  await ctx.owner.ok('POST', '/api/tasks', { title: '238 내 업무', assigneeId: ctx.ownerId });
  await ctx.owner.ok('POST', '/api/tasks', { title: '238 지연 업무', assigneeId: ctx.ownerId, dueDate: past });
  const c = (await ctx.owner.ok('GET', '/api/tasks/counts?includeDone=week')).counts;
  assert.deepEqual([c.my, c.overdue], [2, 1], JSON.stringify(c));
});
