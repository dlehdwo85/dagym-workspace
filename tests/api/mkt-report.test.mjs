// 상용화 ⑧ 월간 마케팅 보고: 지난달 게시(채널별)·승인 소요·자동 제작·광고·전화·크레딧·AI 집계, 시험 콘텐츠 제외, 관리자만, 매월 1일 알림(회사·달마다 한 번)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer({ MKT_REPORT_ANYDAY: '1' }); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const prev = (() => { const [y, m] = today.slice(0, 7).split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; })();
const at = (d, h = 10) => new Date(`${prev}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00+09:00`);

test('월간 보고 집계·권한·월초 알림', async () => {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  const ins = async (o) => (await sql`insert into mkt_contents ${sql({ tenant: 'default', title: 'x', channel: 'instagram', status: 'pending', current_version: 1, created_by: ctx.ownerId, ...o })} returning id`)[0].id;
  const p1 = await ins({ status: 'published', published_at: at(5), scheduled_at: at(5) });
  const p2 = await ins({ status: 'published', published_at: at(6), scheduled_at: at(6), channel: 'blog', auto: true, produced_at: at(3), quality: sql.json({ passed: true }) });
  await ins({ status: 'canceled', scheduled_at: at(7) });
  await ins({ auto: true, produced_at: at(8), scheduled_at: at(12), status: 'changes', quality: sql.json({ passed: false, issues: ['x'] }) });
  await ins({ status: 'published', published_at: at(9), is_test: true }); // 시험은 빠짐
  for (const id of [p1, p2]) await sql`insert into mkt_versions (content_id, version, body, created_by, created_at) values (${id}, 1, 'b', ${ctx.ownerId}, ${at(4, 9)})`;
  await sql`insert into mkt_decisions (content_id, version, decision, decided_by, decided_at) values (${p1}, 1, 'approve', ${ctx.ownerId}, ${at(4, 13)}), (${p2}, 1, 'changes', ${ctx.ownerId}, ${at(4, 10)}), (${p2}, 1, 'approve', ${ctx.ownerId}, ${at(4, 15)})`;
  const [acc] = await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label) values ('default', 'naver', '1', '네이버') returning id`;
  await sql`insert into mkt_ad_stats (account_id, day, campaign_id, impressions, clicks, cost_krw, conversions) values (${acc.id}, ${`${prev}-10`}, 'c', 1000, 50, 25000, 2), (${acc.id}, ${`${today.slice(0, 7)}-01`}, 'c', 9, 9, 9, 9)`;
  await sql`insert into mkt_calls (tenant, phone, called_at, status) values ('default', '***-****-1111', ${at(11)}, 'lead'), ('default', '***-****-2222', ${at(12)}, 'new')`;
  await sql`insert into mkt_credit_ledger (tenant, kind, credits, created_at) values ('default', 'regen_image', 6.5, ${at(13)}), ('default', 'text', 0, ${at(13)})`;
  await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose, created_at)
    values ('default', ${ctx.ownerId}, gen_random_uuid(), 'anthropic', 'x', 0, 0, 0, 0, 0.5, 'marketing_produce', ${at(14)})`;

  assert.equal((await ctx.staffA.client.req('GET', '/api/marketing/report')).status, 403, '직원은 못 봄');
  assert.equal((await ctx.staffB.client.req('GET', '/api/marketing/report')).status, 404, '공간 밖');
  const r = await ctx.owner.ok('GET', '/api/marketing/report');
  assert.equal(r.month, prev, '기본 = 지난달');
  assert.deepEqual([r.posts.published, r.posts.scheduled, r.posts.canceled], [2, 3, 1]);
  assert.deepEqual(r.posts.byChannel.map((c) => c.channel).sort(), ['blog', 'instagram']);
  assert.deepEqual([r.approvals.approved, r.approvals.changes, r.approvals.avg_hours], [2, 1, 5], '승인 소요 평균 (4+6)/2 = 5시간');
  assert.deepEqual([r.auto.produced, r.auto.quality_failed], [2, 1]);
  assert.deepEqual([r.ads.total.impressions, r.ads.total.clicks, r.ads.total.cost_krw, r.ads.total.ctr, r.ads.total.cpc], [1000, 50, 25000, 5, 500], '이번 달 기록은 빠짐');
  assert.deepEqual([r.calls.total, r.calls.leads], [2, 1]);
  assert.equal(r.credits.total, 6.5); assert.equal(r.ai.usd, 0.5);
  assert.equal((await ctx.owner.req('GET', '/api/marketing/report?month=2026-13')).status, 400);
  // 월초 알림: 받는 사람(관리자)에게 한 번, 두 번째 tick 은 건너뜀
  await tick(); await tick();
  const n = await sql`select user_id, link from notifications where title = ${`${prev} 마케팅 월간 보고`}`;
  assert.ok(n.length >= 1 && n.every((x) => x.link === `/s/marketing/report?month=${prev}`), JSON.stringify(n));
  assert.ok(n.some((x) => x.user_id === ctx.ownerId));
  assert.equal(new Set(n.map((x) => x.user_id)).size, n.length, '사람마다 한 번');
  assert.equal((await sql`select count(*)::int c from app_settings where key = ${`mktreport:default:${prev}`}`)[0].c, 1);
});
