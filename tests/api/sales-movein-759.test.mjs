// 242차 #759(대표 10/28 '26년도 입주에 관한 아파트 리스트가 아직 리스트업 안되어 있다' · 로컬 원인: 입주 시기 창이 입주 예정월 늦은 순 + 100건 상한이라 2026년 1~11월 입주가 잘림):
// 입주 연도(YYYY)·여러 해(YYYY-YYYY)·달(YYYY-MM) 고르기 · 입주가 오늘에 가까운 순 · 전체 건수·달마다 건수 · 더 보기(offset, 100건 상한 없음) ·
// 아파트만(오피스텔·도시형 빼기, 종류 모르는 줄은 남김)·세대수 이상 · 영업기회 허브 K-apt 준공·입주 단지도 같은 해로(?my=) — 구조 시험(영업기회 줄을 직접 심음)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
const [Y, M] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date()).split('-').map(Number);
const mm = (n) => String(n).padStart(2, '0');
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const put = (k, moveIn, detail = {}) => sql`insert into prospects (source_code, ext_id, name, sido, status, opened_on, category, detail, raw, base_date)
    values ('15098547', ${'mi759:' + k}, ${'입주759 ' + k}, '경기', '모집공고', current_date, '민영', ${sql.json({ moveIn, households: 500, kind: '아파트', ...detail })}, ${sql.json({})}, current_date)`;
  // 올해 1~12월 아파트 120곳(예전 100건 상한 넘김) · 같은 해 오피스텔 5세대 · 종류 모르는 줄 · 다음 해 2곳 · 지난해 1곳
  for (let i = 0; i < 120; i++) await put(`a${i}`, `${Y}-${mm((i % 12) + 1)}-01`, { households: 100 + i });
  await put('officetel', `${Y}-${mm(M)}-01`, { kind: '오피스텔·도시형·민간임대·생활숙박', households: 5 });
  await put('unknown', `${Y}-${mm(M)}-01`, { kind: null, households: 300 });
  await put('next1', `${Y + 1}-01-01`); await put('next2', `${Y + 1}-06-01`); await put('prev', `${Y - 1}-12-01`);
  await ctx.owner.ok('PUT', '/api/sales/sources/15098547', { enabled: true });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });
const get = (qs) => ctx.owner.ok('GET', `/api/sales/prospects?q=${encodeURIComponent('입주759')}&${qs}`);

test('올해 입주: 전체 건수·달마다 건수 · 가까운 순 · 아파트만이면 오피스텔 빠지고 종류 모르는 줄은 남음 · 더 보기로 끝까지', async () => {
  const r = await get(`moveIn=${Y}&apt=1`);
  assert.equal(r.total, 121, '아파트 120 + 종류 모름 1(오피스텔 빠짐) — 100건에서 안 끊김');
  assert.equal(r.prospects.length, 100); assert.deepEqual([r.moveIn.from, r.moveIn.to], [`${Y}-01-01`, `${Y}-12-01`]);
  assert.equal(r.moveIn.months.length, 12); assert.equal(r.moveIn.months.find((x) => x.ym === `${Y}-${mm(M)}`).n, 11, '이번 달 10 + 종류 모름 1');
  const dist = (p) => Math.abs(Number(p.detail.moveIn.slice(0, 4)) * 12 + Number(p.detail.moveIn.slice(5, 7)) - (Y * 12 + M));
  const ds = r.prospects.map(dist); assert.deepEqual(ds, [...ds].sort((a, b) => a - b), '입주가 이번 달에 가까운 순');
  assert.equal(r.prospects[0].detail.moveIn.slice(0, 7), `${Y}-${mm(M)}`);
  const all = await get(`moveIn=${Y}`); assert.equal(all.total, 122, '아파트만 끄면 오피스텔도');
  const p2 = await get(`moveIn=${Y}&apt=1&offset=100`);
  assert.equal(p2.prospects.length, 21); assert.equal(p2.total, 121);
  assert.equal(new Set([...r.prospects, ...p2.prospects].map((x) => x.id)).size, 121, '겹침·빠짐 없이 끝까지');
});

test('달·여러 해·세대수 이상 · 잘못된 값은 거르기 없음', async () => {
  const m = await get(`moveIn=${Y}-${mm(M)}&apt=1`);
  assert.equal(m.total, 11); assert.deepEqual(m.moveIn.months, [], '한 달이면 달 칩 없음');
  const two = await get(`moveIn=${Y}-${Y + 1}&apt=1`);
  assert.equal(two.total, 123, '올해·다음 해'); assert.ok(two.moveIn.months.some((x) => x.ym === `${Y + 1}-06`));
  assert.equal((await get(`moveIn=${Y}&apt=1&minHh=200`)).total, 20 + 0 + 1, '세대수 200 이상: 100+i ≥ 200 → i 100~119 + 종류 모름(300)');
  const bad = await get('moveIn=abcd');
  assert.equal(bad.moveIn, undefined); assert.equal(bad.total, 125, '거르기 없이 전체(이 시험 줄 125)');
});

test('영업기회 허브 K-apt 준공·입주 단지 ?my= — 입주일(없으면 준공일) 연도·달 · 전체 건수', async () => {
  const id = (n) => `00000000-0000-4000-8000-000000759${String(n).padStart(3, '0')}`;
  const put = (n, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'operating_facility_prospects', ${id(n)}, ${sql.json({ id: id(n), ...row })}, 'workin')`;
  await put(1, { name: '입주759 준공단지', completion_date: `${Y}-03-15`, household_count: 800, region: '경기' });
  await put(2, { name: '입주759 입주단지', completion_date: `${Y - 1}-12-20`, move_in_date: `${Y}-02-01`, household_count: 600, region: '경기' });
  await put(3, { name: '입주759 옛단지', completion_date: `${Y - 3}-05-01`, household_count: 900, region: '경기' });
  const h = await ctx.owner.ok('GET', `/api/sales/src?view=hub&tab=facilities&q=${encodeURIComponent('입주759')}&my=${Y}&sort=moveIn`);
  assert.deepEqual(h.items.map((x) => x.name).sort(), ['입주759 입주단지', '입주759 준공단지']);
  assert.equal(h.total, 2); assert.equal(h.filters.my, String(Y));
  const feb = await ctx.owner.ok('GET', `/api/sales/src?view=hub&tab=facilities&q=${encodeURIComponent('입주759')}&my=${Y}-02`);
  assert.deepEqual(feb.items.map((x) => x.name), ['입주759 입주단지'], '입주일이 있으면 입주일 기준');
  assert.equal((await ctx.owner.ok('GET', `/api/sales/src?view=hub&tab=facilities&q=${encodeURIComponent('입주759')}&my=x`)).items.length, 3, '잘못된 값은 거르기 없음');
});
