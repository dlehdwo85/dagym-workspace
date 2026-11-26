// 상업화 마감 F1(새 회사는 결재선이 없어 직원의 첫 결재가 막힘): 관리자가 결재 설정 빈 화면·결재 올리는 창에서 [대표 1단계 결재선 바로 만들기] —
// 예시 'one' = 대표 한 단계(다른 회사는 그 회사의 대표 이름). 가입 때 자동으로 만들지는 않음(결재선 고르기가 '가장 먼저 만든 결재선'으로 돌아가 나중 결재선을 가로채지 않게)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx;
before(async () => { await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });
const agree = { terms: true, age14: true, privacy: true, ai: true };

test('새 회사: 결재선 없음 → 관리자 [대표 1단계] 한 번 → 직원 결재선 미리 보기에 대표 한 단계 · 직원은 못 만듦', async () => {
  const c = new Client('ceo@f1-1127.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@f1-1127.test', password: 'signup-pass-1234', name: '대표', mode: 'team', company: '결재상사', industry: 'IT·소프트웨어', agree });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const [t] = await sql`select tenant from users where email = 'ceo@f1-1127.test'`;
  await sql`update tenants set signup_status = 'approved' where id = ${t.tenant}`;
  const unit = (await c.ok('GET', '/api/admin/org-units')).units[0].id;
  const inv = await c.ok('POST', '/api/admin/users', { email: 'st@f1-1127.test', name: '직원', role: 'staff', orgUnitIds: [unit] });
  const st = new Client('st-f1'); await st.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'signup-pass-1234', ai: true });

  assert.equal((await st.ok('GET', '/api/approvals/line-preview?kind=general')).lineId ?? null, null, '처음엔 결재선 없음');
  assert.equal((await st.req('POST', '/api/approval-lines/templates', { preset: 'one' })).status >= 400, true, '직원은 못 만듦');
  const made = await c.ok('POST', '/api/approval-lines/templates', { preset: 'one' });
  assert.ok(made.id);
  const lines = (await c.ok('GET', '/api/approval-lines')).lines;
  assert.equal(lines.length, 1); assert.match(lines[0].name, /^1단계\(/); assert.equal(lines[0].steps.length, 1); assert.equal(lines[0].steps[0].role, 'owner');
  const pv = await st.ok('GET', '/api/approvals/line-preview?kind=general');
  assert.ok(pv.lineId, JSON.stringify(pv)); assert.equal(pv.steps?.length ?? pv.chain?.length ?? 1, 1);
  // 기본 회사 예시 이름은 그대로
  assert.equal((await ctx.owner.ok('POST', '/api/approval-lines/templates', { preset: 'one' })).id != null, true);
  assert.ok((await ctx.owner.ok('GET', '/api/approval-lines')).lines.some((l) => l.name === '1단계(대표)'));
});

test('쓴 적 없는 결재선 지우기(운영 자동 확인 원상복구) · 결재에 쓰인 결재선은 409 · 직원 못 지움 · 다른 회사 404', async () => {
  const made = await ctx.owner.ok('POST', '/api/approval-lines/templates', { preset: 'one' });
  assert.equal((await ctx.staffA.client.req('DELETE', `/api/approval-lines/${made.id}`)).status >= 400, true, '직원은 못 지움');
  const other = new Client('ceo@f1-1127.test'); await other.ok('POST', '/api/auth/login', { email: 'ceo@f1-1127.test', password: 'signup-pass-1234' });
  assert.equal((await other.req('DELETE', `/api/approval-lines/${made.id}`)).status, 404, '다른 회사 결재선은 없는 것처럼');
  await ctx.owner.ok('DELETE', `/api/approval-lines/${made.id}`);
  assert.equal((await sql`select count(*)::int n from approval_lines where id = ${made.id}`)[0].n, 0);
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'approval_line.delete'`)[0].n, 1);
  const used = await ctx.owner.ok('POST', '/api/approval-lines/templates', { preset: 'one' });
  const task = await ctx.owner.ok('POST', '/api/tasks', { title: '결재선 지우기 시험', orgUnitId: ctx.siteA });
  await sql`update tasks set approval_line_id = ${used.id} where id = ${task.id}`;
  assert.equal((await ctx.owner.req('DELETE', `/api/approval-lines/${used.id}`)).status, 409, '업무에 쓰인 결재선은 끄기만');
  assert.equal((await sql`select count(*)::int n from approval_lines where id = ${used.id}`)[0].n, 1);
});
