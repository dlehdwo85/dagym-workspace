// ⑥ 마케팅 홈 디벨롭(대표 승인 10/20 오후): /api/marketing/home — 숫자 4칸·승인 3(썸네일)·AI 작업 큐([지금 실행]/[밤에])·밤사이 범위(AI 설정)·이번 주 7일·성과 7일·광고·최근·제안 → [업무로 만들기]·카드 켜기/끄기(사람별·회사 기본)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql, tenant;
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  [{ tenant }] = await sql`select tenant from users where id = ${ctx.ownerId}`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
});
after(async () => { if (process.env.DUMP_SERVER_LOG) console.log(srv.log().split('\n').filter((l) => /error|Error|at /.test(l)).slice(-40).join('\n')); srv?.proc.kill(); await sql?.end(); });

const tomorrow10 = () => { const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + 864e5)); return `${d}T10:00:00+09:00`; };

describe('⑥ 마케팅 홈', () => {
  test('숫자 4칸·승인 3·AI 작업 큐·제안·카드 기본 — 공간 없는 직원 404', async () => {
    assert.equal((await ctx.staffB.client.req('GET', '/api/marketing/home')).status, 404);
    const [pending] = await sql`insert into mkt_contents (tenant, title, channel, scheduled_at, status, current_version, created_by) values (${tenant}, '내일 인스타 피드', 'instagram', ${tomorrow10()}, 'pending', 1, ${ctx.ownerId}) returning id`;
    await sql`insert into mkt_versions (content_id, version, body, media_ids) values (${pending.id}, 1, '캡션', '{}')`;
    await sql`insert into mkt_contents (tenant, title, channel, scheduled_at, status, current_version, created_by, auto, kind, produce_at) values (${tenant}, '자동 블로그(대기)', 'blog', ${tomorrow10()}, 'draft', 0, ${ctx.ownerId}, true, 'blog', now() + interval '2 hours')`;
    await sql`insert into mkt_calls (tenant, phone, created_by) values (${tenant}, '010-9999-0000', ${ctx.ownerId})`;
    await sql`insert into ai_doc_jobs (tenant, user_id, status, mode, kind, title, instructions) values (${tenant}, ${ctx.ownerId}, 'queued', 'create', 'docx', '10월 보고서', '표 하나')`;
    const h = await ctx.owner.ok('GET', '/api/marketing/home');
    assert.equal(h.canEdit, true);
    assert.deepEqual(h.cards.cards, ['chat', 'kpi', 'approve', 'queue', 'week', 'perf', 'recent', 'channels'], '기본 카드 순서');
    assert.deepEqual([h.kpi.approvals, h.kpi.approvalsDetail.contents, h.kpi.week.planned, h.kpi.ads, h.kpi.calls7], [1, 1, 1, null, 1], '광고 연결 없으면 7일 문의만');
    assert.equal(h.approve.length, 1); assert.equal(h.approve[0].title, '내일 인스타 피드'); assert.equal(h.approve[0].media, null, '시안 없으면 채널 색 카드');
    assert.ok(h.approve[0].deadline, '승인 마감');
    const c = h.queue.find((q) => q.kind === 'content'), d = h.queue.find((q) => q.kind === 'doc');
    assert.deepEqual([c.state, c.canRun, c.canNight, c.night], ['waiting', true, true, false]);
    assert.deepEqual([d.state, d.canRun, d.canNight, d.title], ['waiting', true, true, '문서: 10월 보고서']);
    assert.equal(h.week.length, 7); assert.equal(h.week[1].posts.length, 1, '내일 칸에 점 하나');
    assert.equal(h.perf.length, 7); assert.equal(h.ads, null); assert.deepEqual(h.recent, []);
    assert.deepEqual(h.suggestions.map((s) => s.key), ['approve', 'media', 'calls'], '승인 대기 · 시안 없는 예정 게시 · 미응답 문의');
    assert.equal(h.night.length, 0); assert.deepEqual(h.nightScope, {});
    const st = await ctx.staffA.client.ok('GET', '/api/marketing/home');
    assert.equal(st.canEdit, false);
    assert.equal(st.queue.find((q) => q.kind === 'content').canRun, false, '자동 제작 실행은 관리자만');
    assert.equal(st.queue.some((q) => q.kind === 'doc'), false, '문서 작업은 본인 것만');
  });

  test('[밤에] = 오늘 22시(KST)로 미룸(시안 produce_at·night_run, 문서 run_after), 밤사이 범위는 AI 설정', async () => {
    const h = await ctx.owner.ok('GET', '/api/marketing/home');
    const c = h.queue.find((q) => q.kind === 'content'), d = h.queue.find((q) => q.kind === 'doc');
    const r = await ctx.owner.ok('POST', '/api/marketing/home', { action: 'night', kind: 'content', id: c.id });
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(new Date(r.at))) % 24;
    assert.ok(hour >= 22 || hour < 6, `밤 시각 ${r.at}`);
    const [row] = await sql`select night_run, produce_at from mkt_contents where id = ${c.id}`;
    assert.equal(row.night_run, true);
    await ctx.owner.ok('POST', '/api/marketing/home', { action: 'night', kind: 'doc', id: d.id });
    const [dj] = await sql`select run_after from ai_doc_jobs where id = ${d.id}`;
    assert.ok(dj.run_after, '문서 작업 run_after');
    const h2 = await ctx.owner.ok('GET', '/api/marketing/home');
    assert.deepEqual([h2.queue.find((q) => q.id === c.id).night, h2.queue.find((q) => q.id === c.id).canNight, h2.queue.find((q) => q.id === d.id).night], [true, false, true]);
    assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/home', { action: 'run', kind: 'content', id: c.id })).status, 403, '직원은 실행 못 함');
    assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/home', { action: 'night', kind: 'doc', id: d.id })).status, 404, '남의 문서 작업');
    await ctx.owner.ok('PUT', '/api/ai/settings', { nightScope: { draft: true } });
    assert.deepEqual((await ctx.owner.ok('GET', '/api/marketing/home')).nightScope, { draft: true });
    assert.equal((await ctx.owner.ok('GET', '/api/ai/logs')).settings.night_scope.draft, true);
  });

  test('제안 → [업무로 만들기](마케팅 공간 업무) · 카드 켜기/끄기: 사람별 덮어쓰기, 관리자는 회사 기본, 빈 목록이면 회사 기본으로', async () => {
    const r = await ctx.owner.ok('POST', '/api/marketing/home', { action: 'task', keys: ['calls', 'nope'] });
    assert.equal(r.count, 1);
    const [t] = await sql`select title, space, assignee_id from tasks where title like '미응답 문의%' and deleted_at is null`;
    assert.deepEqual([t.space, t.assignee_id], ['marketing', ctx.ownerId]);
    assert.equal((await ctx.owner.req('POST', '/api/marketing/home', { action: 'task', keys: ['nope'] })).status, 400);
    assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/home', { action: 'cards', cards: ['kpi'], company: true })).status, 403, '회사 기본은 관리자만');
    await ctx.owner.ok('POST', '/api/marketing/home', { action: 'cards', cards: ['kpi', 'approve', 'channels'], company: true });
    assert.deepEqual((await ctx.staffA.client.ok('GET', '/api/marketing/home')).cards, { cards: ['kpi', 'approve', 'channels'], mine: false, company: ['kpi', 'approve', 'channels'] }, '직원도 회사 기본');
    await ctx.staffA.client.ok('POST', '/api/marketing/home', { action: 'cards', cards: ['chat', 'kpi'] });
    assert.deepEqual((await ctx.staffA.client.ok('GET', '/api/marketing/home')).cards.cards, ['chat', 'kpi'], '내 구성이 우선');
    await ctx.staffA.client.ok('POST', '/api/marketing/home', { action: 'cards', cards: [] });
    assert.deepEqual((await ctx.staffA.client.ok('GET', '/api/marketing/home')).cards, { cards: ['kpi', 'approve', 'channels'], mine: false, company: ['kpi', 'approve', 'channels'] }, '빈 목록 = 회사 기본으로 되돌림');
  });
});
