// 204차 #461 ⑦ 일괄 작업(설계 docs/handoff/SALES_LEADS_REVAMP_2026-10-23.md 5절): POST /api/sales/leads/bulk — 담당·단계(사유·다시 볼 날)·다음 연락일을 여러 건에.
// 한 건씩 updateLead 와 같은 규칙(담당만 고침 · 담당 변경은 관리자 · 보류·실패 사유 필수) · 못 바꾼 건은 이름·이유와 함께 · 나머지는 진행 · 영업 공간 밖은 404
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const row = async (id) => (await sql`select status, owner_id, next_contact_date::text as next, next_action, revisit_date::text as revisit from sales_leads where id = ${id}`)[0];

before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffB.id, spaces: ['sales'] });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('일괄: 다음 연락일(내 담당만) · 담당 변경은 관리자 · 보류는 사유 필수 + 다시 볼 날 · 못 바꾼 건은 이름·이유 · 검사(100건·빈 값·영업 공간 밖)', async () => {
  const mk = async (name, ownerId) => (await ctx.owner.ok('POST', '/api/sales/leads', { name, status: '1차연락완료', force: true, ...(ownerId ? { ownerId } : {}) })).id;
  const L1 = await mk('일괄 A1', ctx.staffA.id), L2 = await mk('일괄 A2', ctx.staffA.id), L3 = await mk('일괄 B1', ctx.staffB.id), L4 = await mk('일괄 관리자 등록', null);
  const d7 = addDays(today, 7);
  // 직원: 내 담당만 바뀌고 남의 담당은 이유와 함께
  const r1 = await ctx.staffA.client.ok('POST', '/api/sales/leads/bulk', { ids: [L1, L2, L3], patch: { nextContactDate: d7, nextAction: '견적 다시 보내기' } });
  assert.equal(r1.ok, 2); assert.equal(r1.failed.length, 1);
  assert.deepEqual([r1.failed[0].id, r1.failed[0].name], [L3, '일괄 B1']); assert.match(r1.failed[0].message, /담당 리드만/);
  assert.deepEqual([(await row(L1)).next, (await row(L1)).next_action, (await row(L2)).next, (await row(L3)).next], [d7, '견적 다시 보내기', d7, null]);
  assert.equal((await sql`select count(*)::int n from tasks where lead_id = ${L1} and deleted_at is null and status <> 'done' and due_date = ${d7}::date`)[0].n, 1, '영업 업무 마감도 맞춤(한 건 고칠 때와 같음)');
  // 담당 변경은 관리자만
  const r2 = await ctx.staffA.client.ok('POST', '/api/sales/leads/bulk', { ids: [L1, L2], patch: { ownerId: ctx.staffB.id } });
  assert.equal(r2.ok, 0); assert.ok(r2.failed.every((f) => /관리자/.test(f.message)));
  const r3 = await ctx.owner.ok('POST', '/api/sales/leads/bulk', { ids: [L1, L4], patch: { ownerId: ctx.staffB.id } });
  assert.deepEqual([r3.ok, r3.failed.length, (await row(L1)).owner_id, (await row(L4)).owner_id], [2, 0, ctx.staffB.id, ctx.staffB.id]);
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'sales.lead_owner' and target_id = any(${[L1, L4]})`)[0].n, 2, '담당 변경 기록');
  // 보류: 사유 없으면 모두 못 바꿈 → 사유 + 다시 볼 날
  const r4 = await ctx.owner.ok('POST', '/api/sales/leads/bulk', { ids: [L2, L3], patch: { status: '보류' } });
  assert.equal(r4.ok, 0); assert.ok(r4.failed.every((f) => /사유가 필요합니다/.test(f.message)));
  const rv = addDays(today, 90);
  const r5 = await ctx.owner.ok('POST', '/api/sales/leads/bulk', { ids: [L2, L3, L3], patch: { status: '보류', reason: '시기 안 맞음', revisitDate: rv } });
  assert.deepEqual([r5.ok, r5.failed.length], [2, 0], '같은 id 는 한 번만');
  assert.deepEqual([(await row(L2)).status, (await row(L2)).revisit, (await row(L3)).status], ['보류', rv, '보류']);
  assert.equal((await sql`select reason from sales_status_log where lead_id = ${L3} order by changed_at desc limit 1`)[0].reason, '시기 안 맞음');
  // 검사
  const many = Array.from({ length: 101 }, () => L1);
  assert.equal((await ctx.owner.post('/api/sales/leads/bulk', { ids: many, patch: { nextContactDate: d7 } })).status, 400, '100건까지');
  assert.equal((await ctx.owner.post('/api/sales/leads/bulk', { ids: [L1], patch: {} })).status, 400, '바꿀 칸이 없음');
  assert.equal((await ctx.owner.post('/api/sales/leads/bulk', { ids: ['x'], patch: { nextContactDate: d7 } })).status, 400);
  const ghost = '00000000-0000-4000-8000-000000000000';
  const r6 = await ctx.owner.ok('POST', '/api/sales/leads/bulk', { ids: [ghost], patch: { nextContactDate: d7 } });
  assert.deepEqual([r6.ok, r6.failed[0].name], [0, null], '없는 거래처(다른 회사 포함)는 이름 없이 실패');
  assert.equal((await ctx.managerA.client.post('/api/sales/leads/bulk', { ids: [L1], patch: { nextContactDate: d7 } })).status, 404, '영업 공간 밖');
});
