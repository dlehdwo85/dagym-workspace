// 207차 #461 회사별 단계 이름(설계 docs/handoff/SALES_LEADS_REVAMP_2026-10-23.md 2-3 '단계 = 칩(회사 설정 단계명·색)'): PUT /api/sales/options { stages } — 관리자만.
// 이름(20자, 공백 무시 겹침 금지)·색(#RRGGBB)·숨김(중간 진행 단계만, 전부는 안 됨) · null = 기본 이름 · 저장 값(리드 단계)은 그대로, 상세 타임라인 단계 기록은 회사 이름으로
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
const put = (body) => ctx.owner.req('PUT', '/api/sales/options', body);

before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('단계 이름·색·숨김 저장 → 영업 용어(terms.stages) · 검사(겹침·숨길 수 없는 단계·전부 숨김·없는 단계·길이·색·관리자만) · null = 기본', async () => {
  const d = (await ctx.owner.ok('GET', '/api/sales/options')).terms.stages;
  assert.deepEqual([Object.keys(d).length, d['계약완료'], d['제안서작성중']], [12, { label: '계약완료', color: null, hidden: false }, { label: '제안서작성중', color: null, hidden: false }], '기본 = 원래 이름');
  const r = await ctx.owner.ok('PUT', '/api/sales/options', { stages: { 현장방문완료: { label: ' 데모 완료 ', color: '#0EA5E9' }, 제안서작성중: { label: '제안서작성중', hidden: true }, 계약완료: { label: '수주' } } });
  assert.deepEqual([r.terms.stages['현장방문완료'], r.terms.stages['제안서작성중'], r.terms.stages['계약완료']],
    [{ label: '데모 완료', color: '#0ea5e9', hidden: false }, { label: '제안서작성중', color: null, hidden: true }, { label: '수주', color: null, hidden: false }]);
  assert.deepEqual((await sql`select sales_stages from tenants where id = 'default'`)[0].sales_stages, { 현장방문완료: { label: '데모 완료', color: '#0ea5e9' }, 제안서작성중: { hidden: true }, 계약완료: { label: '수주' } }, '기본과 다른 것만 저장');
  assert.equal((await ctx.staffA.client.ok('GET', '/api/sales/options')).terms.stages['계약완료'].label, '수주', '직원 화면도 같은 이름');
  // 검사 — 한 번이라도 틀리면 아무것도 안 바뀜
  const bad = async (stages, re) => { const x = await put({ stages }); assert.equal(x.status, 400, JSON.stringify(stages)); if (re) assert.match(x.body.error.message, re); };
  await bad({ 미팅예정: { label: '수주' }, 계약완료: { label: '수주' } }, /겹칩니다/);
  await bad({ 미팅예정: { label: '1차 연락완료' } }, /겹칩니다/); // 공백 무시
  await bad({ 계약완료: { hidden: true } }, /숨길 수 없습니다/);
  await bad({ 신규리드: { hidden: true } }, /숨길 수 없습니다/);
  await bad(Object.fromEntries(['1차연락완료', '미팅예정', '현장방문완료', '제안서작성중', '제안서발송완료', '견적협의', '계약검토'].map((k) => [k, { hidden: true }])), /모두 숨길 수는 없습니다/);
  await bad({ 없는단계: { label: 'x' } }, /없는 단계/);
  await bad({ 미팅예정: { label: '가'.repeat(21) } });
  await bad({ 미팅예정: { color: 'red' } });
  assert.equal((await sql`select sales_stages->'계약완료'->>'label' as l from tenants where id = 'default'`)[0].l, '수주', '틀린 요청은 그대로');
  assert.equal((await ctx.staffA.client.req('PUT', '/api/sales/options', { stages: null })).status, 403);
  // 되돌리기
  const z = await ctx.owner.ok('PUT', '/api/sales/options', { stages: null });
  assert.deepEqual([z.terms.stages['계약완료'].label, z.terms.stages['제안서작성중'].hidden], ['계약완료', false]);
  assert.equal((await sql`select sales_stages from tenants where id = 'default'`)[0].sales_stages, null);
});

test('저장 값은 그대로 · 리드 상세 타임라인의 단계 기록은 회사 이름으로', async () => {
  await ctx.owner.ok('PUT', '/api/sales/options', { stages: { 미팅예정: { label: '첫 미팅' } } });
  const id = (await ctx.owner.ok('POST', '/api/sales/leads', { name: '단계 이름 시험', force: true })).id;
  await ctx.owner.ok('PATCH', `/api/sales/leads/${id}`, { status: '미팅예정' });
  assert.equal((await sql`select status from sales_leads where id = ${id}`)[0].status, '미팅예정', '저장 값은 키 그대로');
  const d = await ctx.owner.ok('GET', `/api/sales/src?view=lead&id=${id}`);
  assert.equal(d.lead.status, '미팅예정');
  assert.ok(d.timeline.some((x) => x.kind === 'status' && x.title === '신규리드 → 첫 미팅'), JSON.stringify(d.timeline.filter((x) => x.kind === 'status')));
  assert.equal(d.terms.stages['미팅예정'].label, '첫 미팅');
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=leads')).leads.find((l) => l.id === id).status, '미팅예정');
  await ctx.owner.ok('PUT', '/api/sales/options', { stages: null });
});
