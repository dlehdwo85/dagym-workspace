// #566(대표 10/24 저녁 3) 결제 시험 회사 [지우기]: 플랫폼 운영자·시험 회사만 · 결제 기록 없으면 완전히 지움 · 있으면 숨기기(결제 기록 남음, 목록에서 빠짐)
// · 취소 안 된 결제·1시간 안에 연 결제창이 있으면 막음 · 진짜 회사는 지울 수 없음(404)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); await sql`update users set platform_admin = true where id = ${ctx.ownerId}`; });
after(async () => { srv?.proc.kill(); await sql?.end(); });
const pay = (tenant, status, ago = '2 hours') => sql`insert into payments (tenant, kind, moid, amount, status, created_at) values (${tenant}, 'subscription', ${'T' + Math.random().toString(36).slice(2)}, 3190, ${status}, now() - ${ago}::interval)`;

test('결제 기록 없는 시험 회사 = 완전히 지움 · 진짜 회사·직원은 못 지움', async () => {
  const p = ctx.owner;
  const t = await p.ok('POST', '/api/platform/pay-test', { name: '지울 시험 회사' });
  assert.equal((await ctx.staffA.client.req('DELETE', `/api/platform/pay-test/${t.id}`)).status, 404, '플랫폼 운영자만');
  assert.equal((await p.req('DELETE', '/api/platform/pay-test/default')).status, 404, '진짜 회사는 시험 회사가 아님');
  assert.equal((await p.ok('DELETE', `/api/platform/pay-test/${t.id}`)).mode, 'deleted');
  assert.equal((await sql`select count(*)::int n from tenants where id = ${t.id}`)[0].n, 0);
  assert.equal((await sql`select count(*)::int n from org_units where tenant = ${t.id}`)[0].n, 0);
  assert.ok((await p.ok('GET', '/api/platform/pay-test')).tenants.every((x) => x.id !== t.id));
  assert.ok((await sql`select 1 from audit_logs where action = 'platform.test_tenant_deleted'`).length, '감사 기록');
});

test('결제 기록 있으면 숨기기(기록 남음) · 취소 안 된 결제·방금 연 결제창은 막음', async () => {
  const p = ctx.owner;
  const t = await p.ok('POST', '/api/platform/pay-test', { name: '결제한 시험 회사' });
  await pay(t.id, 'paid');
  const r1 = await p.req('DELETE', `/api/platform/pay-test/${t.id}`);
  assert.equal(r1.status, 400); assert.match(JSON.stringify(r1.body), /시험 결제 취소/);
  await sql`update payments set status = 'canceled' where tenant = ${t.id}`;
  await pay(t.id, 'pending', '5 minutes');
  assert.equal((await p.req('DELETE', `/api/platform/pay-test/${t.id}`)).status, 400, '1시간 안에 연 결제창');
  await sql`update payments set created_at = now() - interval '2 hours' where tenant = ${t.id} and status = 'pending'`;
  assert.equal((await p.ok('DELETE', `/api/platform/pay-test/${t.id}`)).mode, 'hidden');
  const [row] = await sql`select status, deleted_at from tenants where id = ${t.id}`;
  assert.equal(row.status, 'deleted'); assert.ok(row.deleted_at);
  assert.equal((await sql`select count(*)::int n from payments where tenant = ${t.id}`)[0].n, 2, '결제 기록은 그대로');
  assert.ok((await p.ok('GET', '/api/platform/pay-test')).tenants.every((x) => x.id !== t.id), '시험 회사 목록에서 빠짐');
  const all = await p.ok('GET', '/api/platform/tenants');
  assert.ok((all.tenants ?? all.rows ?? []).every((x) => x.id !== t.id), '플랫폼 회사 목록에서도 빠짐');
  assert.equal((await p.req('DELETE', `/api/platform/pay-test/${t.id}`)).status, 404, '두 번은 못 지움');
});
