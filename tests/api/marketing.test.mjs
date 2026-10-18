// V41 4-2 마케팅 핵심: 승인은 버전 단위(옛 버전 승인 409·시안 없는 승인 400·수정 요청/보류는 이유 필수), 게시 확인은 승인된 최신 버전만, 전화 문의 → 영업 업무, 공간 권한 404
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, img, fake;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  const lf = await ctx.owner.ok('POST', '/api/library', { fileName: '가을 행사 시안.png', mimeType: 'image/png', size: 4, folder: '마케팅' });
  await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: Buffer.from('abcd') });
  await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`);
  img = lf.id;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

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
    const pub = await st.ok('GET', `/api/marketing/contents/${id}`);
    assert.equal(pub.content.status, 'published');
    assert.deepEqual(pub.publishJobs.map((j) => [j.provider, j.status, j.version, j.permalink]), [['manual', 'done', 3, 'https://instagram.com/p/x']], '⑤-1 수동 게시도 게시 기록');
    assert.equal((await st.req('POST', `/api/marketing/contents/${id}/publish`, { url: 'https://instagram.com/p/y' })).status, 409, '게시 확인은 한 번');
    // 블로그 채널 + 네이버 블로그 주소 = 도우미 게시 기록
    const blog = await ctx.owner.ok('POST', '/api/marketing/contents', { title: '블로그 글', channel: 'blog', body: '첫 문단\n\n둘째 문단', mediaIds: [] }); // 블로그는 사진 없이도 승인
    await ctx.owner.ok('POST', `/api/marketing/contents/${blog.id}/decide`, { version: 1, decision: 'approve' });
    assert.equal((await ctx.owner.ok('POST', `/api/marketing/contents/${blog.id}/publish`, { url: 'https://blog.naver.com/dagym/223' })).provider, 'naver_blog');
    assert.equal((await sql`select count(*)::int n from mkt_publish_jobs where content_id = ${blog.id} and provider = 'naver_blog' and status = 'done'`)[0].n, 1);
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

  test('AI 캡션 초안: 초안 3개·해시태그(# 빼고)·사용량 기록, 미배정 404', async () => {
    await ctl({ anthropicReset: true, anthropicQueue: [{ content: [{ type: 'text', text: JSON.stringify({ captions: ['가을 행사 첫 번째', '두 번째', '세 번째', '네 번째'], hashtags: ['#가을행사', '헬스 장', '#가을행사'] }) }], stop_reason: 'end_turn' }] });
    const r = await ctx.staffA.client.ok('POST', '/api/marketing/assist', { channel: 'instagram', topic: '10월 가을 행사 안내' });
    assert.equal(r.captions.length, 3); assert.deepEqual(r.hashtags, ['가을행사', '헬스장']);
    const st = await fetch(`${FAKE}/__state`).then((x) => x.json());
    assert.match(st.anthropic.at(-1).body.messages[0].content, /가을 행사 안내/);
    assert.equal((await sql`select count(*)::int n from ai_usage where purpose = 'marketing_caption' and user_id = ${ctx.staffA.id}`)[0].n, 1);
    assert.equal((await ctx.staffB.client.req('POST', '/api/marketing/assist', { channel: 'instagram', topic: '가을' })).status, 404);
    assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/assist', { channel: 'instagram', topic: '' })).status, 400);
  });
});
