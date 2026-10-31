// 275차 #809(대표 10/29 '상용화 했을 때 기준으로 시험'): 상용화 시험 보기 — 브랜드별 이번 달 글 작성 비용(원)·생성 크레딧(원 환산)·승인률·수정 요청 · 요금제 가격 대비 원가율. 우리 회사 관리자만
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('브랜드별 글 작성 비용·생성 크레딧(1크레딧 70원)·승인률·수정 요청 · 브랜드 모름 비용 · 요금제 59,000원 대비 원가율 · 관리자만 · 자동 제작 글 비용에 글 id', async () => {
  await sql`update mkt_plan_limits set price_krw = 59000 where code = 'pro'`;
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0 });
  assert.ok([403, 404].includes((await ctx.staffA.client.req('GET', '/api/marketing/auto/trial')).status), '관리자만');
  const A = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다짐' })).id;
  const B = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '바디랩' })).id;
  const content = async (brand) => (await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, status, current_version, created_by, produced_at)
    values ('default', ${brand}, '시험 글', 'instagram', 'feed', 'pending', 1, ${ctx.ownerId}, now()) returning id`)[0].id;
  const a1 = await content(A), a2 = await content(A), b1 = await content(B);
  const usage = (id, krw, purpose = 'marketing_produce') => sql`insert into ai_usage (tenant, user_id, provider, model, cost_usd, cost_krw, purpose, mkt_content_id) values ('default', ${ctx.ownerId}, 'anthropic', 'm', 0, ${krw}, ${purpose}, ${id})`;
  await usage(a1, 100); await usage(a2, 40); await usage(b1, 50); await usage(null, 30, 'marketing_brand');
  await usage(null, 999, 'assistant'); // 마케팅 아닌 AI 는 안 셈
  await sql`insert into mkt_credit_ledger (tenant, content_id, version, kind, credits, note) values ('default', ${a1}, 1, 'generate_image', 6.5, '시험'), ('default', ${a1}, 1, 'text', 0, '원고')`;
  const decide = (id, d) => sql`insert into mkt_decisions (content_id, version, decision, decided_by) values (${id}, 1, ${d}, ${ctx.ownerId})`;
  await decide(a1, 'approve'); await decide(a2, 'changes'); await decide(a2, 'approve'); await decide(b1, 'approve');
  const v = await ctx.owner.ok('GET', '/api/marketing/auto/trial');
  assert.deepEqual([v.plan.label, v.plan.price, v.perCreditKrw, v.bar], ['프로', 59000, 70, 0.7]);
  const row = (n) => v.brands.find((b) => b.name === n);
  assert.deepEqual([row('다짐').produced, row('다짐').textKrw, row('다짐').credits, row('다짐').creditKrw, row('다짐').costKrw, row('다짐').approved, row('다짐').decided, row('다짐').changes, row('다짐').approvalRate], [2, 140, 6.5, 455, 595, 2, 3, 1, 0.667]);
  assert.deepEqual([row('바디랩').textKrw, row('바디랩').costKrw, row('바디랩').approvalRate], [50, 50, 1]);
  assert.equal(v.otherTextKrw, 30, '브랜드 모름(키트 AI 등) · 마케팅 아닌 AI 는 안 셈');
  assert.deepEqual([v.total.produced, v.total.textKrw, v.total.creditKrw, v.total.costKrw, v.total.approvalRate, v.total.changes, v.total.ratio], [3, 220, 455, 675, 0.75, 1, 0.011]);
  // 자동 제작 원고의 글 작성 비용에 글 id(→ 브랜드)가 남음
  const r = await ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: A, channel: 'instagram', kind: 'feed', weekdays: [0, 1, 2, 3, 4, 5, 6], postTime: '12:00', topicHint: '아침 운동' });
  const [slot] = await sql`select id from mkt_contents where rule_id = ${r.id} order by scheduled_at limit 1`;
  await sql`update mkt_contents set produce_at = now() + interval '30 days' where rule_id = ${r.id} and id <> ${slot.id}`;
  await sql`update mkt_contents set produce_at = now() - interval '1 minute' where id = ${slot.id}`;
  const draft = say({ title: '아침 운동은 다짐에서', body: '아침 7시에 문을 엽니다.\n상담은 전화로 편하게 받습니다.', brief: '현장 실사' });
  await ctl({ anthropicReset: true, anthropicQueue: [draft, draft, draft] });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.ok((await sql`select 1 from ai_usage where mkt_content_id = ${slot.id} and purpose = 'marketing_produce'`).length, '글 작성 비용에 글 id');
  await sql`update mkt_rules set active = false where id = ${r.id}`;
});
