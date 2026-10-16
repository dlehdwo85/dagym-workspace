// 대표(10/17): 같은 업무에 댓글이 여러 개 달려도 안 읽은 댓글 알림이 있으면 새 알림을 보내지 않고(그 알림만 최신 댓글로),
// 읽은 뒤에 달린 댓글부터 다시 알림. 멘션은 따로 늘 알림.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });
const mine = (taskId) => sql`select id, title, body, read_at from notifications where user_id = ${ctx.staffA.id} and type = 'comment' and entity_id = ${taskId} order by created_at`;

describe('댓글 알림 묶기', () => {
  test('안 읽은 댓글 알림이 있으면 새 알림 없음 → 읽으면 다음 댓글부터 다시', async () => {
    const id = (await ctx.owner.ok('POST', '/api/tasks', { title: '댓글 묶기 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
    const c1 = await ctx.owner.ok('POST', `/api/tasks/${id}/comments`, { body: '첫 댓글' });
    assert.deepEqual(c1.notified, [ctx.staffA.id]);
    const c2 = await ctx.owner.ok('POST', `/api/tasks/${id}/comments`, { body: '두 번째' });
    const c3 = await ctx.owner.ok('POST', `/api/tasks/${id}/comments`, { body: '세 번째 댓글' });
    assert.deepEqual([c2.notified, c3.notified], [[], []], '안 읽은 알림이 있으면 새로 안 보냄');
    let ns = await mine(id);
    assert.equal(ns.length, 1, '알림 1개'); assert.match(ns[0].body, /세 번째 댓글/); assert.match(ns[0].title, /여러 개/);
    await sql`update notifications set read_at = now() where id = ${ns[0].id}`; // 확인함
    const c4 = await ctx.owner.ok('POST', `/api/tasks/${id}/comments`, { body: '읽은 뒤 댓글' });
    assert.deepEqual(c4.notified, [ctx.staffA.id], '읽은 뒤엔 다시 알림');
    ns = await mine(id);
    assert.equal(ns.length, 2);
    // 멘션은 안 읽은 댓글 알림이 있어도 보냄
    const m = await ctx.owner.ok('POST', `/api/tasks/${id}/comments`, { body: `@[이직원](${ctx.staffA.id}) 확인 부탁` });
    assert.deepEqual(m.mentions, [ctx.staffA.id]);
    assert.ok((await sql`select 1 from notifications where user_id = ${ctx.staffA.id} and type = 'mention' and entity_id = ${id}`).length, '멘션 알림');
  });
});
