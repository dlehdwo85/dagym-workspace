// 243차 #760(대표 10/28 '이문아이파크는 … 위탁사가 관리주체 즉 관리사무소를 뜻하는건데? db에서 위탁이라는 단어를 전부 커뮤니티 위탁으로 착각?'):
// K-apt 주택관리업자(관리회사)는 커뮤니티 운영사가 아님 — 허브 카드·상세의 운영사 칸에 관리회사를 쓰지 않고 '관리회사(주택관리업자)'로 따로 ·
// 예전에 운영사 칸에 관리회사와 같은 이름을 넣은 값도 운영사로 보지 않음 · 진짜 운영사를 적으면 그대로
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
const FID = '00000000-0000-4000-8000-000000760001';
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'operating_facility_prospects', ${FID},
    ${sql.json({ id: FID, facility_type: '아파트', name: '시험칠육공아이파크자이', region: '서울 동대문구', household_count: 4321, management_company: '(주)시험관리', scale_note: '관리 위탁관리', completion_date: '2025-01-20' })}, 'workin')`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });
const card = async () => (await ctx.owner.ok('GET', `/api/sales/src?view=hub&tab=facilities&q=${encodeURIComponent('시험칠육공')}`)).items.find((x) => String(x.id) === FID);

test('관리회사만 있으면 운영사 칸 비움 · 관리회사(주택관리업자)는 따로', async () => {
  const c = await card();
  assert.deepEqual([c.operator, c.mgmt], [null, '(주)시험관리']);
});

test('운영사 칸에 관리회사와 같은 이름(표기 달라도)을 넣었던 값은 운영사로 보지 않음 · 진짜 운영사는 그대로', async () => {
  await ctx.owner.ok('POST', '/api/sales/work', { kind: 'facility', id: FID, operator: '시험관리 주식회사' });
  assert.equal((await card()).operator, null, '(주)·주식회사·띄어쓰기 달라도 같은 회사');
  await ctx.owner.ok('POST', '/api/sales/work', { kind: 'facility', id: FID, operator: '다짐운영(주)' });
  const c = await card();
  assert.deepEqual([c.operator, c.mgmt], ['다짐운영(주)', '(주)시험관리']);
});
