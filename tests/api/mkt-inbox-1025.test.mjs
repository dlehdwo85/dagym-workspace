// 400차 #1025(노트북 11/13 "승인함: 알림 카드(피드 톤 불일치 같은 것)가 4번 반복되고, 그 뒤에야 시안이 나옵니다"):
// 같은 신호로 쌓인 대기 알림 카드는 승인함에 가장 최근 것 한 장만(same = 묶인 수) · 건수도 한 번만 · 결정하면 묶인 카드도 함께 닫힘(실행은 한 번)
// 다른 신호·다른 종류 카드·다른 회사 카드는 그대로
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx; const ids = {};
before(async () => {
  await resetDb(); srv = await startServer({}); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await sql`insert into tenants (id, name) values ('t_in1025', '남의 회사') on conflict do nothing`;
  const ins = async (key, tenant, kind, title, signal, daysAgo) => { ids[key] = (await sql`insert into mkt_proposals (tenant, kind, title, summary, body, source, month, created_at)
    values (${tenant}, ${kind}, ${title}, '요약', ${sql.json({ ...(signal ? { signal, level: 'warn' } : {}), items: [{ title: '제안 조치', detail: '다시 만들기' }], rationale: '근거' })}, 'template', '2026-11', now() - ${`${daysAgo} days`}::interval) returning id`)[0].id; };
  await ins('x1', 'default', 'alert', '피드 톤 불일치 — 하이링크 최근 9장 (일관성 40점)', 'feed_tone:hilink', 9);
  await ins('x2', 'default', 'alert', '피드 톤 불일치 — 하이링크 최근 9장 (일관성 41점)', 'feed_tone:hilink', 6);
  await ins('x3', 'default', 'alert', '피드 톤 불일치 — 하이링크 최근 9장 (일관성 42점)', 'feed_tone:hilink', 3);
  await ins('x4', 'default', 'alert', '피드 톤 불일치 — 하이링크 최근 9장 (일관성 43점)', 'feed_tone:hilink', 0);
  await ins('y1', 'default', 'alert', '피드 톤 불일치 — 다짐 최근 9장 (일관성 30점)', 'feed_tone:dagym', 1);
  await ins('c1', 'default', 'alert', '클릭당 비용 급등 — 900원', 'cpc_spike', 2);
  await ins('p1', 'default', 'analysis', '11월 분석', null, 4);
  await ins('o1', 't_in1025', 'alert', '피드 톤 불일치 — 남의 브랜드', 'feed_tone:hilink', 1);
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('승인함: 같은 신호 카드는 최근 것 한 장(same = 묶인 수) · 건수 한 번만 · 다른 신호·다른 종류는 그대로', async () => {
  const v = await ctx.owner.ok('GET', '/api/marketing/inbox');
  assert.equal(v.counts.proposals, 4, '하이링크 톤(4장 → 1) · 다짐 톤 · 클릭당 비용 · 분석');
  assert.deepEqual(v.proposals.map((p) => p.id).sort(), [ids.x4, ids.y1, ids.c1, ids.p1].sort());
  const x = v.proposals.find((p) => p.id === ids.x4);
  assert.equal(x.same, 3, '묶인 옛 카드 3장'); assert.match(x.title, /43점/);
  assert.ok(!v.proposals.find((p) => p.id === ids.y1).same && !v.proposals.find((p) => p.id === ids.p1).same);
});

test('결정하면 같은 신호로 묶인 대기 카드도 함께 닫힘(업무는 한 번만) · 다른 신호·다른 회사 카드는 그대로', async () => {
  const before = (await sql`select count(*)::int n from tasks where title like '[마케팅] 피드 톤 불일치 — 하이링크%'`)[0].n;
  const r = await ctx.owner.ok('PATCH', `/api/marketing/ops/proposals/${ids.x4}`, { action: 'approve' });
  assert.equal(r.status, 'approved'); assert.equal(r.executed.tasks.length, 1);
  assert.equal((await sql`select count(*)::int n from tasks where title like '[마케팅] 피드 톤 불일치 — 하이링크%'`)[0].n, before + 1, '업무 1건만');
  const rows = await sql`select id, status, decision_note from mkt_proposals where id = any(${[ids.x1, ids.x2, ids.x3, ids.x4, ids.y1, ids.c1, ids.o1]}::uuid[])`;
  const st = (k) => rows.find((x) => x.id === ids[k]);
  assert.deepEqual(['x1', 'x2', 'x3'].map((k) => st(k).status), ['done', 'done', 'done']);
  assert.match(st('x1').decision_note, /같은 알림 묶음/);
  assert.deepEqual([st('x4').status, st('y1').status, st('c1').status, st('o1').status], ['approved', 'pending', 'pending', 'pending'], '다른 신호·다른 회사는 그대로');
  const v = await ctx.owner.ok('GET', '/api/marketing/inbox');
  assert.equal(v.counts.proposals, 3);
});
