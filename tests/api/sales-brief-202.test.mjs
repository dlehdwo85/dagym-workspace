// 202차 #461 ⑤ 놓침 방지(설계 docs/handoff/SALES_LEADS_REVAMP_2026-10-23.md 4절): 아침 브리핑 영업 한 줄(내 담당 · 대표·관리자는 회사 전체 + 담당 없음) ·
// 개인 주간 보고 초안 '다음 행동 없음'·'오래 쉼(14일 넘게 연락 없음)' · 본사 주간 보고 '영업 진행' — 진행 중 거래처만(종결 제외), 영업 공간을 쓰는 사람만
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const hourKst = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date()));
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); };
const lead = async (name, owner, next, o = {}) => (await sql`insert into sales_leads (tenant, name, status, owner_id, next_contact_date, created_at)
  values ('default', ${name}, ${o.status ?? '1차연락완료'}, ${owner}, ${next}, now() - ${o.age ?? 0} * interval '1 day') returning id`)[0].id;
const briefingOn = async (c) => { const p = await c.ok('GET', '/api/notifications/prefs'); await c.ok('PUT', '/api/notifications/prefs', { settings: { ...p.settings, briefingTime: '00:00', briefingWeekend: true, briefingEnabled: true } }); };

before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffB.id, spaces: ['sales'] });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('아침 브리핑 영업 한 줄: 내 담당 오늘 연락·연락일 지남·다음 행동 없음 · 대표·관리자 = 회사 전체 + 담당 없음 · 종결·영업 공간 밖은 없음 · 업무·일정 없이 영업만 있어도 보냄', async () => {
  await lead('브리핑 오늘', ctx.staffA.id, today);
  await lead('브리핑 지남', ctx.staffA.id, addDays(today, -3), { age: 20 });
  await lead('브리핑 없음', ctx.staffA.id, null, { age: 20 });
  await lead('브리핑 종결', ctx.staffA.id, null, { status: '실패' });
  await lead('브리핑 담당 없음', null, null);
  await lead('브리핑 B', ctx.staffB.id, null);
  await sql`delete from notifications where type = 'briefing'`;
  for (const c of [ctx.owner, ctx.staffA.client, ctx.staffB.client, ctx.managerA.client]) await briefingOn(c);
  await tick();
  const body = async (id) => (await sql`select body from notifications where user_id = ${id} and type = 'briefing'`)[0]?.body ?? null;
  if (hourKst >= 22) return; // 22시 뒤에는 브리핑을 보내지 않음(기존 규칙)
  assert.equal(await body(ctx.staffA.id), '영업(내 담당) 오늘 연락 1, 연락일 지남 1, 다음 행동 없음 1', '종결은 빼고 · 업무·일정이 없어도 영업만으로 보냄');
  assert.equal(await body(ctx.staffB.id), '영업(내 담당) 다음 행동 없음 1');
  assert.equal(await body(ctx.ownerId), '영업(회사 전체) 오늘 연락 1, 연락일 지남 1, 다음 행동 없음 3, 담당 없음 1');
  const m = await body(ctx.managerA.id);
  assert.ok(!m || !m.includes('영업('), '영업 공간 밖이면 영업 줄 없음');
  // 오늘 이미 보낸 사람은 다음 실행에서 다시 세지도 보내지도 않음
  await tick();
  assert.equal((await sql`select count(*)::int n from notifications where user_id = ${ctx.staffA.id} and type = 'briefing'`)[0].n, 1);
});

test('개인 주간 보고 초안: 내 담당 다음 행동 없음·오래 쉼(마지막 접촉 기준 14일, 상담 기록이 있으면 아님) · 영업 공간 밖은 칸 없음', async () => {
  const fresh = await lead('보고 최근 상담', ctx.staffA.id, addDays(today, 5), { age: 30 });
  await ctx.owner.ok('POST', `/api/sales/leads/${fresh}/activities`, { type: '전화', content: '근황 통화' });
  await sql`delete from personal_reports where user_id = ${ctx.staffA.id}`;
  const r = (await ctx.staffA.client.ok('POST', '/api/reports/mine', {})).report;
  assert.deepEqual([r.data.salesNone, r.data.salesStale], [1, 2], r.body);
  assert.match(r.body, /■ 영업 — 다음 행동 없음 \(1건\): 다음 연락일을 정하거나 종결해 주세요\n {2}- 브리핑 없음 \(1차연락완료\)/);
  assert.match(r.body, /■ 영업 — 오래 쉼: 14일 넘게 연락 없음 \(2건\)\n/);
  assert.match(r.body, / {2}- 브리핑 지남 \(연락 기록 없음 · 등록 \d+\/\d+\)/);
  assert.ok(r.body.indexOf('■ 영업') > r.body.indexOf('■ 다음 주 마감') && r.body.indexOf('■ 영업') < r.body.indexOf('■ 이번 주 일정'), '다음 주 마감과 이번 주 일정 사이');
  const part = r.body.slice(r.body.indexOf('■ 영업'), r.body.indexOf('■ 이번 주 일정')); // 위 업무 칸에는 '[영업] … 다음 연락' 업무 이름이 따로 나올 수 있음
  assert.ok(!part.includes('보고 최근 상담') && !part.includes('브리핑 종결') && !part.includes('브리핑 오늘'), `상담 기록 있음·종결·오늘 만든 건은 빠짐\n${part}`);
  await sql`delete from personal_reports where user_id = ${ctx.managerA.id}`;
  const m = (await ctx.managerA.client.ok('POST', '/api/reports/mine', {})).report;
  assert.ok(!m.body.includes('■ 영업')); assert.equal(m.data.salesNone, undefined);
});

test('본사 주간 보고 영업 진행: 진행 중·오늘·연락일 지남·다음 행동 없음·담당 없음·오래 쉼 + 오래 쉼 목록(담당·마지막 접촉) · 쓰기 전환 전이면 없음', async () => {
  await sql`delete from weekly_reports`;
  const { id } = await ctx.owner.ok('POST', '/api/reports', {});
  const s = (await ctx.owner.ok('GET', `/api/reports/${id}`)).report.data.sales;
  assert.equal(s.asOf, today);
  assert.deepEqual([s.open, s.today, s.over, s.none, s.unassigned, s.stale], [6, 1, 1, 3, 1, 2]);
  assert.deepEqual(s.staleTop.map((x) => x.name).sort(), ['브리핑 없음', '브리핑 지남']);
  assert.deepEqual([s.staleTop[0].owner, s.staleTop[0].last], ['이직원', null]);
  await sql`update sales_cutover set writes_open = false where tenant = 'default'`;
  await sql`delete from weekly_reports`;
  const { id: id2 } = await ctx.owner.ok('POST', '/api/reports', {});
  assert.equal((await ctx.owner.ok('GET', `/api/reports/${id2}`)).report.data.sales, null);
  await sql`update sales_cutover set writes_open = true where tenant = 'default'`;
});
