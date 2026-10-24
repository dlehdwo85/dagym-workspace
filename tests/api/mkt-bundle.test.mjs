// 대표 10/20 오후 6) 자동 제작 게시 주기: 하루 1개 → 2~3일에 1묶음(유튜브 쇼츠·인스타 릴스·블로그·인스타+페이스북 게시물·인스타+페이스북 스토리) 브랜드마다,
// 규칙 'n일마다'(요일 대신)·같은 글 함께 올릴 채널(cross_channels)·종류 shorts/story, 유튜브·스레드 '준비 중' 사유 한 줄
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql, brand;
const P = {};
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  brand = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '워크인' });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);

describe('⑥ 게시 주기 묶음', () => {
  test('묶음 규칙 5개(3일마다, 같은 bundle_key) → 2주 칸은 3일 간격 날짜에만, 게시물·스토리는 페이스북 함께(cross_channels), 쇼츠·스토리 종류', async () => {
    assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/auto/bundle', { brandId: brand.id })).status, 403, '관리자만');
    const start = ymd(new Date(Date.now() + 864e5)); // 내일부터(오늘 시각이 지난 칸은 안 만들어지므로)
    const r = await ctx.owner.ok('POST', '/api/marketing/auto/bundle', { brandId: brand.id, intervalDays: 3, startDate: start });
    assert.equal(r.ids.length, 5);
    const rules = (await ctx.owner.ok('GET', '/api/marketing/auto')).rules.filter((x) => x.bundle_key === r.bundleKey);
    assert.deepEqual(rules.map((x) => `${x.channel}/${x.kind}`).sort(), ['blog/blog', 'instagram/feed', 'instagram/reels', 'instagram/story', 'youtube/shorts']);
    assert.ok(rules.every((x) => x.interval_days === 3 && x.anchor_date === start && x.weekdays.length === 0), JSON.stringify(rules[0]));
    assert.deepEqual(rules.find((x) => x.kind === 'feed').cross_channels, ['facebook']); assert.deepEqual(rules.find((x) => x.kind === 'story').cross_channels, ['facebook']); assert.deepEqual(rules.find((x) => x.kind === 'shorts').cross_channels, []);
    const slots = await sql`select kind, cross_channels, title, (scheduled_at at time zone 'Asia/Seoul')::date::text as d from mkt_contents where rule_id = any(${r.ids}::uuid[]) order by scheduled_at`;
    const days = [...new Set(slots.map((s) => s.d))];
    assert.ok(days.length >= 4, `2주 안에 ${days.length}묶음`);
    for (let i = 1; i < days.length; i++) assert.equal((Date.parse(days[i]) - Date.parse(days[i - 1])) / 864e5, 3, '3일 간격');
    assert.equal(days[0], start);
    assert.equal(slots.filter((s) => s.d === days[0]).length, 5, '하루에 묶음 5개');
    const feed = slots.find((s) => s.kind === 'feed'); assert.deepEqual(feed.cross_channels, ['facebook']); assert.match(feed.title, /피드\(함께 페이스북\)/);
    assert.match(slots.find((s) => s.kind === 'story').title, /스토리/); assert.match(slots.find((s) => s.kind === 'shorts').title, /쇼츠/);
    // 일반 규칙도 n일마다 가능, 요일도 n일도 없으면 400, 종류 story 허용
    assert.equal((await ctx.owner.req('POST', '/api/marketing/auto/rules', { channel: 'instagram', kind: 'story', weekdays: [], postTime: '18:00' })).status, 400);
    const r2 = await ctx.owner.ok('POST', '/api/marketing/auto/rules', { channel: 'instagram', kind: 'story', weekdays: [], postTime: '18:00', intervalDays: 2, anchorDate: start, crossChannels: ['facebook', 'instagram'] });
    const [row] = await sql`select interval_days, cross_channels from mkt_rules where id = ${r2.id}`;
    assert.deepEqual([row.interval_days, row.cross_channels], [2, ['facebook']], '자기 채널은 함께 목록에서 뺌');
  });
  test('채널 상태: 유튜브·스레드가 준비 중이면 무엇이 막는지 한 줄', async () => {
    const ov = await ctx.owner.ok('GET', '/api/marketing/overview');
    const yt = ov.channels.find((c) => c.key === 'youtube'), th = ov.channels.find((c) => c.key === 'threads');
    assert.match(yt.pending, /YouTube Data API/);
    assert.match(th.pending, /threads_basic·threads_content_publish/);
  });
});

describe('로컬 10/20 묶음 보완 ①② (주말 건너뛰기·요일 지정·시각 한 번에)', () => {
  const nextDow = (dow, from = new Date()) => { const d = new Date(from.getTime() + 864e5); while (new Date(`${ymd(d)}T12:00:00+09:00`).getUTCDay() !== dow) d.setTime(d.getTime() + 864e5); return ymd(d); };
  test('① skipWeekend: 토요일 시작 2일마다 → 토·일 칸이 월요일로(같은 날 하나만), 요일 지정 묶음은 그 요일에만 + 종류별 시각', async () => {
    const sat = nextDow(6);
    const r = await ctx.owner.ok('POST', '/api/marketing/auto/bundle', { brandId: brand.id, intervalDays: 2, startDate: sat, skipWeekend: true, times: { blog: '10:00', feed: '12:00', story: '12:00', shorts: '18:00', reels: '18:00' } });
    const rules = (await ctx.owner.ok('GET', '/api/marketing/auto')).rules.filter((x) => x.bundle_key === r.bundleKey);
    assert.ok(rules.every((x) => x.skip_weekend === true && x.interval_days === 2));
    assert.deepEqual(Object.fromEntries(rules.map((x) => [x.kind, x.post_time.slice(0, 5)])), { blog: '10:00', feed: '12:00', story: '12:00', shorts: '18:00', reels: '18:00' }, '종류별 시각');
    const days = (await sql`select distinct (scheduled_at at time zone 'Asia/Seoul')::date::text as d from mkt_contents where rule_id = any(${r.ids}::uuid[]) order by 1`).map((x) => x.d);
    assert.ok(days.length >= 3);
    assert.ok(days.every((d) => ![0, 6].includes(new Date(`${d}T12:00:00+09:00`).getUTCDay())), `주말 없음 ${days}`);
    assert.equal(days[0], nextDow(1, new Date(Date.parse(`${sat}T12:00:00+09:00`) - 864e5)), '토요일 시작 → 첫 칸은 다음 월요일');
    const n = await sql`select count(*)::int n from mkt_contents where rule_id = ${rules[0].id} and (scheduled_at at time zone 'Asia/Seoul')::date::text = ${days[0]}`;
    assert.equal(n[0].n, 1, '토·일 둘 다 월요일로 밀려도 한 칸');
    const w = await ctx.owner.ok('POST', '/api/marketing/auto/bundle', { brandId: brand.id, weekdays: [1, 3, 5] });
    const wr = (await ctx.owner.ok('GET', '/api/marketing/auto')).rules.filter((x) => x.bundle_key === w.bundleKey);
    assert.ok(wr.every((x) => x.interval_days === null && JSON.stringify(x.weekdays) === '[1,3,5]' && x.skip_weekend === false), '요일 지정은 n일마다 대신');
    const wd = (await sql`select distinct (scheduled_at at time zone 'Asia/Seoul')::date::text as d from mkt_contents where rule_id = any(${w.ids}::uuid[])`).map((x) => new Date(`${x.d}T12:00:00+09:00`).getUTCDay());
    assert.ok(wd.length && wd.every((d) => [1, 3, 5].includes(d)), `월·수·금만 ${wd}`);
    P.key = w.bundleKey; P.ids = w.ids;
  });
  test('② PATCH 묶음: 시각을 바꾸면 규칙 + 제작 전 초안이 같은 날 새 시각으로, 요일을 바꾸면 제작 전 초안을 지우고 다시 계획, 다른 회사·없는 묶음 404', async () => {
    const rules0 = (await ctx.owner.ok('GET', '/api/marketing/auto')).rules.filter((x) => x.bundle_key === P.key);
    const blogId0 = rules0.find((x) => x.kind === 'blog').id;
    const before = await sql`select id, (scheduled_at at time zone 'Asia/Seoul')::date::text as d from mkt_contents where rule_id = ${blogId0} and status = 'draft' order by scheduled_at`;
    assert.ok(before.length);
    const r = await ctx.owner.ok('PATCH', '/api/marketing/auto/bundle', { bundleKey: P.key, times: { blog: '09:30', feed: '14:00' } });
    assert.equal(typeof r.planned, 'number');
    const rules = (await ctx.owner.ok('GET', '/api/marketing/auto')).rules.filter((x) => x.bundle_key === P.key);
    assert.equal(rules.find((x) => x.kind === 'blog').post_time.slice(0, 5), '09:30'); assert.equal(rules.find((x) => x.kind === 'story').post_time.slice(0, 5), '18:00', '안 바꾼 종류는 그대로');
    const blogId = rules.find((x) => x.kind === 'blog').id;
    const moved = await sql`select id, to_char(scheduled_at at time zone 'Asia/Seoul', 'HH24:MI') as t, (scheduled_at at time zone 'Asia/Seoul')::date::text as d from mkt_contents where rule_id = ${blogId} order by scheduled_at`;
    assert.ok(moved.length && moved.every((x) => x.t === '09:30'), `초안도 새 시각 ${JSON.stringify(moved)}`);
    const kept = before.filter((b) => moved.some((m) => m.id === b.id));
    assert.ok(kept.length && kept.every((b) => moved.find((m) => m.id === b.id).d === b.d), '날짜는 그대로, 시각만');
    // 대표 10/24 ③: 같은 브랜드 다른 묶음(위 ①의 2일마다 블로그 10:00·⑥의 3일마다 13:00)과 하루 2건·3시간 규칙 — 새 시각에 걸리는 칸은 빠지고, 예전 시각이라 막혔던 날은 새로 생길 수 있음
    const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    for (const m of moved) {
      const others = await sql`select to_char(scheduled_at at time zone 'Asia/Seoul', 'HH24:MI') as t from mkt_contents where brand_id = ${brand.id} and channel = 'blog' and coalesce(kind, '') = 'blog'
        and status <> 'canceled' and id <> ${m.id} and (scheduled_at at time zone 'Asia/Seoul')::date = ${m.d}::date`;
      assert.ok(others.length < 2 && others.every((o) => Math.abs(mins(o.t) - mins('09:30')) >= 180), `${m.d} 같은 브랜드 블로그 ${JSON.stringify(others)}`);
    }
    await ctx.owner.ok('PATCH', '/api/marketing/auto/bundle', { bundleKey: P.key, weekdays: [2, 4, 6] });
    const wd = (await sql`select distinct (scheduled_at at time zone 'Asia/Seoul')::date::text as d from mkt_contents where rule_id = any(${P.ids}::uuid[])`).map((x) => new Date(`${x.d}T12:00:00+09:00`).getUTCDay());
    assert.ok(wd.length && wd.every((d) => [2, 4, 6].includes(d)), `화·목·토로 다시 계획 ${wd}`);
    assert.equal((await ctx.owner.req('PATCH', '/api/marketing/auto/bundle', { bundleKey: '00000000-0000-4000-8000-000000000000', times: { blog: '09:00' } })).status, 404);
    assert.equal((await ctx.staffA.client.req('PATCH', '/api/marketing/auto/bundle', { bundleKey: P.key, times: { blog: '09:00' } })).status, 403, '관리자만');
  });
});
