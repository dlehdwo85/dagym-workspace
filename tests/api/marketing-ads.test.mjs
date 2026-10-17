// V41 4-2 광고 성과 읽기(회사별 직접 연결): 네이버 검색광고 라이선스(서명 요청·틀린 키 400·비밀값 미노출·암호화 보관)·Meta·Google OAuth(가짜 서버)·
// 최근 7일 캠페인×날짜 덮어쓰기·합계·관리자만 연결·미배정 404·연결 끊기 = 성과도 삭제
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const PORT = 3218;
let srv, ctx, sql, fake, hits = [];
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
before(async () => {
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    hits.push({ path: u.pathname, q: Object.fromEntries(u.searchParams), h: req.headers, body });
    res.setHeader('content-type', 'application/json');
    const send = (code, j) => { res.statusCode = code; res.end(JSON.stringify(j)); };
    if (u.pathname.startsWith('/naver/')) {
      const path = u.pathname.slice('/naver'.length);
      const sig = createHmac('sha256', 'naver-secret-key-xyz').update(`${req.headers['x-timestamp']}.GET.${path}`).digest('base64');
      if (req.headers['x-signature'] !== sig || req.headers['x-api-key'] !== 'naver-license-abc' || req.headers['x-customer'] !== '1234567') return send(403, { title: 'Forbidden', code: 1018 });
      if (path === '/ncc/campaigns') return send(200, [{ nccCampaignId: 'cmp-a', name: '파워링크 본점' }]);
      if (path === '/stats') { const day = JSON.parse(u.searchParams.get('timeRange')).since; return send(200, { data: day === today ? [{ id: 'cmp-a', impCnt: 1000, clkCnt: 50, salesAmt: 25000, ccnt: 2 }] : [] }); }
    }
    if (u.pathname === '/graph/oauth/access_token') return send(200, { access_token: u.searchParams.get('grant_type') ? 'meta-long' : 'meta-short' });
    if (u.pathname === '/graph/me/adaccounts') return send(200, { data: [{ account_id: '998877', name: '우리 메타 광고' }] });
    if (u.pathname === '/graph/act_998877/insights') return send(200, { data: [{ date_start: today, campaign_id: '55', campaign_name: '가을 리드', impressions: '2000', clicks: '40', spend: '30000', account_currency: 'KRW', actions: [{ action_type: 'lead', value: '3' }, { action_type: 'link_click', value: '40' }] }] });
    if (u.pathname === '/goauth/token') return send(200, { access_token: 'g-access', refresh_token: 'g-refresh', expires_in: 3600 });
    if (u.pathname === '/gads/customers:listAccessibleCustomers') return send(200, { resourceNames: ['customers/1112223333'] });
    if (u.pathname === '/gads/customers/1112223333/googleAds:search') return send(200, { results: [{ segments: { date: today }, campaign: { id: '77', name: '검색 캠페인' }, metrics: { impressions: '500', clicks: '10', costMicros: '12000000000', conversions: 1.5 }, customer: { currencyCode: 'KRW' } }] });
    send(404, { error: { message: 'nope' } });
  }).listen(PORT);
  await resetDb();
  srv = await startServer({ ADS_TEST_BASE: `http://localhost:${PORT}`, META_APP_ID: 'meta-app', META_APP_SECRET: 'meta-secret', GOOGLE_ADS_DEVELOPER_TOKEN: 'dev-token', GOOGLE_ADS_CLIENT_ID: 'g-id', GOOGLE_ADS_CLIENT_SECRET: 'g-secret' });
  sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('네이버 라이선스 연결·읽기·합계·권한', async () => {
  assert.equal((await ctx.owner.req('GET', '/api/marketing/ads')).status, 404, '마케팅 공간 꺼짐');
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  const bad = await ctx.owner.req('POST', '/api/marketing/ads/accounts', { label: '본점', customerId: '1234567', apiKey: 'naver-license-abc', secretKey: 'wrong-secret-0000' });
  assert.equal(bad.status, 400, '틀린 비밀키는 저장 안 함');
  assert.equal((await sql`select count(*)::int n from mkt_ad_accounts`)[0].n, 0);
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/ads/accounts', { label: '본점', customerId: '1234567', apiKey: 'naver-license-abc', secretKey: 'naver-secret-key-xyz' })).status, 403, '직원은 연결 못 함');
  const r = await ctx.owner.ok('POST', '/api/marketing/ads/accounts', { label: '본점', customerId: '1234567', apiKey: 'naver-license-abc', secretKey: 'naver-secret-key-xyz' });
  assert.equal(r.sync.rows, 1, JSON.stringify(r));
  const [row] = await sql`select secret_enc from mkt_ad_accounts where id = ${r.id}`;
  assert.ok(row.secret_enc.startsWith('v1.') && !row.secret_enc.includes('naver-secret'), '암호화 보관');
  assert.equal(hits.filter((h) => h.path === '/naver/stats').length, 7, '최근 7일 하루씩');
  const ov = await ctx.staffA.client.ok('GET', '/api/marketing/ads?days=7');
  assert.deepEqual([ov.totals.impressions, ov.totals.clicks, ov.totals.cost, ov.totals.conversions], [1000, 50, 25000, 2]);
  assert.equal(ov.campaigns[0].campaign_name, '파워링크 본점'); assert.equal(ov.canEdit, false); assert.equal(ov.callbacks, null, '직원은 콜백 주소 없음');
  assert.match((await ctx.owner.ok('GET', '/api/marketing/ads')).callbacks.google, /\/api\/marketing\/ads\/callback\/google$/);
  assert.ok(!JSON.stringify(ov).includes('naver-secret') && !JSON.stringify(ov).includes('naver-license'), '비밀값 미노출');
  // 다시 읽어도 덮어쓰기(중복 없음)
  await ctx.owner.ok('POST', '/api/marketing/ads/sync', {});
  assert.equal((await sql`select count(*)::int n from mkt_ad_stats`)[0].n, 1);
  assert.equal((await ctx.staffB.client.req('GET', '/api/marketing/ads')).status, 404, '미배정 직원');
});

test('Meta·Google OAuth 연결 → 계정 등록·성과', async () => {
  const go = await ctx.owner.get('/api/marketing/ads/connect/meta');
  assert.equal(go.status, 302);
  const loc = new URL(go.headers.get('location'));
  assert.equal(loc.pathname, '/fbdialog'); assert.equal(loc.searchParams.get('scope'), 'ads_read');
  assert.equal((await ctx.staffA.client.get('/api/marketing/ads/connect/meta')).status, 403, '직원은 연결 못 함');
  const bad = await ctx.owner.get('/api/marketing/ads/callback/meta?code=c&state=wrong');
  assert.match(bad.headers.get('location'), /error=/);
  const cb = await ctx.owner.get(`/api/marketing/ads/callback/meta?code=c1&state=${loc.searchParams.get('state')}`);
  assert.match(cb.headers.get('location'), /\/s\/marketing\/ads\?connected=meta&count=1/);
  const g = new URL((await ctx.owner.get('/api/marketing/ads/connect/google')).headers.get('location'));
  assert.equal(g.searchParams.get('access_type'), 'offline');
  const gcb = await ctx.owner.get(`/api/marketing/ads/callback/google?code=g1&state=${g.searchParams.get('state')}`);
  assert.match(gcb.headers.get('location'), /connected=google&count=1/);
  assert.equal(hits.find((h) => h.path.endsWith('googleAds:search')).h['developer-token'], 'dev-token');
  const ov = await ctx.owner.ok('GET', '/api/marketing/ads?days=7');
  assert.equal(ov.accounts.length, 3);
  const by = Object.fromEntries(ov.campaigns.map((c) => [c.campaign_name, c]));
  assert.equal(by['가을 리드'].conversions, 3, 'Meta 전환 = 리드만(링크 클릭 제외)');
  assert.equal(by['검색 캠페인'].cost, 12000, 'Google 비용 = micros / 1,000,000');
  assert.equal(ov.totals.cost, 25000 + 30000 + 12000);
  // 연결 끊기 = 성과도 삭제
  const meta = ov.accounts.find((a) => a.provider === 'meta');
  await ctx.owner.ok('DELETE', `/api/marketing/ads/accounts/${meta.id}`);
  assert.equal((await sql`select count(*)::int n from mkt_ad_stats where account_id = ${meta.id}`)[0].n, 0);
});
