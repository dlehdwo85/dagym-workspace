// 363차 #981(대표 11/05 B4): 서버 광고 점검 — 매일 이상 알림(키워드 비용·문의 0 → 입찰가 내림 / n번 연속 → 중지 · 사업별 하루 비용이 하루 계획의 n배 · 회사 누적 상한 n%) + 월요일 주간 보고
// 기준 5개·사업별 월 계획은 화면(API)에서 고침 · 관리자만 · 다른 회사 브랜드 id 무시 · 하루 한 번·주 한 번·달 한 번 · 입찰가·켜기/끄기는 바꾸지 않음
// 광고 성과는 DB 에 직접 넣음(매체 연동 = 구조 시험), 메일은 가짜 발송 서버
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { addDays, bootstrap, resetDb, seoulToday, startServer, testDb, tick } from '../helpers.mjs';

const RESEND_PORT = 3363;
let srv, sql, ctx, mailSrv, acc, H, B, other;
const mails = [];
const today = seoulToday(); const yday = addDays(today, -1);
const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; const monday = addDays(today, -dow); const lastWed = addDays(monday, -5);
const notifs = (re) => sql`select title, body, link from notifications where user_id = ${ctx.ownerId} and title ~ ${re} order by created_at`;

before(async () => {
  mailSrv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { mails.push(JSON.parse(b)); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: `re_${mails.length}` })); }); }).listen(RESEND_PORT);
  await resetDb();
  srv = await startServer({ AD_WATCH: 'any', RESEND_API_KEY: 're_test_key', MAIL_FROM: '워크인 <no-reply@mail.work-in.test>', RESEND_API_BASE: `http://localhost:${RESEND_PORT}` });
  sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  [H, B] = (await sql`insert into mkt_brands (tenant, name) values ('default', '하이링크'), ('default', '바디랩 두정점') returning id`).map((r) => r.id);
  await sql`insert into tenants (id, name) values ('t_aw363', '남의 회사') on conflict do nothing`;
  other = (await sql`insert into mkt_brands (tenant, name) values ('t_aw363', '남의 브랜드') returning id`)[0].id;
  acc = (await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, status, last_sync_at) values ('default', 'naver', '7777777', '다짐·하이링크', 'active', now()) returning id`)[0].id;
  // 캠페인 성과(사업 = 캠페인 이름): 어제 하이링크 15,000(하루 계획 200,000 ÷ 그 달 날 수 × 1.5 보다 큼) · 바디랩 3,000 · 지난주 수요일 하이링크 7,000 · 오늘 10,000(월 상한 % 용)
  const stat = (day, cid, name, cost, clicks) => sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, impressions, clicks, cost_krw) values (${acc}, ${day}, ${cid}, ${name}, ${clicks * 30}, ${clicks}, ${cost})
    on conflict (account_id, day, campaign_id) do update set cost_krw = mkt_ad_stats.cost_krw + excluded.cost_krw, clicks = mkt_ad_stats.clicks + excluded.clicks`;
  await stat(yday, 'cmp-h', '하이링크_아파트플랫폼', 15000, 40);
  await stat(yday, 'cmp-b', '바디랩 두정점 플레이스', 3000, 12);
  await stat(lastWed, 'cmp-h', '하이링크_아파트플랫폼', 7000, 30);
  await stat(today, 'cmp-h', '하이링크_아파트플랫폼', 10000, 20);
  // 키워드 성과: k1 이번 7일 12,000·그 앞 7일 11,000(문의 0 → 2번 연속 → 중지 제안) · k2 이번 7일만 15,000(입찰가 내림) · k3 5,000(기준 아래) · k4 20,000 이지만 광고 전화 1건(문의 있음)
  const kw = (day, id, name, cost) => sql`insert into mkt_ad_items (account_id, day, kind, item_id, item_name, campaign_id, campaign_name, impressions, clicks, cost_krw) values (${acc}, ${day}, 'keyword', ${id}, ${name}, 'cmp-h', '하이링크_아파트플랫폼', 500, 20, ${cost})`;
  await kw(yday, 'nkw-1', '관리사무소 앱', 12000); await kw(addDays(yday, -8), 'nkw-1', '관리사무소 앱', 11000);
  await kw(addDays(yday, -2), 'nkw-2', '아파트 출입', 15000);
  await kw(yday, 'nkw-3', '커뮤니티 예약', 5000);
  await kw(yday, 'nkw-4', '헬스장 위탁', 20000);
  const call = (at, o = {}) => sql`insert into mkt_calls (tenant, phone, created_by, ad_keyword, ad_provider, brand_id, called_at) values ('default', '010-0000-0000', ${ctx.ownerId}, ${o.kw ?? null}, ${o.kw ? 'naver' : null}, ${o.brand ?? null}, ${at}::timestamptz)`;
  await call(`${yday}T11:00:00+09:00`, { kw: '헬스장 위탁' });
  await call(`${yday}T12:00:00+09:00`); await call(`${yday}T13:00:00+09:00`); // 광고 키워드를 모르는 전화 2건 → 추적 33% → '문의 0 확인 필요' 문장
  await call(`${lastWed}T10:00:00+09:00`, { brand: H });
  await sql`insert into inquiries (tenant, lead_id, site, inquiry_type, organization, payload, created_at) values ('default', 'aw363-1', 'hilink', 'demo', '시험 단지', '{}', ${`${lastWed}T15:00:00+09:00`}::timestamptz)`;
  await ctx.owner.ok('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 12000 });
});
after(async () => { srv?.proc.kill(); mailSrv?.close(); await sql?.end(); });

describe('363차 서버 광고 점검', () => {
  test('처음 값(AD_BUDGET_PLAN 8번) · 관리자만 고침 · 범위 밖 400 · 다른 회사 브랜드 무시 · 화면 키워드 표(leadsReport)는 그대로', async () => {
    const v0 = await ctx.owner.ok('GET', '/api/marketing/ad-ops/watch');
    assert.deepEqual([v0.settings.kwCost, v0.settings.kwDays, v0.settings.pauseWeeks, v0.settings.dayRatio, v0.settings.capPct], [10000, 7, 2, 1.5, 80]);
    assert.equal(v0.settings.enabled, true, '워크인 운영 회사는 마이그레이션 249 가 켠 채로 만듦');
    assert.equal(v0.canEdit, true);
    const st = await ctx.staffA.client.ok('GET', '/api/marketing/ad-ops/watch');
    assert.equal(st.canEdit, false);
    assert.equal((await ctx.staffA.client.req('PUT', '/api/marketing/ad-ops/watch', { kwCost: 5000 })).status, 403);
    assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/ad-ops/watch', { action: 'daily' })).status, 403);
    assert.equal((await ctx.owner.req('PUT', '/api/marketing/ad-ops/watch', { kwDays: 2 })).status, 400);
    const r = await ctx.owner.ok('PUT', '/api/marketing/ad-ops/watch', { brandPlans: { [H]: 200000, [B]: 100000, [other]: 50000 } });
    assert.deepEqual(r.settings.brandPlans, { [H]: 200000, [B]: 100000 }, '남의 회사 브랜드 id 는 무시');
    const L = await ctx.owner.ok('GET', '/api/marketing/ad-ops/leads?days=7');
    assert.equal(L.days, 7); assert.ok(L.rows.some((x) => x.keyword === '관리사무소 앱'));
  });

  test('지금 숫자로 점검: 2번 연속 → 중지 제안 · 이번 7일만 → 입찰가 내림 · 기준 아래·문의 있는 키워드 빠짐 · 사업별 하루 비용 · 월 상한 % · 추적 덜 됨 문장', async () => {
    const v = await ctx.owner.ok('GET', '/api/marketing/ad-ops/watch');
    const f = v.live.findings; const by = (k) => f.filter((x) => x.kind === k);
    assert.deepEqual(by('kw_pause').map((x) => x.title), ['중지 제안: 관리사무소 앱 (하이링크_아파트플랫폼)']);
    assert.match(by('kw_pause')[0].detail, /7일 비용 12,000원 · 클릭 20 · 문의·신청 0 — 7일씩 2번 연속/);
    assert.deepEqual(by('kw_bid_down').map((x) => x.title), ['입찰가 내림 제안: 아파트 출입 (하이링크_아파트플랫폼)']);
    assert.ok(!f.some((x) => /커뮤니티 예약|헬스장 위탁/.test(x.title)), '기준 아래·문의 있는 키워드는 안 걸림');
    assert.deepEqual(by('brand_day').map((x) => x.brandId), [H], '하이링크만(바디랩 3,000원은 하루 계획 1.5배 아래)');
    assert.match(by('brand_day')[0].detail, /15,000원 — 하루 계획 [\d,]+원의 [\d.]+배\(기준 1\.5배\)/);
    assert.equal(by('cap').length, 1); assert.match(by('cap')[0].title, /^월 광고비 상한 80% 넘음/);
    assert.ok(v.live.caveat && /문의 0이 실제로 0인지 모르니/.test(v.live.caveat), v.live.caveat);
    const h = v.live.brands.find((b) => b.brandId === H);
    assert.equal(h.yesterday, 15000); assert.equal(h.plan, 200000);
    // 기준을 바꾸면 결과도 바뀜: 연속 1번이면 둘 다 중지 제안, 비용 기준 13,000 이면 k1(12,000) 빠짐
    await ctx.owner.ok('PUT', '/api/marketing/ad-ops/watch', { kwCost: 13000, pauseWeeks: 1 });
    const v2 = await ctx.owner.ok('GET', '/api/marketing/ad-ops/watch');
    assert.deepEqual(v2.live.findings.filter((x) => x.kind.startsWith('kw_')).map((x) => x.title), ['중지 제안: 아파트 출입 (하이링크_아파트플랫폼)']);
    await ctx.owner.ok('PUT', '/api/marketing/ad-ops/watch', { kwCost: 10000, pauseWeeks: 2 });
  });

  test('정기 실행: 대표에게 알림 1건 + 상한 % 알림·메일(달 한 번) + 주간 보고 알림·메일 — 두 번째 실행은 다시 안 보냄 · 바꾼 것 없음', async () => {
    const before = mails.length;
    await tick();
    const d = await notifs('^광고 점검: ');
    assert.equal(d.length, 1);
    assert.match(d[0].title, /^광고 점검: 확인할 것 3건 \(\d+\/\d+\)$/);
    assert.match(d[0].body, /입찰가·켜기\/끄기는 바꾸지 않았습니다/); assert.match(d[0].body, /문의 추적이 덜 돼/);
    assert.equal(d[0].link, '/s/marketing/ad-ops#ad-watch');
    assert.equal((await notifs('^월 광고비 상한 80% 넘음')).length, 1);
    const w = await notifs('^광고 주간 보고 ');
    assert.equal(w.length, 1); assert.match(w[0].title, /광고비 [\d,]+원 · 문의·신청 \d+건/);
    const got = mails.slice(before);
    assert.equal(got.filter((m) => /월 광고비 상한 80% 넘음/.test(m.subject)).length, 1);
    const wm = got.filter((m) => /광고 주간 보고/.test(m.subject));
    assert.equal(wm.length, 1); assert.match(wm[0].html, /<table/); assert.match(wm[0].text, /하이링크 \| /);
    const v = await ctx.owner.ok('GET', '/api/marketing/ad-ops/watch');
    const hw = v.lastWeekly.rows.find((r) => r.brandId === H);
    assert.ok(hw.cost >= 7000 && hw.calls >= 1 && hw.inquiries === 1, JSON.stringify(hw));
    assert.equal(hw.cpa, Math.round(hw.cost / hw.leads));
    assert.equal(v.dailyOn, today); assert.ok(v.lastDaily && v.lastDaily.findings.length >= 3);
    await tick();
    assert.equal((await notifs('^광고 점검: ')).length, 1, '하루 한 번');
    assert.equal((await notifs('^광고 주간 보고 ')).length, 1, '주 한 번');
    assert.equal(mails.slice(before).filter((m) => /광고 주간 보고|월 광고비 상한 80%/.test(m.subject)).length, 2, '메일도 다시 안 감');
    const n = await ctx.owner.ok('POST', '/api/marketing/ad-ops/watch', { action: 'daily' });
    assert.ok(n.findings >= 3);
    assert.equal((await notifs('^광고 점검: ')).length, 1, '[지금 점검 보내기]도 같은 날은 알림 한 번');
    assert.equal((await sql`select count(*)::int n from mkt_ad_changes where tenant = 'default'`)[0].n, 0, '입찰가·켜기/끄기 변경 기록 없음');
  });

  test('끄면 정기 실행이 건너뜀 · 행이 없는 회사는 꺼짐으로 보임', async () => {
    await ctx.owner.ok('PUT', '/api/marketing/ad-ops/watch', { enabled: false });
    await sql`update mkt_ad_watch set daily_on = null where tenant = 'default'`;
    const r = await tick();
    const v = await ctx.owner.ok('GET', '/api/marketing/ad-ops/watch');
    assert.equal(v.settings.enabled, false); assert.equal(v.dailyOn, null, '꺼져 있으면 점검하지 않음');
    assert.ok(r);
    await sql`delete from mkt_ad_watch where tenant = 'default'`;
    const v2 = await ctx.owner.ok('GET', '/api/marketing/ad-ops/watch');
    assert.equal(v2.settings.exists, false); assert.equal(v2.settings.enabled, false);
    await ctx.owner.ok('PUT', '/api/marketing/ad-ops/watch', { kwCost: 20000 });
    const v3 = await ctx.owner.ok('GET', '/api/marketing/ad-ops/watch');
    assert.equal(v3.settings.enabled, true, '처음 저장하면 켜진 채로 만듦'); assert.equal(v3.settings.kwCost, 20000);
  });
});
