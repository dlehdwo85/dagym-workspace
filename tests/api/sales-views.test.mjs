// V41 단계 2 영업 공간 화면: 옮긴 원본(sales_src_rows)으로 영업 현황·리드(상세 = 상담·시점·입찰)·파이프라인·제안/계약·입찰(관련·진행 중·회사 분류)·허브(신규단지·시설·협력사)·지역별, 공간 밖 404·다른 회사 자료 안 보임
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const plus = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  const put = (scope, tbl, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values (${scope}, ${tbl}, ${String(row.id)}, ${sql.json(row)})`;
  await put('default', 'leads', { id: 'L1', name: '판교 피트니스', status: '상담', priority: 'high', region: '경기', next_contact_date: plus(2), owner_id: 'P1', updated_at: today });
  await put('default', 'leads', { id: 'L2', name: '강남 커뮤니티', status: '제안', region: '서울', next_contact_date: plus(-1), owner_id: 'P2' });
  await put('default', 'leads', { id: 'L3', name: '부산 수영장', status: '상담', region: '부산' });
  await put('other', 'leads', { id: 'X1', name: '다른 회사 리드', status: '상담' });
  await put('default', 'sales_activities', { id: 'A1', lead_id: 'L1', kind: '전화', memo: '견적 요청' });
  await put('default', 'opportunity_work', { id: 'W1', notice_id: '11', status: '검토 중', lead_id: 'L1' });
  await put('global', 'procurement_notices', { id: 11, title: '체육시설 위탁운영', agency: '성남시', related: true, posted_at: today, close_at: plus(5) });
  await put('global', 'procurement_notices', { id: 12, title: '관계없는 공고', related: false, posted_at: today });
  await put('default', 'procurement_notices__progress', { id: 11, classification: '적합' });
  await put('global', 'building_sales_pipeline', { id: 'B1', name: '판교 새단지', households: 1200, address: '경기 성남' });
  await put('global', 'operating_facility_prospects', { id: 'F1', name: '수원 아파트 커뮤니티', score: 88 });
  await put('default', 'operating_facility_prospects__progress', { id: 'F1', contact_status: '연락함' });
  await put('global', 'vendor_registrations', { id: 'V1', company: '좋은관리', rank: 3 });
  await sql`insert into sales_user_map (tenant, src_user_id, user_id, name, matched) values ('default', 'P1', ${ctx.ownerId}, '대표', true)`;
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('영업 공간 화면', async () => {
  assert.equal((await ctx.owner.req('GET', '/api/sales/src?view=summary')).status, 404, '영업 공간 꺼짐');
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const s = await ctx.owner.ok('GET', '/api/sales/src?view=summary');
  assert.equal(s.readOnly, true); assert.equal(s.imported, true);
  assert.deepEqual([s.kpi.leads, s.kpi.dueSoon, s.kpi.overdue, s.kpi.bidsWorking, s.kpi.relatedNotices, s.kpi.newNotices7d], [3, 2, 1, 1, 1, 1]);
  const leads = (await ctx.owner.ok('GET', '/api/sales/src?view=leads')).leads;
  assert.equal(leads.length, 3, '다른 회사 리드 안 보임');
  assert.equal(leads.find((l) => l.id === 'L1').owner, (await sql`select name from users where id = ${ctx.ownerId}`)[0].name, '담당자 = 연결된 워크인 사용자');
  assert.deepEqual((await ctx.owner.ok('GET', '/api/sales/src?view=leads&status=제안')).leads.map((l) => l.name), ['강남 커뮤니티']);
  const d = await ctx.owner.ok('GET', '/api/sales/src?view=lead&id=L1');
  assert.equal(d.activities[0].memo, '견적 요청'); assert.equal(d.work.length, 1);
  assert.equal((await ctx.owner.req('GET', '/api/sales/src?view=lead&id=X1')).status, 404, '다른 회사 리드 404');
  const p = await ctx.owner.ok('GET', '/api/sales/src?view=pipeline');
  assert.equal(p.columns.find((c) => c.status === '상담').items.length, 2);
  const b = await ctx.owner.ok('GET', '/api/sales/src?view=bids');
  assert.deepEqual(b.items.map((n) => [n.title, n.work, n.classification]), [['체육시설 위탁운영', '검토 중', '적합']]);
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=working')).items.length, 1);
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=buildings')).items[0].households, 1200);
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=facilities')).items[0].contact, '연락함');
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=vendors')).items[0].rank, 3);
  const r = await ctx.owner.ok('GET', '/api/sales/src?view=regions');
  assert.deepEqual(r.regions.map((x) => x.region).sort(), ['경기', '부산', '서울']);
  assert.equal((await ctx.staffA.client.req('GET', '/api/sales/src?view=leads')).status, 404, '공간 미배정 직원');
});
