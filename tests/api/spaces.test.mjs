// V41 단계 1 공간 틀: 업무 공간은 늘, 영업·마케팅은 관리자가 켜야 보임. 관리자 = 켠 공간 전부, 직원 = 배정된 공간만, 아니면 주소를 직접 쳐도 404
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('V41 공간', () => {
  test('켜기/끄기·배정·404', async () => {
    assert.deepEqual((await ctx.owner.ok('GET', '/api/spaces')).spaces, ['work'], '처음엔 업무만');
    assert.equal((await ctx.owner.get('/s/sales')).status, 404, '안 켠 공간은 대표도 404');
    assert.equal((await ctx.staffA.client.req('PUT', '/api/admin/spaces', { space: 'sales', on: true })).status, 403, '직원은 못 켬');
    await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
    assert.deepEqual((await ctx.owner.ok('GET', '/api/spaces')).spaces, ['work', 'sales'], '관리자는 켠 공간 바로');
    assert.equal((await ctx.owner.get('/s/sales')).status, 200);
    assert.equal((await ctx.owner.get('/s/marketing')).status, 404, '마케팅은 아직 꺼짐');
    // 직원: 배정 전 404 · 메뉴(공간 목록)에 없음 → 배정하면 보임 → 빼면 다시 404
    assert.deepEqual((await ctx.staffA.client.ok('GET', '/api/spaces')).spaces, ['work']);
    assert.equal((await ctx.staffA.client.get('/s/sales')).status, 404);
    await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
    assert.deepEqual((await ctx.staffA.client.ok('GET', '/api/spaces')).spaces, ['work', 'sales']);
    assert.equal((await ctx.staffA.client.get('/s/sales')).status, 200);
    assert.equal((await ctx.staffB.client.get('/s/sales')).status, 404, '배정 안 된 다른 직원');
    const set = await ctx.owner.ok('GET', '/api/admin/spaces');
    assert.deepEqual(set.users.find((u) => u.id === ctx.staffA.id).spaces, ['work', 'sales']);
    assert.equal((await ctx.owner.req('PUT', '/api/admin/spaces/members', { userId: ctx.ownerId, spaces: [] })).status, 400, '관리자는 배정 대상 아님');
    // 회사가 영업 공간을 끄면 배정된 직원도 404
    await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: false });
    assert.equal((await ctx.staffA.client.get('/s/sales')).status, 404);
    assert.equal((await ctx.owner.get('/s/work')).status, 404, '업무 공간은 지금 주소 그대로(/s/work 없음)');
  });
});
