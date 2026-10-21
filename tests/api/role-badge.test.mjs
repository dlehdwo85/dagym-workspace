// 대표 10/20 15:05 (#101) 권한 배지: 회사 설정 영어(기본)/한글/끄기 — 바꾸기는 회사 정보 편집 권한, 잘못된 값 400, 감사, 사람 목록(dir)에 is_demo, 세션에 roleBadge
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('기본 영어 · 직원은 못 바꿈 · 대표가 한글/끄기 · 잘못된 값 400 · 감사', async () => {
  const v = await ctx.staffA.client.ok('GET', '/api/org/role-badge');
  assert.equal(v.mode, 'en'); assert.deepEqual(v.labels, { owner: 'CEO', admin: 'Admin', dept_lead: 'Lead', site_manager: 'Ops', staff: 'Member' });
  assert.ok([403, 404].includes((await ctx.staffA.client.req('PUT', '/api/org/role-badge', { mode: 'ko' })).status), '회사 정보 편집 권한 없음(메뉴 권한 밖은 404)');
  assert.equal((await ctx.owner.req('PUT', '/api/org/role-badge', { mode: 'jp' })).status, 400);
  assert.equal((await ctx.owner.ok('PUT', '/api/org/role-badge', { mode: 'ko' })).mode, 'ko');
  assert.equal((await ctx.staffA.client.ok('GET', '/api/org/role-badge')).mode, 'ko');
  assert.equal((await sql`select role_badge from tenants where id = 'default'`)[0].role_badge, 'ko');
  assert.equal((await ctx.owner.ok('PUT', '/api/org/role-badge', { mode: 'off' })).mode, 'off');
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'role_badge.set'`)[0].n, 2);
  await ctx.owner.ok('PUT', '/api/org/role-badge', { mode: 'en' });
});
