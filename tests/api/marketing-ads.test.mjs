// V41 4-2 광고 성과 읽기(회사별 직접 연결): 네이버 검색광고 라이선스(서명 요청·틀린 키 400·비밀값 미노출·암호화 보관)·Meta·Google OAuth(가짜 서버)·
// 최근 7일 캠페인×날짜 덮어쓰기·합계·관리자만 연결·미배정 404·연결 끊기 = 성과도 삭제
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const PORT = 3218;
let srv, ctx, sql, fake, hits = [], gads403 = false;
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
    if (u.pathname === '/graph/me') return send(200, { id: 'fb-user-77' });
    if (u.pathname === '/graph/me/permissions') return send(200, { data: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish', 'business_management'].map((permission) => ({ permission, status: 'granted' })) });
    if (u.pathname === '/graph/me/accounts') return send(200, { data: [
      { id: 'page-1', name: '다짐 본점', access_token: 'page-token-secret-1', tasks: ['MANAGE', 'CREATE_CONTENT'], instagram_business_account: { id: 'ig-1', username: 'dagym_main' } },
      { id: 'page-2', name: '다짐 2호점', access_token: 'page-token-secret-2', tasks: ['ANALYZE'] }] });
    if (u.pathname === '/graph/me/adaccounts') return send(200, { data: [{ account_id: '998877', name: '우리 메타 광고' }] });
    if (u.pathname === '/graph/act_998877/insights') return send(200, { data: [{ date_start: today, campaign_id: '55', campaign_name: '가을 리드', impressions: '2000', clicks: '40', spend: '30000', account_currency: 'KRW', actions: [{ action_type: 'lead', value: '3' }, { action_type: 'link_click', value: '40' }] }] });
    if (u.pathname === '/goauth/token') return send(200, { access_token: 'g-access', refresh_token: 'g-refresh', expires_in: 3600 });
    // 종료된 버전(v24·v23 가정)은 구글처럼 HTML 404 → 수집기가 다음 버전을 찾아야 함
    if (/^\/gads\/v2[34]\//.test(u.pathname)) { res.setHeader('content-type', 'text/html'); res.statusCode = 404; return res.end('<!DOCTYPE html><html>Error 404 (Not Found)!!1</html>'); }
    if (u.pathname.startsWith('/gads/')) u.pathname = u.pathname.replace(/^\/gads\/v\d+/, '/gads');
    if (u.pathname === '/gads/customers:listAccessibleCustomers') return send(200, { resourceNames: ['customers/1112223333'] });
    if (u.pathname === '/gads/customers/1112223333/googleAds:search' && gads403) return send(403, { error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED',
      details: [{ '@type': 'type.googleapis.com/google.ads.googleads.v22.errors.GoogleAdsFailure', errors: [{ errorCode: { authorizationError: 'DEVELOPER_TOKEN_NOT_APPROVED' }, message: 'The developer token is only approved for use with test accounts.' }] }] } });
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
  await sql`update users set platform_admin = false where id = ${ctx.ownerId}`;
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/ads')).callbacks, null, '플랫폼 관리자가 아닌 회사 관리자에게는 콘솔 값 숨김');
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
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
  assert.match(cb.headers.get('location'), /\/s\/marketing\/connections\?connected=meta&count=1/);
  const g = new URL((await ctx.owner.get('/api/marketing/ads/connect/google')).headers.get('location'));
  assert.equal(g.searchParams.get('access_type'), 'offline');
  const gcb = await ctx.owner.get(`/api/marketing/ads/callback/google?code=g1&state=${g.searchParams.get('state')}`);
  assert.match(gcb.headers.get('location'), /connected=google&count=1/);
  assert.equal(hits.find((h) => h.path.endsWith('googleAds:search')).h['developer-token'], 'dev-token');
  assert.match(hits.find((h) => h.path.endsWith('googleAds:search')).path, /^\/gads\/v22\//, '종료 버전(HTML 404)을 건너뛰고 v22 사용');
  const ov = await ctx.owner.ok('GET', '/api/marketing/ads?days=7');
  assert.equal(ov.accounts.length, 3);
  const by = Object.fromEntries(ov.campaigns.map((c) => [c.campaign_name, c]));
  assert.equal(by['가을 리드'].conversions, 3, 'Meta 전환 = 리드만(링크 클릭 제외)');
  assert.equal(by['검색 캠페인'].cost, 12000, 'Google 비용 = micros / 1,000,000');
  assert.equal(ov.totals.cost, 25000 + 30000 + 12000);
  // 로컬 검수 10/19: Google 403 은 오류 상세(errorCode 종류=값)와 원인 안내를 계정 줄에 남김
  gads403 = true;
  await ctx.owner.ok('POST', '/api/marketing/ads/sync', {});
  gads403 = false;
  const [gerr] = await sql`select status, last_error from mkt_ad_accounts where provider = 'google'`;
  assert.match(gerr.last_error ?? '', /authorizationError=DEVELOPER_TOKEN_NOT_APPROVED/, JSON.stringify(gerr));
  assert.match(gerr.last_error, /기본\(Basic\) 액세스/);
  // 연결 끊기 = 성과도 삭제
  const meta = ov.accounts.find((a) => a.provider === 'meta');
  await ctx.owner.ok('DELETE', `/api/marketing/ads/accounts/${meta.id}`);
  assert.equal((await sql`select count(*)::int n from mkt_ad_stats where account_id = ${meta.id}`)[0].n, 0);
});

test('게시 채널: 켜기/끄기·Meta [연결](페이지+인스타)·점검 안내·토큰 비노출·끊기·데이터 삭제 콜백', async () => {
  const ch = await ctx.staffA.client.ok('GET', '/api/marketing/publish/channels');
  assert.equal(ch.canEdit, false); assert.equal(ch.tech, null);
  const ig0 = ch.channels.find((c) => c.key === 'instagram');
  assert.deepEqual([ig0.enabled, ig0.mode, ig0.ready], [true, 'helper', true], '심사 전에는 도우미');
  assert.equal(ch.channels.find((c) => c.key === 'threads').enabled, false);
  assert.equal((await ctx.staffA.client.req('PUT', '/api/marketing/publish/channels', { channel: 'threads', enabled: true })).status, 403);
  await ctx.owner.ok('PUT', '/api/marketing/publish/channels', { channel: 'threads', enabled: true });
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/publish/channels')).channels.find((c) => c.key === 'threads').enabled, true);
  assert.equal((await ctx.staffA.client.get('/api/marketing/publish/connect/meta')).status, 403, '직원은 연결 못 함');
  const go = new URL((await ctx.owner.get('/api/marketing/publish/connect/meta')).headers.get('location'));
  assert.match(go.searchParams.get('scope'), /instagram_content_publish/);
  assert.match(go.searchParams.get('redirect_uri'), /\/api\/marketing\/publish\/callback\/meta$/);
  const cb = await ctx.owner.get(`/api/marketing/publish/callback/meta?code=p1&state=${go.searchParams.get('state')}`);
  assert.match(cb.headers.get('location'), /published=meta&pages=2&ig=1&warn=2/);
  const rows = await sql`select provider, external_id, token_enc, owner_ext_id, info from mkt_publish_accounts order by provider, external_id`;
  assert.deepEqual(rows.map((r) => `${r.provider}:${r.external_id}`), ['meta_fb:page-1', 'meta_fb:page-2', 'meta_ig:ig-1']);
  assert.ok(rows.every((r) => r.token_enc.startsWith('v1.') && !r.token_enc.includes('page-token')), '토큰 암호화');
  await sql`update users set platform_admin = false where id = ${ctx.ownerId}`;
  const ch2 = await ctx.owner.ok('GET', '/api/marketing/publish/channels');
  assert.ok(!JSON.stringify(ch2).includes('page-token'), '토큰 비노출');
  const fb = ch2.channels.find((c) => c.key === 'facebook');
  const p2 = fb.accounts.find((a) => a.label === '다짐 2호점');
  assert.equal(p2.warnings.length, 2, '관리자 아님 + 인스타 없음'); assert.match(p2.warnings.join(), /관리자/); assert.match(p2.warnings.join(), /비즈니스/);
  assert.equal(fb.accounts.find((a) => a.label === '다짐 본점').warnings.length, 0);
  assert.equal(ch2.channels.find((c) => c.key === 'instagram').accounts[0].label, '@dagym_main');
  assert.equal(ch2.tech, null, '회사 관리자에게도 기술 값 숨김');
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  assert.match((await ctx.owner.ok('GET', '/api/marketing/publish/channels')).tech.metaDeletion, /\/api\/marketing\/publish\/meta\/data-deletion$/);
  // 끊기 = 토큰 삭제
  await ctx.owner.ok('DELETE', `/api/marketing/publish/accounts/${p2.id}`);
  assert.equal((await sql`select count(*)::int n from mkt_publish_accounts where external_id = 'page-2'`)[0].n, 0);
  // Meta 데이터 삭제 콜백: 서명 틀리면 400, 맞으면 그 사용자 연결 전부 삭제
  const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const payload = b64(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: 'fb-user-77' }));
  const post = (sr) => fetch(`${BASE}/api/marketing/publish/meta/data-deletion`, { method: 'POST', body: new URLSearchParams({ signed_request: sr }) });
  assert.equal((await post(`${b64('bad')}.${payload}`)).status, 400);
  const ok = await post(`${b64(createHmac('sha256', 'meta-secret').update(payload).digest())}.${payload}`);
  assert.equal(ok.status, 200); const j = await ok.json();
  assert.ok(j.confirmation_code && j.url.includes(j.confirmation_code));
  assert.equal((await sql`select count(*)::int n from mkt_publish_accounts`)[0].n, 0);
});

