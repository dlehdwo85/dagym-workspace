// 대표 10/21 12:00 영업 재편 6) (#408): 업종 중립 문구·온보딩 업종 템플릿 — 영업 화면 용어는 회사 업종 템플릿(tenants.sales_template, null = industries 로 추정).
// 첫 회사(default)는 마이그레이션 시드로 'facility'(신규단지·시설·협력사). 코드 기본값은 '일반'(중립) — 우리 회사 용어를 다른 회사에 보여 주지 않는다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'building_sales_pipeline', 'B1', ${sql.json({ id: 'B1', name: '판교 새단지', households: 1200, region: '경기', status: '영업 전', first_seen_at: today })})`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('첫 회사 = 시설 템플릿(시드): 옵션·화면 meta·진행 현황표 이름이 신규단지·시설·협력사', async () => {
  const o = await ctx.owner.ok('GET', '/api/sales/options');
  assert.equal(o.template.code, 'facility'); assert.equal(o.template.auto, false);
  assert.deepEqual(o.templates.map((t) => t.code), ['facility', 'construction', 'it', 'general']);
  assert.deepEqual([o.terms.kind.building, o.terms.facilitiesTab, o.terms.unitName, o.terms.office], ['신규단지', '준공·입주 시설', '단지명', '관리사무소']);
  const home = await ctx.owner.ok('GET', '/api/sales/src?view=summary');
  assert.equal(home.terms.template, 'facility');
  assert.deepEqual(home.progress.map(([n]) => n), ['입찰', '신규단지', '준공·입주 시설', '협력사']);
});

test('템플릿 바꾸기(IT): 화면 용어·진행 현황·자동 업무 태그·리드 메모가 따라감, 직원 404/403, 없는 템플릿 400', async () => {
  assert.equal((await ctx.staffA.client.req('PUT', '/api/sales/options', { template: 'it' })).status, 404, '영업 공간 밖 직원은 404(숨김)');
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  assert.equal((await ctx.staffA.client.req('PUT', '/api/sales/options', { template: 'it' })).status, 403, '영업 공간 직원은 403(관리자만)');
  assert.equal((await ctx.owner.req('PUT', '/api/sales/options', { template: 'nope' })).status, 400);
  const o = await ctx.owner.ok('PUT', '/api/sales/options', { template: 'it' });
  assert.equal(o.template.label, 'IT·소프트웨어');
  const home = await ctx.owner.ok('GET', '/api/sales/src?view=summary');
  assert.deepEqual(home.progress.map(([n]) => n), ['입찰', '신규 프로젝트', '운영 중 고객', '파트너사']);
  assert.equal(home.terms.unitName, '프로젝트명');
  // 진행 기록 → 자동 업무 태그, 넘기기 → 리드 메모 '…에서 넘김' 도 템플릿 용어
  const w = await ctx.owner.ok('POST', '/api/sales/work', { kind: 'building', id: 'B1', status: '연락중' });
  const [task] = await sql`select tags from tasks where id = ${w.task.taskId}`;
  assert.ok(task.tags.includes('신규 프로젝트'), JSON.stringify(task.tags));
  const h = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'building', id: 'B1', assigneeIds: [ctx.ownerId] });
  const [lead] = await sql`select memo from sales_leads where id = ${h.leadId}`;
  assert.match(lead.memo, /^신규 프로젝트에서 넘김/);
});

test('null = 회사 업종으로 자동 추정(온보딩에서 업종만 골라도 용어가 맞춰짐): 건설 → construction, 모르면 일반', async () => {
  await sql`update tenants set industries = array['건설·인테리어'] where id = 'default'`; // 예전 industry 한 칸(시드 '운동·피트니스')보다 industries[] 가 우선
  let o = await ctx.owner.ok('PUT', '/api/sales/options', { template: null });
  assert.deepEqual([o.template.code, o.template.auto, o.terms.kind.building], ['construction', true, '신규 현장']);
  await sql`update tenants set industries = '{}', industry = null where id = 'default'`;
  o = await ctx.owner.ok('GET', '/api/sales/options');
  assert.deepEqual([o.template.code, o.terms.kind.building, o.terms.kind.facility], ['general', '신규 기회', '기존 거래처']);
  // 다른 회사(신규 가입)는 시드가 없으니 코드 기본 = 중립. 우리 회사 용어(단지·관리사무소)가 새 회사 화면에 나오면 안 된다
  assert.ok(!JSON.stringify(o.terms).includes('관리사무소') && !JSON.stringify(o.terms).includes('단지'), JSON.stringify(o.terms));
  await ctx.owner.ok('PUT', '/api/sales/options', { template: 'facility' });
});
