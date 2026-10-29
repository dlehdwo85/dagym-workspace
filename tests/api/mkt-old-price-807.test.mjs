// 269차 #807(대표 10/29 — 결정 #466 '5명 무료' 폐지 → 14일 무료 체험): migration 226 = 워크인 브랜드 키트·규칙 주제의 옛 요금 문구를 '14일 무료 체험'으로(다른 브랜드는 그대로)
// · GET /api/marketing/quality/old-price = 남은 곳(키트 칸·규칙·안 올린 글) 목록(관리자)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] }); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('워크인 키트·규칙·안 올린 글의 옛 요금 문구 → 남은 곳 목록 → migration 226 → 키트·규칙은 14일 무료 체험(JSON 칸도 그대로 읽힘) · 다짐은 그대로', async () => {
  const workin = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '워크인' })).id;
  const dagym = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다짐' })).id;
  await sql`update mkt_brands set intro = '업무마다 AI 비서 · 5명까지 무료', facts = ${sql.json({ prices: '5명 무료, 6명부터 유료', phone: '1588-0000' })},
    topic_pool = ${['팀 5인까지 무료로 시작하기', '전자결재 쉽게']}, examples = ${sql.json([{ title: '예시', body: '평생 무료로 쓰세요' }])} where id = ${workin}`;
  await sql`update mkt_brands set intro = '5명까지 무료 체험 수업' where id = ${dagym}`;
  const [{ tenant }] = await sql`select tenant from mkt_brands where id = ${workin}`;
  const [rule] = await sql`insert into mkt_rules (tenant, brand_id, channel, kind, weekdays, topic_hint) values (${tenant}, ${workin}, 'instagram', 'feed', ${[2, 5]}, '5명까지 무료 강조') returning id`;
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, status) values (${tenant}, ${workin}, '워크인 시작하기', 'instagram', 'pending') returning id`;
  await sql`insert into mkt_versions (content_id, version, body) values (${c.id}, 1, '지금 5명까지 무료로 시작하세요')`;
  assert.equal((await ctx.staffA.client.req('GET', '/api/marketing/quality/old-price')).status, 403, '관리자만');
  const r1 = await ctx.owner.ok('GET', '/api/marketing/quality/old-price');
  assert.deepEqual(r1.brands, ['워크인'], '다짐은 안 봄');
  assert.deepEqual(r1.kit.map((x) => x.field).sort(), ['사실 카드', '소개', '예시 글', '주제 풀'].sort());
  assert.deepEqual([r1.rules.map((x) => x.id), r1.posts.map((x) => x.id), r1.total], [[rule.id], [c.id], 6]);
  // migration 226 다시 돌리기(시험 DB 는 빈 채로 이미 한 번 돎)
  await sql.unsafe(readFileSync('db/migrations/226_workin_old_price.sql', 'utf8'));
  const [w] = await sql`select intro, facts, topic_pool, examples from mkt_brands where id = ${workin}`;
  assert.equal(w.intro, '업무마다 AI 비서 · 14일 무료 체험');
  assert.deepEqual([w.facts.prices, w.facts.phone], ['14일 무료 체험, 6명부터 유료', '1588-0000']);
  assert.deepEqual(w.topic_pool, ['팀 14일 무료 체험으로 시작하기', '전자결재 쉽게'], "'무료로' → '체험으로'");
  assert.equal(w.examples[0].body, '14일 무료 체험으로 쓰세요');
  assert.equal((await sql`select intro from mkt_brands where id = ${dagym}`)[0].intro, '5명까지 무료 체험 수업', '다른 브랜드는 그대로');
  assert.equal((await sql`select topic_hint from mkt_rules where id = ${rule.id}`)[0].topic_hint, '14일 무료 체험 강조');
  const r2 = await ctx.owner.ok('GET', '/api/marketing/quality/old-price');
  assert.deepEqual([r2.kit.length, r2.rules.length, r2.posts.length], [0, 0, 1], '안 올린 글은 그대로(올리기 전 검사가 막음) — 목록에 남음');
});
