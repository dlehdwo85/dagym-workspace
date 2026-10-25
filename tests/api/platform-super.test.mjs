// #565(대표 10/24 저녁 1) 플랫폼 운영 = 슈퍼관리자만: 운영 설정 SUPER_ADMIN_EMAILS 에 적힌 계정(+ platform_admin)만 · 다른 platform_admin 은 404
// · '오늘 볼 것' 숫자(신규 가입·결제 실패·밀린 결제·답 안 한 문의·수집 실패·AI 비용, 시험 회사 제외)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => {
  await resetDb(); srv = await startServer({ SUPER_ADMIN_EMAILS: ' CEO@dagym.test , someone@example.test' }); sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id in (${ctx.ownerId}, ${ctx.staffA.id})`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('설정에 적힌 슈퍼관리자만 플랫폼 운영 — 다른 platform_admin 계정은 있는 줄도 모르게 404', async () => {
  assert.equal((await ctx.owner.req('GET', '/api/platform')).status, 200, '설정에 있는 계정(대소문자·공백 무시)');
  for (const path of ['/api/platform', '/api/platform/today', '/api/platform/tenants', '/api/platform/pay-test']) {
    assert.equal((await ctx.staffA.client.req('GET', path)).status, 404, `platform_admin 이어도 설정에 없으면 ${path} 404`);
  }
  await sql`update users set platform_admin = false where id = ${ctx.ownerId}`;
  assert.equal((await ctx.owner.req('GET', '/api/platform')).status, 404, '설정에 있어도 platform_admin 이 아니면 404');
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
});

test("'오늘 볼 것' 숫자 — 시험 회사는 빼고 센다", async () => {
  const base = await ctx.owner.ok('GET', '/api/platform/today');
  for (const k of ['signups', 'payFailed', 'pastDue', 'openTickets', 'collectorFailed', 'aiKrw']) assert.equal(typeof base[k], 'number', k);
  await sql`insert into tenants (id, name, kind) values ('t565', '새 회사', 'company')`;
  await sql`insert into tenants (id, name, kind, is_test) values ('t565test', '시험 회사', 'company', true)`;
  await sql`insert into payments (tenant, kind, moid, amount, status) values ('t565', 'subscription', 'M565a', 1000, 'failed'), ('t565test', 'subscription', 'M565b', 1000, 'failed')`;
  await sql`insert into sales_collector_runs (slug, status) values ('g2b_bid', 'failed'), ('g2b_bid', 'failed'), ('kapt', 'success')`;
  await ctx.staffB.client.ok('POST', '/api/support', { category: 'question', subject: '문의 565', body: '내용' });
  const t = await ctx.owner.ok('GET', '/api/platform/today');
  assert.equal(t.signups, base.signups + 1, '시험 회사는 신규 가입에서 뺌');
  assert.equal(t.payFailed, base.payFailed + 1, '시험 회사 결제 실패는 뺌');
  assert.equal(t.collectorFailed, base.collectorFailed + 1, '수집기 종류 수(같은 수집기 2번 실패 = 1)');
  assert.equal(t.openTickets, base.openTickets + 1);
});
