// 대표 10/24 추가 ①: 마케팅 자동 제작 글(원고·약한 첫 줄 다시 쓰기·수정본·블로그) 모델 — 우리 회사(본사 조직)는 최상 모델(193),
// 고객사는 마케팅 요금제 '글 모델'(비우면 빠른 모델), 플랫폼 운영 회사별 지정이 먼저 · 원고 요청과 원가 기록이 그 모델 · 플랫폼 운영자만 바꿈 (가짜 Anthropic)
// 범위 추가(로컬 10/24): 만드는 일(캡션 초안 등)도 글 모델 · 정기 실행은 글 제작을 응답 뒤로(최상 모델 30~60초가 게시·알림을 밀지 않게) · 같은 회사 제작은 한 번에 하나
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb, tick, FAKE } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, sql, ctx, cust, custTenant;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn', usage: { input_tokens: 5000, output_tokens: 1500 } });
const form = (o) => ({ password: 'signup-pass-1234', agree: { terms: true, age14: true, privacy: true, ai: true, marketing: false }, ...o });

before(async () => {
  await resetDb(); fake = await startFakeGoogle(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', USD_KRW: '1400' }); sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  cust = new Client('cust-mkt-write');
  const r = await cust.ok('POST', '/api/auth/signup', form({ email: 'boss@mkt-write.test', name: '글모델대표', mode: 'team', company: '글모델회사' }));
  await cust.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  custTenant = (await cust.ok('GET', '/api/auth/me')).user.tenant;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('우리 회사 = 최상 모델 — 자동 제작 원고 요청·원가 기록이 그 모델, 글 1건 원가 최상 > 표준 > 빠른', async () => {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const v = await ctx.owner.ok('GET', '/api/marketing/auto');
  assert.deepEqual([v.writeModel.tier, v.writeModel.source, v.writeModel.label], ['deep', 'company', '최상 모델']);
  const c = v.writeModel.byTier;
  assert.ok(c.deep > c.default && c.default > c.fast && c.fast >= 1, JSON.stringify(c));
  assert.equal(v.writeModel.perDraftKrw, c.deep);
  const brand = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다짐' });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { leadDays: 3, remindHours: 72, quietStart: 0, quietEnd: 0 });
  await ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: brand.id, channel: 'instagram', kind: 'feed', weekdays: [0, 1, 2, 3, 4, 5, 6], postTime: '23:00', topicHint: '가을 이벤트' });
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '가을 이벤트', body: '가을 맞이 안내', brief: '현관 실사' })] });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const st = await (await fetch(FAKE + '/__state')).json();
  const drafts = st.anthropic.filter((x) => /를 씁니다\. JSON 만/.test(JSON.stringify(x.body.system ?? '')));
  assert.ok(drafts.length >= 1, '원고 요청');
  assert.ok(drafts.every((x) => x.body.model === v.writeModel.model), drafts.map((x) => x.body.model).join(','));
  assert.equal(drafts[0].body.max_tokens, 16000, '빠른 모델 설정(4000)이 아님');
  const [u] = await sql`select model from ai_usage where tenant = 'default' and purpose = 'marketing_produce' order by created_at desc limit 1`;
  assert.equal(u.model, v.writeModel.model, '원가 기록도 그 모델');
});

test('고객사: 마케팅 요금제 글 모델(비우면 빠른 모델) → 회사별 지정이 먼저 → 비우면 요금제 값 · 고객 설정 저장에 안 바뀜 · 플랫폼 운영자만', async () => {
  await cust.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await cust.ok('PUT', '/api/marketing/auto', { planCode: 'basic' });
  let v = await cust.ok('GET', '/api/marketing/auto');
  assert.deepEqual([v.writeModel.tier, v.writeModel.source], ['fast', 'base'], '요금제 글 모델이 비어 있으면 빠른 모델');
  // 플랫폼 운영 › 마케팅 요금제 표: 베이직 = 표준 모델
  const p = await ctx.owner.ok('PUT', '/api/platform/mkt-plans', { plan: { code: 'basic', writeTier: 'default' } });
  assert.equal(p.plans.find((x) => x.code === 'basic').writeTier, 'default');
  assert.ok(p.writeCost.default > p.writeCost.fast, JSON.stringify(p.writeCost));
  v = await cust.ok('GET', '/api/marketing/auto');
  assert.deepEqual([v.writeModel.tier, v.writeModel.source, v.writeModel.label], ['default', 'plan', '표준 모델']);
  // 회사별 지정(플랫폼 운영 › 회사 관리) = 최상 → 먼저, 비우면 요금제 값
  const w = await ctx.owner.ok('PUT', `/api/platform/tenants/${custTenant}/mkt-write`, { tier: 'deep' });
  assert.deepEqual([w.tier, w.source, w.company, w.plan.tier], ['deep', 'company', 'deep', 'default']);
  assert.equal((await ctx.owner.ok('GET', `/api/platform/tenants/${custTenant}/detail`)).mktWrite.tier, 'deep');
  await ctx.owner.ok('PUT', `/api/platform/tenants/${custTenant}/mkt-write`, { tier: null });
  v = await cust.ok('GET', '/api/marketing/auto');
  assert.deepEqual([v.writeModel.tier, v.writeModel.source], ['default', 'plan']);
  // 고객사 관리자가 자동 제작 설정을 저장해도 글 모델(운영사 값)은 그대로
  await ctx.owner.ok('PUT', `/api/platform/tenants/${custTenant}/mkt-write`, { tier: 'fast' });
  await cust.ok('PUT', '/api/marketing/auto', { leadDays: 2 });
  assert.equal((await sql`select write_tier from mkt_settings where tenant = ${custTenant}`)[0].write_tier, 'fast');
  // 권한: 고객사 대표·우리 회사 직원은 못 바꿈(404)
  assert.equal((await cust.req('PUT', `/api/platform/tenants/${custTenant}/mkt-write`, { tier: 'deep' })).status, 404);
  assert.equal((await ctx.staffA.client.req('PUT', '/api/platform/mkt-plans', { plan: { code: 'basic', writeTier: 'deep' } })).status, 404);
  assert.equal((await ctx.owner.req('PUT', '/api/platform/tenants/nope/mkt-write', { tier: 'deep' })).status, 404, '없는 회사');
  assert.equal((await ctx.owner.req('PUT', `/api/platform/tenants/${custTenant}/mkt-write`, { tier: 'huge' })).status, 400);
  assert.ok((await sql`select 1 from audit_logs where action = 'platform.mkt_write_tier'`).length, '감사 기록');
  await ctx.owner.ok('PUT', '/api/platform/mkt-plans', { plan: { code: 'basic', writeTier: null } });
});

test('만드는 일도 글 모델(캡션 초안) · 정기 실행은 응답 뒤에 만들고 기록 · 같은 회사 제작은 한 번에 하나', async () => {
  const v = await ctx.owner.ok('GET', '/api/marketing/auto');
  await ctl({ anthropicReset: true, anthropicQueue: [say({ captions: ['가을 안내 하나', '가을 안내 둘', '가을 안내 셋'], hashtags: ['#가을'] })] });
  await ctx.owner.ok('POST', '/api/marketing/assist', { channel: 'instagram', topic: '가을 이벤트 안내' });
  const st = await (await fetch(FAKE + '/__state')).json();
  assert.equal(st.anthropic.at(-1).body.model, v.writeModel.model, '캡션 초안 3개도 글 모델(우리 회사 최상)');
  // 다른 제작이 도는 중(잠금)이면 [지금 실행]은 그 글을 건너뜀 — 같은 글을 두 번 만들지 않게
  const [c] = await sql`select id from mkt_contents where tenant = 'default' and auto and produced_at is null and status = 'draft' order by scheduled_at limit 1`;
  assert.ok(c, '아직 안 만든 칸');
  await sql`update mkt_contents set produce_at = now() - interval '1 minute' where id = ${c.id}`;
  await sql`insert into job_locks (name, locked_until, holder) values ('mktProduce:default', now() + interval '1 minute', 'test')
    on conflict (name) do update set locked_until = excluded.locked_until, holder = excluded.holder`;
  const busy = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.deepEqual([busy.busy, busy.produced.length], [true, 0], JSON.stringify(busy));
  assert.equal((await sql`select produced_at from mkt_contents where id = ${c.id}`)[0].produced_at, null);
  await sql`delete from job_locks where name = 'mktProduce:default'`;
  // 정기 실행: 응답에는 '뒤에 만듦'만, 제작은 응답 뒤에 끝나고 job_runs(mktProduce)에 결과
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '가을 소식', body: '가을 맞이 안내', brief: '현관 실사' })] });
  const before = (await sql`select coalesce(max(id), 0)::int n from job_runs where job = 'mktProduce'`)[0].n;
  const t = await tick();
  const mine = t.detail.mktAuto.find((x) => x.tenant === 'default');
  assert.deepEqual([mine.producing, mine.produced.length], ['later', 0], JSON.stringify(mine));
  let jr;
  for (let i = 0; i < 100 && !jr; i++) { [jr] = await sql`select status, detail from job_runs where job = 'mktProduce' and id > ${before} order by id desc limit 1`; if (!jr) await new Promise((r) => setTimeout(r, 200)); }
  assert.ok(jr, '응답 뒤 제작 기록');
  assert.equal(jr.status, 'ok', JSON.stringify(jr.detail));
  assert.ok(jr.detail.produced.some((p) => p.id === c.id), JSON.stringify(jr.detail));
  assert.ok((await sql`select produced_at from mkt_contents where id = ${c.id}`)[0].produced_at, '만들어짐');
  assert.equal((await sql`select count(*)::int n from job_locks where name = 'mktProduce:default'`)[0].n, 0, '끝나면 잠금 풂');
  const drafts = (await (await fetch(FAKE + '/__state')).json()).anthropic.filter((x) => /를 씁니다\. JSON 만/.test(JSON.stringify(x.body.system ?? '')));
  assert.ok(drafts.length && drafts.every((x) => x.body.model === v.writeModel.model), '정기 실행 원고도 글 모델');
});
