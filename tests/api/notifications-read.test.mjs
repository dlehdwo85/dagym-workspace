// V32 0 알림 읽음: 화면(링크)을 열면 그 화면 알림 자동 읽음, 남은 안 읽음 수를 바로 돌려줌, 안 읽은 알림이 목록 앞에
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('V32 0 알림 읽음', () => {
  test('링크로 읽음·남은 수·다른 사람 알림은 그대로·안 읽은 것이 먼저', async () => {
    const a = (await ctx.owner.ok('POST', '/api/tasks', { title: '알림 읽음 A', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
    const b = (await ctx.owner.ok('POST', '/api/tasks', { title: '알림 읽음 B', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
    const before = await ctx.staffA.client.ok('GET', '/api/notifications');
    assert.ok(before.unread >= 2);
    const r = await ctx.staffA.client.ok('POST', '/api/notifications/read', { link: `/tasks/${a}` });
    assert.equal(r.changed, 1); assert.equal(r.unread, before.unread - 1);
    assert.equal((await ctx.staffA.client.ok('POST', '/api/notifications/read', { link: `/tasks/${a}` })).changed, 0, '두 번째는 0');
    assert.equal((await ctx.staffA.client.ok('POST', '/api/notifications/read', { link: `/tasks/${a}x` })).changed, 0, '앞부분만 같은 다른 주소는 안 읽음');
    const list = await ctx.staffA.client.ok('GET', '/api/notifications');
    const firstRead = list.items.findIndex((n) => n.read_at);
    assert.ok(firstRead === -1 || list.items.slice(firstRead).every((n) => n.read_at), '안 읽은 것이 앞');
    assert.ok(list.items.some((n) => n.link === `/tasks/${b}` && !n.read_at));
    // 다른 사람이 같은 링크로 읽음 → 직원 알림은 그대로
    await ctx.managerA.client.ok('POST', '/api/notifications/read', { link: `/tasks/${b}` });
    assert.ok((await ctx.staffA.client.ok('GET', '/api/notifications')).items.some((n) => n.link === `/tasks/${b}` && !n.read_at));
    const all = await ctx.staffA.client.ok('POST', '/api/notifications/read', { all: true });
    assert.equal(all.unread, 0);
    assert.equal((await ctx.staffA.client.req('POST', '/api/notifications/read', { link: 'https://evil.test/x' })).status, 400);
  });
  // 대표 10/20 17:40 (#110) 건별 읽음·보관: ids 읽음 → 남은 수 바로 · archive = 읽음+보관(기본 목록·전체에서 빠지고 ?archived=1 에만) · unarchive · 남의 알림은 안 바뀜
  test('#110 ids 읽음 · 보관(archive) · 보관함 목록 · 되돌리기', async () => {
    const c = (await ctx.owner.ok('POST', '/api/tasks', { title: '알림 보관 C', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
    const d = (await ctx.owner.ok('POST', '/api/tasks', { title: '알림 보관 D', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
    const list = await ctx.staffA.client.ok('GET', '/api/notifications');
    const nc = list.items.find((n) => n.link === `/tasks/${c}`), nd = list.items.find((n) => n.link === `/tasks/${d}`);
    const r1 = await ctx.staffA.client.ok('POST', '/api/notifications/read', { ids: [nc.id] });
    assert.equal(r1.changed, 1); assert.equal(r1.unread, list.unread - 1);
    const r2 = await ctx.staffA.client.ok('POST', '/api/notifications/read', { ids: [nd.id], archive: true });
    assert.equal(r2.changed, 1); assert.equal(r2.unread, list.unread - 2, '보관은 읽음도 같이');
    const after = await ctx.staffA.client.ok('GET', '/api/notifications');
    assert.ok(after.items.some((n) => n.id === nc.id && n.read_at), '읽은 알림은 목록에 남음');
    assert.ok(!after.items.some((n) => n.id === nd.id), '보관한 알림은 기본 목록에서 빠짐');
    const arch = await ctx.staffA.client.ok('GET', '/api/notifications?archived=1');
    assert.ok(arch.items.some((n) => n.id === nd.id && n.archived_at && n.read_at), '보관함에만');
    assert.equal((await ctx.staffB.client.ok('POST', '/api/notifications/read', { ids: [nc.id, nd.id], archive: true })).changed, 0, '남의 알림은 안 바뀜');
    assert.equal((await ctx.staffA.client.ok('POST', '/api/notifications/read', { ids: [nd.id], unarchive: true })).changed, 1);
    assert.ok((await ctx.staffA.client.ok('GET', '/api/notifications')).items.some((n) => n.id === nd.id && !n.archived_at), '되돌리면 목록으로');
  });
});
