// #544(대표 10/24 '브랜드별 레퍼런스 업체와 비교해 개선한 뒤 승인 다시'): 브랜드 템플릿이 나올 때까지 정기·밤사이 자동 제작 시안은
// 승인함에 올리지 않고 초안으로 보관(회사 설정 auto_hold — 지금 회사는 186 마이그레이션으로 켬, 새 회사는 끔)
// · 알림 없음 · 승인 마감 정리·미루기 없음 · 승인함 '초안 보관' 묶음(날짜가 지나도) · 관리자 [승인 요청] → 승인 대기 · 끄면 예전처럼 승인 대기
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('초안 보관: 자동 제작 → 초안(시안 붙음·알림 없음) → 마감 지나도 그대로 → [승인 요청] → 승인 대기 · 끄면 예전처럼', async () => {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/auto')).settings.auto_hold, false, '새 회사는 끔');
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', leadDays: 3, remindHours: 72, quietStart: 0, quietEnd: 0, autoHold: true });
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/auto')).settings.auto_hold, true);
  const brand = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '보관 시험 브랜드' });
  const rule = await ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: brand.id, channel: 'instagram', kind: 'feed', weekdays: [0, 1, 2, 3, 4, 5, 6], postTime: '23:00', topicHint: '가을 이벤트' });
  await ctl({ anthropicReset: true, anthropicQueue: Array.from({ length: 8 }, (_, i) => say({ title: `가을 이벤트 ${i + 1}`, body: '가을 맞이 안내입니다. 이번 주 토요일까지 현관에서 안내합니다.', brief: '현관 실사' })) });
  const run = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.ok(run.produced.length >= 1 && run.produced.every((r) => r.held === true), JSON.stringify(run.produced));
  const made = await sql`select id, status, produced_at, quality, current_version from mkt_contents where rule_id = ${rule.id} and produced_at is not null order by scheduled_at`;
  assert.ok(made.length >= 1);
  for (const c of made) {
    assert.equal(c.status, 'draft', '승인 대기 아님 — 초안 보관');
    assert.equal(c.quality.held.reason, 'template');
    assert.equal((await sql`select cardinality(media_ids)::int n from mkt_versions where content_id = ${c.id} and version = ${c.current_version}`)[0].n, 1, '시안은 그려 둠(나중에 [승인 요청])');
  }
  assert.equal((await sql`select count(*)::int n from notifications where user_id = ${ctx.ownerId} and (title like '제작 완료%' or title like '승인 마감%')`)[0].n, 0, '승인 알림 없음');
  assert.equal((await sql`select count(*)::int n from mkt_contents where rule_id = ${rule.id} and status = 'pending'`)[0].n, 0);
  // 승인함: '초안 보관'으로 보임 · 승인 마감·게시 시각이 지나도 정리·미루기 없이 남음
  const h = made[0];
  await sql`update mkt_contents set scheduled_at = now() - interval '1 hour' where id = ${h.id}`;
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const [after1] = await sql`select status, scheduled_at, quality from mkt_contents where id = ${h.id}`;
  assert.equal(after1.status, 'draft', '마감 지나도 취소·미루기 없음');
  assert.ok(!after1.quality.moved && !after1.quality.postponed && !after1.quality.expired);
  const list = (await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals')).contents;
  const row = list.find((c) => c.id === h.id);
  assert.ok(row && row.status === 'draft' && row.quality?.held, '게시 시각이 지나도 승인함 초안 보관 묶음에');
  // [승인 요청]: 직원 403 · 관리자 → 승인 대기 + 승인자 알림 + 감사 · 두 번째는 400
  assert.equal((await ctx.staffA.client.req('POST', `/api/marketing/auto/contents/${h.id}`, { action: 'submit' })).status, 403);
  const sub = await ctx.owner.ok('POST', `/api/marketing/auto/contents/${h.id}`, { action: 'submit' });
  assert.equal(sub.status, 'pending');
  const [after2] = await sql`select status, quality from mkt_contents where id = ${h.id}`;
  assert.equal(after2.status, 'pending'); assert.equal(after2.quality.held, undefined); assert.ok(after2.quality.submitted?.heldAt);
  assert.ok((await sql`select 1 from audit_logs where action = 'mkt.held_submit' and target_id = ${h.id}`).length, '감사 기록');
  assert.equal((await ctx.owner.req('POST', `/api/marketing/auto/contents/${h.id}`, { action: 'submit' })).status, 400, '보관 중이 아니면 거절');
  // 사람이 직접 [다시 만들기] = 예외(승인 대기로)
  if (made[1]) {
    await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '가을 이벤트 다시', body: '다시 만든 안내입니다. 이번 주 토요일까지 현관에서 안내합니다.', brief: '현관 실사' })] });
    const r = await ctx.owner.ok('POST', `/api/marketing/auto/contents/${made[1].id}`, { action: 'regen' });
    assert.ok(!r.held);
    assert.equal((await sql`select status from mkt_contents where id = ${made[1].id}`)[0].status, 'pending');
  }
  // 끄면 예전처럼 정기 자동 제작도 승인 대기
  await ctx.owner.ok('PUT', '/api/marketing/auto', { autoHold: false });
  const [next] = await sql`select id from mkt_contents where rule_id = ${rule.id} and produced_at is null and status = 'draft' order by scheduled_at limit 1`;
  await sql`update mkt_contents set produce_at = now() - interval '1 minute' where id = ${next.id}`;
  await ctl({ anthropicReset: true, anthropicQueue: Array.from({ length: 8 }, () => say({ title: '가을 이벤트 끔', body: '끈 뒤 안내입니다. 이번 주 토요일까지 현관에서 안내합니다.', brief: '현관 실사' })) });
  const run2 = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.ok(run2.produced.some((r) => r.id === next.id && !r.held), JSON.stringify(run2.produced));
  assert.equal((await sql`select status from mkt_contents where id = ${next.id}`)[0].status, 'pending');
});

test('187: 이미 승인 대기에 있던 자동 시안(로컬이 짚은 4건)·미뤄진 글 → 초안 보관 · 사람 글·[승인 요청]한 글·수정 요청·대표 보류·보관 끈 회사는 그대로', async () => {
  const [{ tenant }] = await sql`select tenant from mkt_settings limit 1`;
  await sql`update mkt_settings set auto_hold = true where tenant = ${tenant}`;
  const mk = async (id, o) => (await sql`insert into mkt_contents (id, tenant, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produced_at, quality)
    values (${id}, ${tenant}, ${o.title}, 'instagram', 'feed', ${o.at === undefined ? sql`now() + interval '1 day'` : o.at}, ${o.status}, 1, ${ctx.ownerId}, ${o.auto ?? true}, now(), ${sql.json(o.quality ?? { passed: true, issues: [] })}) returning id`)[0].id;
  const a = await mk('c24da858-0000-4000-8000-000000000187', { title: '바디랩 자동 1', status: 'pending' });
  const b = await mk('942dc77d-0000-4000-8000-000000000187', { title: '워크인 자동 1', status: 'pending' });
  const other = await mk('0b0b0b0b-0000-4000-8000-000000000187', { title: '목록 밖 자동', status: 'pending' });
  const human = await mk('c333aca1-0000-4000-8000-000000000187', { title: '사람 글', status: 'pending', auto: false });
  const post = await mk('11111111-0000-4000-8000-000000000187', { title: '미뤄진 자동', status: 'hold', at: null, quality: { passed: true, issues: [], postponed: { from: new Date().toISOString(), at: new Date().toISOString() } } });
  const held = await mk('22222222-0000-4000-8000-000000000187', { title: '대표 보류', status: 'hold' });
  const sub = await mk('2dd53eb7-0000-4000-8000-000000000187', { title: '승인 요청한 글', status: 'pending', quality: { passed: true, issues: [], submitted: { at: new Date().toISOString() } } });
  await sql.unsafe(readFileSync(new URL('../../db/migrations/187_mkt_hold_existing_auto.sql', import.meta.url), 'utf8'));
  const st = Object.fromEntries((await sql`select id, status, quality->'held'->>'from' as f from mkt_contents where id in ${sql([a, b, other, human, post, held, sub])}`).map((r) => [r.id, `${r.status}${r.f ? `:${r.f}` : ''}`]));
  assert.deepEqual([st[a], st[b], st[other], st[human], st[post], st[held], st[sub]], ['draft:pending', 'draft:pending', 'pending', 'pending', 'draft:hold', 'hold', 'pending']);
  const list = (await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals')).contents;
  assert.ok(list.some((c) => c.id === post && c.status === 'draft' && c.quality?.held), '날짜 없는 미뤄진 글도 초안 보관 묶음에');
  assert.equal((await ctx.owner.ok('POST', `/api/marketing/auto/contents/${a}`, { action: 'submit' })).status, 'pending', '[승인 요청]으로 되돌림');
});
