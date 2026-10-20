// 대표 10/20 오후 6) 자동 제작 게시 주기: 하루 1개 → 2~3일에 1묶음(유튜브 쇼츠·인스타 릴스·블로그·인스타+페이스북 게시물·인스타+페이스북 스토리) 브랜드마다,
// 규칙 'n일마다'(요일 대신)·같은 글 함께 올릴 채널(cross_channels)·종류 shorts/story, 유튜브·스레드 '준비 중' 사유 한 줄
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql, brand;
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
