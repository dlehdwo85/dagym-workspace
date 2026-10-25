// 대표 10/25 22:20 결정 15-16(로컬 23:10 요청 A·B, docs/handoff/MARKETING_REWORK_2026-10-25.md §3-7):
// B 자동 생성 일시정지(auto_pause) — 켜면 [지금 한 번 돌리기]가 칸·제작·시안을 만들지 않음(paused) · 승인함 응답에 paused · 끄면 다시 돎
// A 미게시 글 일괄 보관 — dryRun 건수 → 초안·승인 대기·수정 요청·보류 → '취소'(quality.archived_from·archived_at·archived_reason) · 게시됨 그대로 · 감사 기록 · [되돌리기] 원래 상태 · 직원 불가
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true }); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('요청 B: 자동 생성 일시정지 — 규칙이 있어도 정기 실행이 아무것도 만들지 않음(paused) · 승인함 paused · 끄면 풀림 · 감사 기록', async () => {
  const brand = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '정지 시험 브랜드' });
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/auto')).settings.auto_pause, false, '새 회사는 끔(운영 회사는 203 마이그레이션으로 켬)');
  await ctx.owner.ok('PUT', '/api/marketing/auto', { autoPause: true });
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/auto')).settings.auto_pause, true);
  await ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: brand.id, channel: 'instagram', kind: 'feed', weekdays: [0, 1, 2, 3, 4, 5, 6], postTime: '23:00', topicHint: '정지 시험' });
  const run = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.deepEqual([run.paused, run.planned, run.produced.length], [true, 0, 0], JSON.stringify(run));
  assert.equal((await sql`select count(*)::int n from mkt_contents where produced_at is not null`)[0].n, 0, '제작된 글 없음');
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals')).paused, true, '승인함 띠');
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'mkt.auto_pause'`)[0].n, 1, '켠 기록');
  await ctx.owner.ok('PUT', '/api/marketing/auto', { autoPause: false });
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals')).paused, false);
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'mkt.auto_resume'`)[0].n, 1, '끈 기록');
  await sql`update mkt_rules set active = false`; // 아래 보관 시험이 AI 제작을 부르지 않게
});

test('요청 A: 미게시 글 일괄 보관 — dryRun 건수 → 취소 + 원래 상태 기록 · 게시됨 그대로 · 승인함에서 사라짐 · 감사 · [되돌리기] · 직원 불가', async () => {
  const brand = (await ctx.owner.ok('GET', '/api/marketing/brands')).brands[0];
  const mk = async (title) => (await ctx.owner.ok('POST', '/api/marketing/contents', { title, channel: 'instagram', brandId: brand.id, body: `${title} 본문입니다. 오늘도 좋은 하루 보내세요.` })).id; // v1 = 승인 대기
  const p1 = await mk('보관 시험 대기 1'); const p2 = await mk('보관 시험 대기 2'); const h = await mk('보관 시험 보류'); const pub = await mk('보관 시험 게시됨'); const d = await mk('보관 시험 초안');
  await sql`update mkt_contents set status = 'hold' where id = ${h}`;
  await sql`update mkt_contents set status = 'published', published_at = now() where id = ${pub}`;
  await sql`update mkt_contents set status = 'draft' where id = ${d}`;
  const dry = await ctx.owner.ok('POST', '/api/marketing/contents/archive', { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.ok(dry.count >= 4 && dry.byStatus.pending >= 2 && dry.byStatus.hold >= 1 && dry.byStatus.draft >= 1, JSON.stringify(dry));
  assert.equal((await sql`select count(*)::int n from mkt_contents where status = 'canceled'`)[0].n, 0, 'dryRun 은 바꾸지 않음');
  assert.ok([403, 404].includes((await ctx.staffA.client.req('POST', '/api/marketing/contents/archive', {})).status), '직원은 못 함');
  const r = await ctx.owner.ok('POST', '/api/marketing/contents/archive', { reason: '대표 10/25 22:20 전면 정리' });
  assert.equal(r.count, dry.count);
  const by = Object.fromEntries((await sql`select id, status, quality from mkt_contents where id in (${p1}, ${p2}, ${h}, ${d}, ${pub})`).map((x) => [x.id, x]));
  assert.deepEqual([by[p1].status, by[p2].status, by[h].status, by[d].status, by[pub].status], ['canceled', 'canceled', 'canceled', 'canceled', 'published'], '게시됨은 그대로');
  assert.deepEqual([by[p1].quality.archived_from, by[h].quality.archived_from, by[d].quality.archived_from, by[p1].quality.archived_reason, by[p1].quality.archived_at], ['pending', 'hold', 'draft', '대표 10/25 22:20 전면 정리', r.at]);
  assert.ok(!(await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals')).contents.some((c) => [p1, p2, h, d].includes(c.id)), '승인함에서 사라짐');
  const [a] = await sql`select detail from audit_logs where action = 'mkt.archive_all' order by created_at desc limit 1`;
  assert.deepEqual([a.detail.count, a.detail.reason], [r.count, '대표 10/25 22:20 전면 정리']);
  // 되돌리기: 같은 묶음 전부 원래 상태로 · 기록 칸은 지우고 unarchived_at 만
  const u = await ctx.owner.ok('POST', '/api/marketing/contents/unarchive', {});
  assert.equal(u.count, r.count);
  const after = Object.fromEntries((await sql`select id, status, quality from mkt_contents where id in (${p1}, ${h}, ${d})`).map((x) => [x.id, x]));
  assert.deepEqual([after[p1].status, after[h].status, after[d].status, after[p1].quality.archived_from, !!after[p1].quality.unarchived_at], ['pending', 'hold', 'draft', undefined, true]);
  assert.equal((await ctx.owner.req('POST', '/api/marketing/contents/unarchive', {})).status, 400, '되돌릴 묶음이 없으면 400');
});
