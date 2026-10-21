// 대표 10/20 14:10 마케팅 디벨롭 5건(#98): ② 승인함 예정(초안) 묶음 ③ 광고 성과 브랜드·매체 필터·이전 기간 대비·캠페인 추이 ④ 주간 운영 제안 → 승인 → 항목별 업무 ① 사이트별 집계(비콘 → 주간 표·요약)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql; const today = seoulToday();
const ago = (n) => addDays(today, -n); // #148: 서버와 같은 KST 날짜(UTC 날짜를 쓰면 KST 00~09시에 하루 어긋남)
let brandA, brandB, accA, accB;
before(async () => {
  await resetDb(); srv = await startServer({ MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  brandA = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '하이링크' })).id ?? (await sql`select id from mkt_brands where name = '하이링크'`)[0].id;
  brandB = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다짐' })).id ?? (await sql`select id from mkt_brands where name = '다짐'`)[0].id;
  accA = (await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, brand_id, created_by) values ('default', 'naver', '1001', '하이링크 네이버', ${brandA}, ${ctx.ownerId}) returning id`)[0].id;
  accB = (await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, brand_id, created_by) values ('default', 'google', '2002', '다짐 구글', ${brandB}, ${ctx.ownerId}) returning id`)[0].id;
  for (let i = 0; i < 14; i++) {
    const day = ago(i); const recent = i < 7;
    await sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, impressions, clicks, cost_krw) values (${accA}, ${day}, 'c-good', '하이링크 파워링크', 2000, 100, ${recent ? 30000 : 20000})`;
    await sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, impressions, clicks, cost_krw) values (${accA}, ${day}, 'c-pricey', '하이링크 브랜드검색', 3000, 20, 40000)`; // CPC 2,000 vs 평균 ↑
    await sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, impressions, clicks, cost_krw) values (${accB}, ${day}, 'g-1', '다짐 검색', 5000, 50, 10000)`;
  }
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('③ 광고 성과: 브랜드·매체 필터 · 일 모드 이전 기간 대비 · 매체별 표 · 캠페인 추이 · 브랜드 목록', async () => {
  const all = await ctx.owner.ok('GET', '/api/marketing/ads?days=7');
  assert.equal(all.totals.clicks, 7 * 170); assert.ok(all.prev && all.prev.clicks === 7 * 170 && all.prevFrom && all.prevTo, '이전 7일');
  assert.equal(all.byProvider.length, 2); assert.equal(all.brands.length, 2);
  assert.ok(all.campaignDaily.length >= 7 * 3, '상위 캠페인 날짜별'); assert.ok(all.campaignDaily.every((r) => r.day && typeof r.cost === 'number'));
  const a = await ctx.owner.ok('GET', `/api/marketing/ads?days=7&brand=${brandA}`);
  assert.equal(a.totals.clicks, 7 * 120); assert.deepEqual(a.filter, { brand: brandA, provider: '' }); assert.ok(a.campaigns.every((c) => c.account_id === accA));
  const g = await ctx.owner.ok('GET', '/api/marketing/ads?days=7&provider=google');
  assert.equal(g.totals.clicks, 7 * 50); assert.equal(g.byProvider.length, 1); assert.equal(g.byProvider[0].provider, 'google');
  const none = await ctx.owner.ok('GET', '/api/marketing/ads?days=7&brand=none'); assert.equal(none.totals.clicks, 0);
  const m = await ctx.owner.ok('GET', `/api/marketing/ads?month=${today.slice(0, 7)}&provider=naver`); assert.ok(m.byBrand.length >= 1); assert.ok(m.byProvider.every((r) => r.provider === 'naver'));
});

test('④ 주간 운영 제안: 단가 조정(CPC 1.3배 이상)·방향·협업 항목 → 승인 → 항목마다 업무 · 6일 안 중복 없음 · 직원 403', async () => {
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/ops/weekly', {})).status, 403);
  const w = await ctx.owner.ok('POST', '/api/marketing/ops/weekly', {});
  assert.equal(w.created, 1); assert.ok(w.items >= 3, JSON.stringify(w));
  const [p] = await sql`select * from mkt_proposals where id = ${w.id}`;
  assert.equal(p.kind, 'weekly'); const titles = p.body.items.map((i) => i.title);
  assert.ok(titles.some((t) => t.includes('단가 조정') && t.includes('브랜드검색')), titles.join(' | '));
  assert.ok(titles.some((t) => t.startsWith('방향:')) && titles.some((t) => t.includes('협업')));
  assert.equal((await ctx.owner.ok('POST', '/api/marketing/ops/weekly', {})).skipped, 'recent');
  const r = await ctx.owner.ok('PATCH', `/api/marketing/ops/proposals/${w.id}`, { action: 'approve' });
  assert.equal(r.status, 'approved'); assert.equal(r.executed.tasks.length, Math.min(6, p.body.items.length), JSON.stringify(r.executed));
  const [t] = await sql`select title, tags from tasks where id = ${r.executed.tasks[0]}`; assert.match(t.title, /^\[마케팅 주간\]/); assert.ok(t.tags.includes('주간 운영'));
});

test('② 승인함: 예정(초안, 미래 예정)만 승인함 목록에 포함 · 과거 초안 제외', async () => {
  const fut = new Date(Date.now() + 3 * 864e5).toISOString(); const past = new Date(Date.now() - 3 * 864e5).toISOString();
  await sql`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, created_by) values ('default', ${brandA}, '예정 초안(미래)', 'instagram', ${fut}, 'draft', ${ctx.ownerId}), ('default', ${brandA}, '지난 초안', 'instagram', ${past}, 'draft', ${ctx.ownerId})`;
  const v = await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals');
  assert.ok(v.contents.some((c) => c.title === '예정 초안(미래)' && c.status === 'draft')); assert.ok(!v.contents.some((c) => c.title === '지난 초안'));
});

test('① 사이트별 집계: 비콘(연동 토큰, 다른 출처 CORS) → 방문·CTA 누적 → 주간 표(브랜드 매핑)·요약 · 토큰 없으면 401', async () => {
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  const tok = await ctx.owner.ok('POST', '/api/platform/inquiries/tokens', { site: 'hilink', name: '하이링크 웹' });
  const raw = tok.token ?? tok.raw ?? tok.value; assert.ok(raw, JSON.stringify(tok));
  const post = (q, b) => fetch(`${BASE}/api/public/site-event${q}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://www.hi-link.co.kr' }, body: JSON.stringify(b) });
  assert.equal((await post('', { event: 'visit' })).status, 401);
  assert.equal((await post('?k=wkin_nope', { event: 'visit' })).status, 401);
  for (let i = 0; i < 3; i++) assert.equal((await post(`?k=${raw}`, { event: 'visit', path: '/' })).status, 200);
  const r = await post(`?k=${raw}`, { event: 'cta', label: '전화' }); assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const pre = await fetch(`${BASE}/api/public/site-event`, { method: 'OPTIONS', headers: { origin: 'https://www.hi-link.co.kr' } }); assert.equal(pre.status, 204);
  const [ev] = await sql`select sum(n)::int n from mkt_site_events where tenant = 'default' and site = 'hilink' and event = 'visit'`; assert.equal(ev.n, 3);
  const v = await ctx.owner.ok('GET', '/api/marketing/sites?weeks=4');
  const row = v.rows.find((x) => x.name === '하이링크'); assert.ok(row && row.connected, JSON.stringify(v.rows.map((x) => x.name)));
  assert.equal(row.weeks.length, 4); assert.equal(row.weeks[0].visits, 3); assert.equal(row.weeks[0].cta, 1); assert.ok(row.weeks[0].adCost > 0, '광고비(브랜드 계정)');
  const dg = v.rows.find((x) => x.name === '다짐'); assert.equal(dg.connected, false); assert.equal(dg.weeks[0].visits, null);
  assert.ok(v.summary.some((s) => s.startsWith('하이링크: 방문 3')), v.summary.join('\n')); assert.ok(v.beaconUrl.endsWith('/api/public/site-event'));
  assert.equal((await ctx.staffA.client.req('GET', '/api/marketing/sites')).status, 200);
});
