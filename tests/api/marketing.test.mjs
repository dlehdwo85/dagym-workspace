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

  test('로컬 10/19 마케팅 홈: 채널 상태(연결 안 함·끊김·연결됨)·이번 주 게시(지연)·성과 7일·운영실 버튼 없음', async () => {
    const [{ tenant }] = await sql`select tenant from users where id = ${ctx.ownerId}`;
    let ov = await ctx.owner.ok('GET', '/api/marketing/overview');
    const keys = ov.channels.map((c) => c.key);
    assert.deepEqual(keys, ['instagram', 'facebook', 'threads', 'youtube', 'naver_blog', 'kakao_channel', 'ads_naver', 'ads_google']);
    assert.ok(ov.channels.filter((c) => c.kind !== 'helper').every((c) => c.state === 'none'), '처음엔 연결 0개');
    assert.equal(ov.channels.find((c) => c.key === 'ads_naver').connect, 'naver_form');
    assert.ok(ov.channels.every((c) => c.signup.startsWith('https://') && c.ask), '계정 만들기 주소·질문');
    assert.equal(ov.channels.find((c) => c.key === 'naver_blog').state, 'helper', '블로그는 게시 도우미');
    assert.equal(ov.canEdit, true);
    const [acc] = await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, status, last_error) values (${tenant}, 'naver', '1234', '다짐 검색광고', 'error', '키 만료') returning id`;
    await sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, impressions, clicks, cost_krw) values (${acc.id}, (now() at time zone 'Asia/Seoul')::date - 1, 'c1', '캠페인', 100, 12, 36000)`;
    await sql`insert into mkt_calls (tenant, phone, created_by) values (${tenant}, '010-1111-2222', ${ctx.ownerId}), (${tenant}, '010-1111-3333', ${ctx.ownerId})`;
    const [late] = await sql`insert into mkt_contents (tenant, title, channel, scheduled_at, status, current_version, created_by) values (${tenant}, '지난 게시', 'instagram', greatest(now() - interval '1 hour', date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'), 'approved', 1, ${ctx.ownerId}) returning id`; // 자정 직후에도 '오늘' 안의 지난 시각
    ov = await ctx.owner.ok('GET', '/api/marketing/overview');
    const nv = ov.channels.find((c) => c.key === 'ads_naver');
    assert.deepEqual([nv.state, nv.account, nv.error], ['broken', '다짐 검색광고', '키 만료']);
    assert.deepEqual([ov.perf.cost, ov.perf.clicks, ov.perf.calls], [36000, 12, 2]);
    const w = ov.week.find((x) => x.id === late.id);
    assert.ok(w && w.late && !w.failed, '지난 시각인데 게시 안 됨 = 지연');
    const st = await ctx.staffA.client.ok('GET', '/api/marketing/overview');
    assert.equal(st.canEdit, false, '직원은 [연결]·승인 버튼 없음');
    const html = String((await ctx.owner.get('/s/marketing')).body);
    assert.ok(!html.includes('marketing-open') && !html.includes('마케팅 운영실 열기'), '운영실로 가는 버튼 없음');
    await sql`delete from mkt_contents where id = ${late.id}`; await sql`delete from mkt_ad_accounts where id = ${acc.id}`; await sql`delete from mkt_calls where tenant = ${tenant}`;
  });

  test('버전 승인 규칙·게시 확인', async () => {
    const st = ctx.staffA.client;
    const at = new Date(Date.now() + 3 * 864e5).toISOString();
    const { id } = await st.ok('POST', '/api/marketing/contents', { title: '가을 행사', channel: 'instagram', scheduledAt: at, body: '캡션 1', mediaIds: [] });
    // 대표 10/20 11:40 ②: '페이스북에도'·'스레드에도' = 같은 승인 1건(cross_channels, 자기 채널은 뺌)
    const cross = await st.ok('POST', '/api/marketing/contents', { title: '함께 올릴 글', channel: 'instagram', body: '캡션', mediaIds: [], crossChannels: ['facebook', 'threads', 'instagram'] });
    assert.deepEqual((await sql`select cross_channels from mkt_contents where id = ${cross.id}`)[0].cross_channels, ['facebook', 'threads']);
    await sql`update mkt_contents set status = 'canceled' where id = ${cross.id}`;
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
    // 대표 10/20 18:45 ③: 블로그는 표지+본문 사진(2장 이상) 없으면 승인 요청(대기)도 승인도 안 됨 → '수정 요청' 상태 + 사유, 사진 2장 붙이면 승인 대기
    const blog = await ctx.owner.ok('POST', '/api/marketing/contents', { title: '블로그 글', channel: 'blog', body: '첫 문단\n\n둘째 문단', mediaIds: [] });
    assert.equal(blog.needsPhotos, true);
    const bl0 = await ctx.owner.ok('GET', `/api/marketing/contents/${blog.id}`);
    assert.equal(bl0.content.status, 'changes'); assert.match(bl0.content.quality.issues[0], /표지 1장 \+ 본문 사진/);
    assert.equal((await ctx.owner.req('POST', `/api/marketing/contents/${blog.id}/decide`, { version: 1, decision: 'approve' })).status, 400, '블로그 사진 없이 승인 불가');
    assert.equal((await ctx.owner.ok('POST', `/api/marketing/contents/${blog.id}/versions`, { body: '첫 문단\n\n둘째 문단', mediaIds: [img] })).needsPhotos, true, '1장도 부족');
    await ctx.owner.ok('POST', `/api/marketing/contents/${blog.id}/versions`, { body: '첫 문단\n\n둘째 문단', mediaIds: [img, img] });
    const bl1 = await ctx.owner.ok('GET', `/api/marketing/contents/${blog.id}`);
    assert.equal(bl1.content.status, 'pending'); assert.equal(bl1.content.quality, null, '사진 붙이면 안내 사라짐');
    const lst = await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals');
    assert.ok(lst.contents.find((c) => c.id === blog.id && 'production' in c && 'produce_at' in c), '카드용 제작 상태 칸');
    await ctx.owner.ok('POST', `/api/marketing/contents/${blog.id}/decide`, { version: 3, decision: 'approve' });
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
