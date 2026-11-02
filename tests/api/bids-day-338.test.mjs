// 338차(대표 11/02 #922 새 공고 날짜별): 입찰 '오늘 새 공고' 탭에 ?day=YYYY-MM-DD → 그날 처음 수집(또는 공고일이 그날)한 공고 · days = 최근 7일 날짜별 건수(오늘 칸 = 오늘 새 공고 칩 수) ·
// 영업기회 허브(건물·시설·협력사) ?day=today|YYYY-MM-DD 도 같은 방식 + days
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday(); const d1 = addDays(today, -1), d3 = addDays(today, -3), d10 = addDays(today, -10);
const put = (tbl, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', ${tbl}, ${String(row.id)}, ${sql.json(row)})`;
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const due = `${addDays(today, 14)}T17:00`;
  await put('procurement_notices', { id: 'T0', title: '오늘 수집 체육시설 위탁', issuer: '성남시', related: true, first_seen_at: today, deadline_at: due });
  await put('procurement_notices', { id: 'Y1', title: '어제 수집 수영장 위탁', issuer: '평택시', related: true, first_seen_at: d1, deadline_at: due });
  await put('procurement_notices', { id: 'Y1b', title: '어제 수집 문화센터 위탁', issuer: '용인시', related: true, first_seen_at: d1, deadline_at: due });
  await put('procurement_notices', { id: 'D3', title: '사흘 전 수집 헬스장 위탁(마감 지남)', issuer: '안양시', related: true, first_seen_at: d3, deadline_at: `${d1}T17:00` });
  await put('procurement_notices', { id: 'OLD', title: '열흘 전 수집 커뮤니티 위탁', issuer: '수원시', related: true, first_seen_at: d10, deadline_at: due });
  await put('building_sales_pipeline', { id: 'B0', name: '오늘 새단지', households: 900, region: '경기', first_seen_at: today });
  await put('building_sales_pipeline', { id: 'B1', name: '어제 새단지', households: 1200, region: '경기', first_seen_at: d1 });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });
const bids = (p) => ctx.owner.ok('GET', `/api/sales/src?view=bids&tab=today${p ? `&${p}` : ''}`);
const ids = (r) => r.items.map((n) => n.id).sort();

test('오늘 새 공고 탭: days = 최근 7일(오늘부터) 날짜별 건수 · 오늘 칸 = 오늘 새 공고 칩 수 · 사흘 전은 마감 지났어도 그날 수에 · 열흘 전은 7일 밖', async () => {
  const r = await bids();
  assert.equal(r.day, today); assert.equal(r.days.length, 7); assert.equal(r.days[0].day, today); assert.equal(r.days[1].day, d1); assert.equal(r.days[6].day, addDays(today, -6));
  assert.equal(r.days[0].n, r.todayCount); assert.equal(r.days[0].n, 1); assert.equal(r.days[1].n, 2); assert.equal(r.days[3].n, 1);
  assert.deepEqual(ids(r), ['T0']);
});

test('?day=어제 → 어제 처음 수집한 공고만(주소 ?bt=날짜) · 사흘 전은 마감 지난 공고도 그날 목록에 · 오늘 날짜·엉뚱한 값은 오늘 탭 그대로', async () => {
  const y = await bids(`day=${d1}`); assert.equal(y.day, d1); assert.deepEqual(ids(y), ['Y1', 'Y1b']);
  const t3 = await bids(`day=${d3}`); assert.deepEqual(ids(t3), ['D3']);
  const t = await bids(`day=${today}`); assert.equal(t.day, today); assert.deepEqual(ids(t), ['T0']);
  const bad = await bids('day=2026-13-99'); assert.equal(bad.day, today); assert.deepEqual(ids(bad), ['T0']);
  const open = await ctx.owner.ok('GET', `/api/sales/src?view=bids&tab=open&day=${d1}`); assert.equal(open.day, null, '다른 탭에서는 날짜를 안 씀'); assert.ok(open.items.length >= 3);
});

test('영업기회 허브 건물 탭: ?day=today / YYYY-MM-DD 로 그날 새로 들어온 것만 + days 날짜별 건수(날짜 필터 전 기준)', async () => {
  const all = await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=buildings');
  assert.equal(all.items.length, 2); assert.equal(all.day, null); assert.equal(all.days.length, 7); assert.equal(all.days[0].n, 1); assert.equal(all.days[1].n, 1);
  const t = await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=buildings&day=today'); assert.equal(t.day, today); assert.deepEqual(t.items.map((b) => b.id), ['B0']);
  const y = await ctx.owner.ok('GET', `/api/sales/src?view=hub&tab=buildings&day=${d1}`); assert.equal(y.day, d1); assert.deepEqual(y.items.map((b) => b.id), ['B1']); assert.equal(y.days[1].n, 1);
});
