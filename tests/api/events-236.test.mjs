// 236차(대표 10/28 '일정생성불가함' — 로컬 재현: 일정 창이 캘린더 목록보다 먼저 열리면 새 일정 저장 요청에 캘린더가 빠져 '캘린더: 필수 항목입니다'):
// 새 일정에 캘린더가 없거나 빈 값이면 본인 개인 캘린더 · 고른 캘린더는 그대로 · 고칠 때 캘린더를 빼면 그대로 · 권한 없는 캘린더는 전처럼 막음
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
const at = (h) => { const d = new Date(Date.now() + 2 * 864e5); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('캘린더 없이·빈 값으로 만든 새 일정 = 내 개인 캘린더 · 고른 캘린더는 그대로', async () => {
  const cals = (await ctx.staffA.client.ok('GET', '/api/calendars')).calendars;
  const mine = cals.find((c) => c.type === 'personal').id;
  const a = await ctx.staffA.client.ok('POST', '/api/events', { title: '236 캘린더 없이', start: at(1), end: at(2) });
  assert.equal(a.calendarId, mine);
  assert.equal((await ctx.staffA.client.ok('GET', `/api/events/${a.id}`)).event.calendar_id, mine);
  const b = await ctx.staffA.client.ok('POST', '/api/events', { title: '236 빈 캘린더', calendarId: '', start: at(3), end: at(4) });
  assert.equal(b.calendarId, mine);
  const other = cals.find((c) => c.type !== 'personal' && c.perms.edit);
  if (other) { const c = await ctx.staffA.client.ok('POST', '/api/events', { title: '236 고른 캘린더', calendarId: other.id, start: at(5), end: at(6) }); assert.equal(c.calendarId, other.id); }
  // 고칠 때 캘린더 칸이 없으면 그대로
  const v = (await ctx.staffA.client.ok('GET', `/api/events/${a.id}`)).event.version;
  await ctx.staffA.client.ok('PATCH', `/api/events/${a.id}`, { title: '236 캘린더 없이(고침)', version: v, scope: 'all' });
  const e = (await ctx.staffA.client.ok('GET', `/api/events/${a.id}`)).event;
  assert.deepEqual([e.title, e.calendar_id], ['236 캘린더 없이(고침)', mine]);
});

test('권한: 남의 개인 캘린더에 넣으려 하면 전처럼 막음(빈 값 기본은 늘 내 캘린더)', async () => {
  const ownerCal = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'personal').id;
  const r = await ctx.staffA.client.req('POST', '/api/events', { title: '236 남의 캘린더', calendarId: ownerCal, start: at(7), end: at(8) });
  assert.ok([403, 404].includes(r.status), String(r.status));
});
