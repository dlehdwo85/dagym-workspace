// 운영실 기록 → 워크인 마케팅 변환(로컬 10/19 칸 구조): 게시물 → 콘텐츠(채널·캡션+해시태그·results 게시 주소·상태), 일일 항목 'dYYYYMMDD-브랜드-종류' + production → 콘텐츠·결정 기록,
// 요청 → 이전 요청 기록 · 미리보기는 쓰지 않음(상태 매핑표) · 적용 두 번이어도 한 번만 · 관리자만 · 알림 없음
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('미리보기·적용·멱등·화면 자리', async () => {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  const [{ tenant }] = await sql`select tenant from users where id = ${ctx.ownerId}`;
  const put = (key, idx, item) => sql`insert into ops_import_items (tenant, key, idx, item) values (${tenant}, ${key}, ${idx}, ${sql.json(item)})`;
  await put('mkt:posts:v1', 0, { id: 'p1', brand: '다짐', title: '가을 행사', status: 'published', category: 'event', channels: ['instagram', 'facebook'], instagramCaption: '가을 행사 안내', hashtags: ['다짐', '#헬스'],
    results: [{ channel: 'instagram', permalink: 'https://www.instagram.com/p/AAA/' }], createdAt: '2026-10-01T01:00:00Z', updatedAt: '2026-10-02T03:00:00Z', assetIds: ['a1'] });
  await put('mkt:posts:v1', 1, { id: 'p2', brand: '하이링크', title: '블로그 글', status: 'draft', channels: ['naver_blog'], createdAt: '2026-10-03T01:00:00Z', updatedAt: '2026-10-03T01:00:00Z' });
  await put('mkt:daily:decisions:v1', 0, {
    'd20261015-hl-feed': { at: '2026-10-15T02:00:00Z', by: 'owner', itemId: 'd20261015-hl-feed', status: 'approved', version: 2, history: [{ at: '2026-10-15T01:00:00Z', status: 'changes', note: '색 바꿔' }, { at: '2026-10-15T02:00:00Z', status: 'approved' }] },
    'd20261016-bl-blog': { at: '2026-10-16T02:00:00Z', by: 'owner', itemId: 'd20261016-bl-blog', status: 'published', version: 1, history: [], url: 'https://blog.naver.com/x/1' },
  });
  await put('mkt:production:v1', 0, { history: [{ at: '2026-10-15T03:00:00Z', itemId: 'd20261015-hl-feed', status: 'hold', version: 2, note: '잠시 보류' }], decisions: {} });
  await put('mkt:requests:v1', 0, { id: 'r1', key: 'k', text: '이번 주 릴스 2개 만들어 주세요', route: 'production', events: [], source: {}, status: 'delivered', claimedBy: 'w', createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-10T00:00:00Z', statusNote: '완료', result: { summary: '릴스 2개 전달' }, deliveredAt: '2026-10-11T00:00:00Z' });

  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/imported/convert', { mode: 'preview' })).status, 403, '직원은 못 함');
  const pv = await ctx.owner.ok('POST', '/api/marketing/imported/convert', { mode: 'preview' });
  assert.deepEqual([pv.posts, pv.daily, pv.requests, pv.newContents, pv.decisions, pv.withUrl], [2, 2, 1, 4, 3, 2]);
  assert.equal(pv.mapping["게시물 'published' → published"], 1);
  assert.equal(pv.mapping["일일 'approved' → approved"], 1);
  assert.deepEqual(pv.unknownBrands, ['BL']);
  assert.equal((await sql`select count(*)::int n from mkt_contents`)[0].n, 0, '미리보기는 쓰지 않음');

  const ap = await ctx.owner.ok('POST', '/api/marketing/imported/convert', { mode: 'apply' });
  assert.deepEqual([ap.made, ap.requestsMade], [4, 1]);
  const again = await ctx.owner.ok('POST', '/api/marketing/imported/convert', { mode: 'apply' });
  assert.deepEqual([again.made, again.requestsMade, again.existing], [0, 0, 4], '두 번 적용해도 한 번만');

  const rows = await sql`select c.title, c.channel, c.status, c.published_url, c.approved_version, c.scheduled_at, b.name as brand, v.body, v.note,
    (select string_agg(decision, ',' order by decided_at) from mkt_decisions d where d.content_id = c.id) as decs
    from mkt_contents c left join mkt_brands b on b.id = c.brand_id join mkt_versions v on v.content_id = c.id order by c.src_ref`;
  const p1 = rows.find((r) => r.title === '가을 행사');
  assert.deepEqual([p1.channel, p1.status, p1.published_url, p1.brand, p1.approved_version], ['instagram', 'published', 'https://www.instagram.com/p/AAA/', '다짐', 1]);
  assert.equal(p1.body, '가을 행사 안내\n\n#다짐 #헬스');
  assert.match(p1.note, /운영실 이관/); assert.match(p1.note, /채널: instagram, facebook/);
  assert.deepEqual([rows.find((r) => r.title === '블로그 글').channel, rows.find((r) => r.title === '블로그 글').status], ['blog', 'draft']);
  const feed = rows.find((r) => r.title === '10/15 하이링크 피드');
  assert.deepEqual([feed.channel, feed.status, feed.decs], ['instagram', 'approved', 'changes,approve,hold'], 'history + production 기록을 itemId 로 묶음');
  const blog = rows.find((r) => r.title === '10/16 BL 블로그');
  assert.deepEqual([blog.channel, blog.status, blog.published_url], ['blog', 'published', 'https://blog.naver.com/x/1']);
  assert.ok(feed.scheduled_at, '캘린더 자리(일일 날짜)');
  assert.equal((await sql`select count(*)::int n from notifications`)[0].n >= 0, true);
  assert.equal((await sql`select count(*)::int n from notifications where type = 'review_requested'`)[0].n, 0, '변환은 알림을 보내지 않음');
  // 화면 자리: 콘텐츠 캘린더(10월)·이전 요청 기록(직원도 봄)
  const cal = await ctx.staffA.client.ok('GET', '/api/marketing/contents?from=2026-10-01&to=2026-10-31');
  assert.equal(cal.contents.filter((c) => ['가을 행사', '10/15 하이링크 피드'].includes(c.title)).length, 2);
  const rq = await ctx.staffA.client.ok('GET', '/api/marketing/ops-requests');
  assert.deepEqual([rq.requests[0].text, rq.requests[0].status, rq.requests[0].result_summary], ['이번 주 릴스 2개 만들어 주세요', 'delivered', '릴스 2개 전달']);
  assert.equal((await ctx.staffB.client.req('GET', '/api/marketing/ops-requests')).status, 404, '공간 미배정 404');
});
