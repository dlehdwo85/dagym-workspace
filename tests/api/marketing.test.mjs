// V41 4-2 마케팅 핵심: 승인은 버전 단위(옛 버전 승인 409·시안 없는 승인 400·수정 요청/보류는 이유 필수), 게시 확인은 승인된 최신 버전만, 전화 문의 → 영업 업무, 공간 권한 404
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql, img;
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  const lf = await ctx.owner.ok('POST', '/api/library', { fileName: '가을 행사 시안.png', mimeType: 'image/png', size: 4, folder: '마케팅' });
  await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: Buffer.from('abcd') });
  await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`);
  img = lf.id;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('V41 4-2 마케팅', () => {
  test('공간 꺼짐이면 404, 켜고 배정한 사람만', async () => {
    assert.equal((await ctx.owner.req('GET', '/api/marketing/overview')).status, 404);
    await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
    assert.equal((await ctx.owner.req('GET', '/api/marketing/overview')).status, 200);
    assert.equal((await ctx.staffA.client.req('GET', '/api/marketing/contents')).status, 404, '배정 전 직원');
    assert.equal((await ctx.owner.get('/s/marketing/approvals')).status, 200);
    assert.equal((await ctx.owner.get('/s/sales/approvals')).status, 404);
    await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  });

  test('버전 승인 규칙·게시 확인', async () => {
    const st = ctx.staffA.client;
    const at = new Date(Date.now() + 3 * 864e5).toISOString();
    const { id } = await st.ok('POST', '/api/marketing/contents', { title: '가을 행사', channel: 'instagram', scheduledAt: at, body: '캡션 1', mediaIds: [] });
    const n = await sql`select count(*)::int as n from notifications where user_id = ${ctx.ownerId} and type = 'review_requested'`;
    assert.ok(n[0].n >= 1, '관리자에게 승인 요청 알림');
    assert.equal((await st.req('POST', `/api/marketing/contents/${id}/decide`, { version: 1, decision: 'approve' })).status, 403, '직원은 승인 못 함');
    assert.equal((await ctx.owner.req('POST', `/api/marketing/contents/${id}/decide`, { version: 1, decision: 'approve' })).status, 400, '시안 없는 버전은 승인 불가');
    assert.equal((await ctx.owner.req('POST', `/api/marketing/contents/${id}/decide`, { version: 1, decision: 'changes' })).status, 400, '수정 요청은 이유 필수');
    await ctx.owner.ok('POST', `/api/marketing/contents/${id}/decide`, { version: 1, decision: 'changes', comment: '사진 넣어 주세요' });
    assert.equal((await st.ok('GET', `/api/marketing/contents/${id}`)).content.status, 'changes');
    await st.ok('POST', `/api/marketing/contents/${id}/versions`, { body: '캡션 2', mediaIds: [img], note: '사진 추가' });
    assert.equal((await ctx.owner.req('POST', `/api/marketing/contents/${id}/decide`, { version: 1, decision: 'approve' })).status, 409, '옛 버전 승인은 409');
    assert.equal((await st.req('POST', `/api/marketing/contents/${id}/publish`, { url: 'https://instagram.com/p/x' })).status, 409, '승인 전 게시 확인 불가');
    await ctx.owner.ok('POST', `/api/marketing/contents/${id}/decide`, { version: 2, decision: 'approve' });
    let d = await st.ok('GET', `/api/marketing/contents/${id}`);
    assert.equal(d.content.status, 'approved'); assert.equal(d.content.approved_version, 2);
    assert.equal(d.media[0].id, img);
    // 승인 뒤 새 버전 → 다시 승인 대기, 게시 확인 불가
    await st.ok('POST', `/api/marketing/contents/${id}/versions`, { body: '캡션 3', mediaIds: [img] });
    d = await st.ok('GET', `/api/marketing/contents/${id}`);
    assert.equal(d.content.status, 'pending');
    assert.equal((await st.req('POST', `/api/marketing/contents/${id}/publish`, { url: 'https://instagram.com/p/x' })).status, 409);
    await ctx.owner.ok('POST', `/api/marketing/contents/${id}/decide`, { version: 3, decision: 'approve' });
    await st.ok('POST', `/api/marketing/contents/${id}/publish`, { url: 'https://instagram.com/p/x' });
    assert.equal((await st.ok('GET', `/api/marketing/contents/${id}`)).content.status, 'published');
    const appr = await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals');
    assert.ok(!appr.contents.some((c) => c.id === id), '게시된 건 승인 대기에서 빠짐');
    const day = at.slice(0, 7);
    const cal = await ctx.owner.ok('GET', `/api/marketing/contents?from=${day}-01&to=${day}-31`);
    assert.ok(cal.contents.some((c) => c.id === id), '캘린더에 보임');
  });

  test('전화 문의 → 영업 업무', async () => {
    const { id } = await ctx.staffA.client.ok('POST', '/api/marketing/calls', { phone: '010-1234-5678', source: '가을 행사 광고' });
    const r = await ctx.staffA.client.ok('POST', `/api/marketing/calls/${id}/convert`, {});
    assert.ok(r.taskId);
    const [t] = await sql`select title from tasks where id = ${r.taskId}`;
    assert.match(t.title, /전화 문의/);
    const calls = await ctx.owner.ok('GET', '/api/marketing/calls');
    assert.equal(calls.calls.find((c) => c.id === id).status, 'lead');
    assert.equal((await ctx.staffA.client.ok('POST', `/api/marketing/calls/${id}/convert`, {})).taskId, r.taskId, '두 번 눌러도 업무 하나');
    assert.equal((await ctx.staffB.client.req('GET', '/api/marketing/calls')).status, 404, '배정 안 된 직원');
  });
});
