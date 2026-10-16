// V36 3: 관리 화면 ↔ 메뉴 권한 — 관리 화면 표(adminPages)의 메뉴 키가 모두 대표의 메뉴 권한 표에 있음, 회사 정보·디자인은 자기 메뉴 권한
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('V36 3 관리 메뉴 권한', () => {
  test('관리 화면 표의 메뉴 키가 모두 메뉴 권한 표에 자동으로 나옴(새 관리 화면 = 표에 한 줄)', async () => {
    const src = readFileSync(new URL('../../src/lib/adminPages.ts', import.meta.url), 'utf8');
    const keys = [...new Set([...src.matchAll(/menu: '([a-z_]+)'/g)].map((m) => m[1]))];
    assert.ok(keys.length >= 7 && keys.includes('company'));
    const mx = await ctx.owner.ok('GET', '/api/admin/menu-perms');
    const menus = mx.menus.map((m) => m.key);
    for (const k of keys) assert.ok(menus.includes(k), `메뉴 권한 표에 ${k}`);
    assert.equal(mx.matrix.company.admin, 'edit'); assert.equal(mx.matrix.company.staff, 'none');
  });
  test('회사 정보·디자인: 직원 기본 404 → 대표가 그 사람만 조회로 켜면 조회 200·저장 403 → 끄면 다시 404', async () => {
    assert.equal((await ctx.staffA.client.get('/api/org/company-profiles')).status, 404);
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'company', userId: ctx.staffA.id, level: 'view' });
    await ctx.staffA.client.ok('GET', '/api/org/company-profiles');
    assert.equal((await ctx.staffA.client.req('PUT', '/api/org/company-profiles', { key: 'dagym', name: '바꾸기 시도' })).status, 403);
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'company', userId: ctx.staffA.id, level: null });
    assert.equal((await ctx.staffA.client.get('/api/org/company-profiles')).status, 404);
    await ctx.owner.ok('PUT', '/api/org/company-profiles', { key: 'dagym', name: '시험상호', isDefault: true });
  });
});
