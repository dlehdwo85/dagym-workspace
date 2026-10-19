// 로컬 10/19: 운영실에서 옮긴 콘텐츠가 전부 '시안 없음' → 운영실 자산(게시물 assetIds·표지·일일 항목 산출물 files)을 워크인 저장소로 복사해
// 콘텐츠 버전 media 에 표지 먼저 연결 · 이미 옮긴 콘텐츠에도 이어 붙임 · 두 번 해도 한 번만(가짜 Blob 서버 = 구조 시험)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const PORT = 3224;
let srv, ctx, sql, blob, hits = 0;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8ffbf1e0005fe02fea7d6a4c80000000049454e44ae426082', 'hex');
const B = `http://localhost:${PORT}`;
before(async () => {
  blob = http.createServer((req, res) => { hits++; if (req.url.includes('gone')) { res.statusCode = 404; return res.end(); } res.setHeader('content-type', req.url.endsWith('.mp4') ? 'video/mp4' : 'image/png'); res.end(PNG); }).listen(PORT);
  await resetDb();
  srv = await startServer({ OPS_BLOB_TEST: '1', OPS_EXPORT_URL: B, OPS_EXPORT_TOKEN: 'x' });
  sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); blob?.close(); await sql?.end(); });

test('자산 복사·표지 먼저·이어 붙이기·멱등·못 찾은 id 안내', async () => {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const [{ tenant }] = await sql`select tenant from users where id = ${ctx.ownerId}`;
  const put = (key, idx, item) => sql`insert into ops_import_items (tenant, key, idx, item) values (${tenant}, ${key}, ${idx}, ${sql.json(item)})`;
  await put('mkt:posts:v1', 0, { id: 'p1', brand: 'dg', title: '가을 행사', status: 'pending', channels: ['INSTAGRAM', 'FACEBOOK'], assetIds: ['a1', 'a2', 'zz'], coverAssetId: 'a2', results: [{ channel: 'INSTAGRAM', permalink: 'https://www.instagram.com/p/X/' }] });
  await put('mkt:library:v1', 0, { id: 'a1', url: `${B}/blob/a1.png`, name: '본문 사진.png', type: 'image/png' });
  await put('mkt:media:v1', 0, { items: [{ id: 'a2', blobUrl: `${B}/blob/a2.png`, name: '표지.png' }] });
  await put('mkt:daily:decisions:v1', 0, { 'd20261020-hl-reels': { status: 'pending', version: 1, history: [] } });
  await put('mkt:media-outputs:v1', 0, { 'd20261020-hl-reels': { files: [{ url: `${B}/blob/r1.mp4`, name: '릴스.mp4', type: 'video/mp4' }, { url: `${B}/blob/r1-cover.png`, name: '릴스 표지.png', role: 'cover' }, { url: `${B}/gone/x.png` }] } });
  // 먼저 자산 없이 옮긴 상태(운영 87건과 같음): 미리보기 → 옮기기
  const pv = await ctx.owner.ok('POST', '/api/marketing/imported/convert', { mode: 'preview' });
  assert.deepEqual([pv.assets.contents, pv.assets.missingCount, pv.assets.missing], [3, 1, ['zz']], '게시물 2채널 + 일일 1, 주소 없는 zz');
  const ap = await ctx.owner.ok('POST', '/api/marketing/imported/convert', { mode: 'apply' });
  assert.equal(ap.made, 3);
  assert.deepEqual([ap.assets.linked, ap.assets.copied, ap.assets.failed], [3, 4, 1], '채널 2건은 같은 파일 재사용, 404 는 실패로 남김');
  const media = async (title, ch) => (await sql`select v.media_ids, (select array_agg(f.file_name order by array_position(v.media_ids, f.id)) from library_files f where f.id = any(v.media_ids)) names
    from mkt_contents c join mkt_versions v on v.content_id = c.id where c.title = ${title} and c.channel = ${ch}`)[0];
  assert.deepEqual((await media('가을 행사', 'instagram')).names, ['표지.png', '본문 사진.png'], '표지 먼저');
  assert.deepEqual((await media('가을 행사', 'facebook')).media_ids, (await media('가을 행사', 'instagram')).media_ids);
  assert.deepEqual((await media('10/20 하이링크 릴스', 'instagram')).names, ['릴스 표지.png', '릴스.mp4']);
  // 화면: 승인 대기 카드에 시안 수
  const list = await ctx.owner.ok('GET', '/api/marketing/contents?from=2026-01-01&to=2026-12-31');
  assert.ok(list.contents.filter((c) => c.title === '가을 행사').every((c) => c.media_ids.length === 2));
  // 다시 옮기기: 복사·연결 0(멱등), 사람이 바꾼 media 는 그대로
  const h0 = hits;
  const again = await ctx.owner.ok('POST', '/api/marketing/imported/convert', { mode: 'apply' });
  assert.deepEqual([again.made, again.assets.linked, again.assets.copied], [0, 0, 0]);
  assert.equal(hits - h0, 1, '실패했던 1건만 다시 시도');
  const [ig] = await sql`select c.id from mkt_contents c where c.title = '가을 행사' and c.channel = 'instagram'`;
  const keep = (await media('가을 행사', 'instagram')).media_ids.slice(0, 1);
  await sql`update mkt_versions set media_ids = ${keep} where content_id = ${ig.id}`;
  const [own] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status) values (${tenant}, 'marketing', '', '직접', '직접.png', 'image/png', 1, ${ctx.ownerId}, 'ready') returning id`;
  await sql`update mkt_versions set media_ids = ${[own.id]} where content_id = ${ig.id}`;
  await ctx.owner.ok('POST', '/api/marketing/imported/convert', { mode: 'apply' });
  assert.deepEqual((await media('가을 행사', 'instagram')).media_ids, [own.id], '사람이 바꾼 시안은 덮어쓰지 않음');
  assert.equal((await sql`select count(*)::int n from library_files where ext_ref like 'ops-%'`)[0].n, 4, '파일은 한 번만 복사');
});
