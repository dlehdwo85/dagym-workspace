// 대표 10/21 12:20 피드 일관성 신호: 브랜드별 최근 9장 게시 이미지 톤(밝기·채도·색온도)을 숫자로만 비교(sharp, AI 비용 0) → 튀는 장·일관성 점수 → 운영 검토 '운영 신호' 카드([열기] 링크) + 운영실 3×3 블록.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
const P = {};
const png = (r, g, b) => sharp({ create: { width: 24, height: 24, channels: 3, background: { r, g, b } } }).png().toBuffer();
async function up(name, buf) {
  const init = await ctx.owner.ok('POST', '/api/library', { fileName: name, mimeType: 'image/png', size: buf.length, folder: '시안', tags: [] });
  await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: buf });
  await ctx.owner.ok('POST', `/api/library/${init.id}/complete`);
  return init.id;
}
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '톤 브랜드' })).id;
  // 따뜻하고 밝은 톤 8장(조금씩 다름) + 어둡고 파란 1장(튀는 장)
  const tones = [[225, 190, 150], [230, 195, 155], [220, 185, 145], [228, 192, 150], [222, 188, 148], [232, 198, 158], [226, 191, 152], [224, 189, 149]];
  let k = 0;
  for (const [r, g, b] of tones) {
    const img = await up(`warm${k}.png`, await png(r, g, b));
    const c = await ctx.owner.ok('POST', '/api/marketing/contents', { title: `따뜻한 글 ${k}`, channel: 'instagram', brandId: P.brand, body: '캡션', mediaIds: [img] });
    await sql`update mkt_contents set status = 'published', published_at = now() - ${`${k + 2} hours`}::interval, published_url = ${`https://instagram.com/p/w${k}`} where id = ${c.id}`;
    k++;
  }
  const odd = await up('odd.png', await png(20, 30, 120));
  P.odd = (await ctx.owner.ok('POST', '/api/marketing/contents', { title: '튀는 글', channel: 'instagram', brandId: P.brand, body: '캡션', mediaIds: [odd] })).id;
  await sql`update mkt_contents set status = 'published', published_at = now() - interval '1 hour' where id = ${P.odd}`;
  // 게시 전(승인 대기) 글은 비교에 안 들어감
  await ctx.owner.ok('POST', '/api/marketing/contents', { title: '아직 안 올린 글', channel: 'instagram', brandId: P.brand, body: '캡션', mediaIds: [await up('pending.png', await png(0, 0, 0))] });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('운영실 피드 일관성: 브랜드 최근 9장 톤 통계(파일별 캐시) → 튀는 장 표시·일관성 점수, 운영 검토 신호 카드([열기] 링크)', async () => {
  const v = await ctx.owner.ok('GET', '/api/marketing/ops');
  assert.equal(v.feed.analyzable, true, 'sharp 사용 가능');
  const b = v.feed.brands.find((x) => x.brandId === P.brand);
  assert.ok(b, JSON.stringify(v.feed));
  assert.equal(b.n, 9, '게시된 9장만(승인 대기 제외)');
  assert.ok(b.score !== null && b.score < 85, `튀는 장 1장 → 점수 깎임(로컬 21:10 식: 튀는 장 뺀 평균 거리 + 튀는 장 비율): ${b.score}`);
  const outs = b.items.filter((it) => it.outlier);
  assert.deepEqual(outs.map((o) => o.title), ['튀는 글']);
  assert.ok(outs[0].stats.brightness < 60 && b.mean.brightness > 150, '어두운 장 vs 밝은 평균');
  assert.match(b.note, /튀는 장 1/);
  assert.equal((await sql`select count(*)::int n from library_files where image_stats is not null`)[0].n, 9, '파일별 통계 캐시');
  // 운영 검토 → 신호 + 카드
  const r = await ctx.owner.ok('POST', '/api/marketing/ops/review', {});
  const sg = r.signals.find((s) => s.key === `feed_tone:${P.brand}`);
  assert.ok(sg, JSON.stringify(r.signals)); assert.equal(sg.level, 'warn'); assert.match(sg.title, /톤 브랜드/); assert.match(sg.detail, /튀는 글/); assert.match(sg.action, /톤/);
  const [card] = await sql`select title, body from mkt_proposals where tenant = 'default' and kind = 'alert' and body->>'signal' = ${`feed_tone:${P.brand}`}`;
  assert.ok(card, '운영 신호 카드'); assert.equal(card.body.link, '/s/marketing/ops#feed');
  assert.equal(v.feed.brands.every((x) => x.items.every((it) => it.id !== P.odd || it.outlier)), true);
});

test('튀는 장을 내리면(취소) 톤이 고르고 신호 없음 · 다시 검토해도 같은 카드 중복 없음', async () => {
  await sql`update mkt_contents set status = 'canceled' where id = ${P.odd}`;
  const v = await ctx.owner.ok('GET', '/api/marketing/ops');
  const b = v.feed.brands.find((x) => x.brandId === P.brand);
  assert.equal(b.n, 8); assert.ok(b.score >= 85, `고른 톤: ${b.score}`); assert.equal(b.items.filter((it) => it.outlier).length, 0); assert.match(b.note, /고릅니다/);
  const r = await ctx.owner.ok('POST', '/api/marketing/ops/review', {});
  assert.ok(!r.signals.some((s) => s.key.startsWith('feed_tone:')), JSON.stringify(r.signals));
  assert.equal((await sql`select count(*)::int n from mkt_proposals where kind = 'alert' and body->>'signal' like 'feed_tone:%'`)[0].n, 1);
});
