// 360차(대표 #971·#974·#976): 가짜 메일·가짜 네이버 서버 = 구조 시험(실제 발송·실제 네이버 반영은 운영에서 확인)
// ① 정보통신망법 50조 광고성 정보 수신 동의: 가입 때 동의 → 처리 결과 메일 · 설정에서 끄기/켜기 → 처리 결과 메일(같은 값은 메일 없음)
//    · 2년 되기 30일 전 확인 안내(정기 실행, 한 번만) · 로그인 안 하면 401
// ② 워크인 체험 신청 → 광고 전환: 신청 utm·첫 광고 주소(n_keyword_id…)로 키워드 줄에 신청·승인·실사용, 캠페인별 건당 광고비, 광고 아닌 신청은 따로
// ③ 네이버 모든 캠페인 '자동 추적 URL' 켜기: 미리 보기(쓰기 없음) → 켜기(캠페인 전체를 읽은 값 + trackingMode, 필드 지정 없음) → 다시 읽어 확인 · 직원 403
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { Client, bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

const RESEND_PORT = 3361, NAVER_PORT = 3362;
let srv, sql, ctx, mailSrv, naver;
const mails = [];
let calls = [];
const agree = { terms: true, age14: true, privacy: true };
const RESULT = /광고성 정보 수신 동의 처리 결과/;
const mailTo = (to, re) => mails.filter((m) => [m.to].flat().some((x) => String(x).toLowerCase() === to.toLowerCase()) && re.test(m.subject)); // 초대 메일 주소는 소문자로 저장됨
const camps = {
  'cmp-a': { nccCampaignId: 'cmp-a', customerId: 1234567, name: '워크인 검색', campaignTp: 'WEB_SITE', dailyBudget: 1000, useDailyBudget: true, userLock: false, trackingMode: 'TRACKING_DISABLED' },
  'cmp-b': { nccCampaignId: 'cmp-b', customerId: 1234567, name: '하이링크 검색', campaignTp: 'WEB_SITE', dailyBudget: 2000, useDailyBudget: true, userLock: false, trackingMode: 'AUTO_TRACKING_MODE' },
  'cmp-c': { nccCampaignId: 'cmp-c', customerId: 1234567, name: '다짐 검색', campaignTp: 'WEB_SITE', dailyBudget: 1000, useDailyBudget: true, userLock: true, trackingMode: 'PASS_THROUGH_SITE_MODE' },
  'cmp-d': { nccCampaignId: 'cmp-d', customerId: 1234567, name: '바디랩 검색', campaignTp: 'WEB_SITE', dailyBudget: 1000, useDailyBudget: true, userLock: false },
};

before(async () => {
  mailSrv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { mails.push(JSON.parse(b)); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: `re_${mails.length}` })); }); }).listen(RESEND_PORT);
  naver = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const path = u.pathname.slice('/naver'.length);
    res.setHeader('content-type', 'application/json');
    const send = (code, j) => { res.statusCode = code; res.end(JSON.stringify(j)); };
    const sig = createHmac('sha256', 'naver-secret-key-xyz').update(`${req.headers['x-timestamp']}.${req.method}.${path}`).digest('base64');
    if (req.headers['x-signature'] !== sig || req.headers['x-customer'] !== '1234567') return send(403, { title: 'Forbidden', code: 1018 });
    const j = body ? JSON.parse(body) : null;
    calls.push({ method: req.method, path, fields: u.searchParams.get('fields'), body: j });
    if (req.method === 'GET' && path === '/stats') return send(200, { data: [] });
    if (req.method === 'GET' && path === '/ncc/campaigns') return send(200, Object.values(camps));
    const m = path.match(/^\/ncc\/campaigns\/([\w-]+)$/);
    if (m && req.method === 'GET') return camps[m[1]] ? send(200, camps[m[1]]) : send(404, { title: 'not found' });
    if (m && req.method === 'PUT') {
      // 공식 명세: fields 는 userLock·budget·period 만 — trackingMode 는 필드 지정 없이 캠페인 전체를 보내야 바뀜
      const c = camps[m[1]]; if (!c || j.nccCampaignId !== m[1]) return send(400, { title: 'bad' });
      if (u.searchParams.get('fields')) return send(400, { title: 'Invalid fields' });
      if (!j.name || j.dailyBudget !== c.dailyBudget || j.userLock !== c.userLock) return send(400, { title: 'Invalid campaign' });
      if (m[1] === 'cmp-d') return send(200, c); // 받아 놓고 반영 안 함(다시 읽어 '반영 안 됨'으로 잡아야 함)
      c.trackingMode = j.trackingMode; return send(200, c);
    }
    send(404, { title: 'nope' });
  }).listen(NAVER_PORT);
  await resetDb();
  srv = await startServer({ SIGNUP_APPROVAL: '1', PUBLIC_SIGNUP: '1', SIGNUP_IP_PER_DAY: '50', SIGNUP_IP_PER_HOUR: '50', RESEND_API_KEY: 're_test_key', MAIL_FROM: '워크인 <no-reply@mail.work-in.test>',
    RESEND_API_BASE: `http://localhost:${RESEND_PORT}`, ADS_TEST_BASE: `http://localhost:${NAVER_PORT}`, COMPANY_NAME: '시험회사' });
  sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
});
after(async () => { srv?.proc.kill(); mailSrv?.close(); naver?.close(); await sql?.end(); });

const signup = (c, email, extra = {}) => c.ok('POST', '/api/auth/signup', { email, name: '신청자', password: 'signup-pass-1234', mode: 'team', company: `${email.split('@')[0]} 상사`, size: '2-10', industry: '제조', agree, contact: '010 1234 5678', ...extra });
const tenantOfEmail = async (email) => (await sql`select tenant from users where email = ${email}`)[0].tenant;

describe('360차 광고성 정보 수신 동의(정보통신망법 50조)', () => {
  test('가입 때 동의 → 처리 결과 메일 · 동의 안 하면 메일 없음', async () => {
    await signup(new Client('mk1'), 'mk1@consent.test', { agree: { ...agree, marketing: true } });
    const [m] = mailTo('mk1@consent.test', RESULT);
    assert.ok(m, '처리 결과 메일');
    assert.match(m.text, /전송자: 시험회사\(워크인\)/); assert.match(m.text, /처리 일시: /); assert.match(m.text, /처리 결과: 수신 동의/);
    assert.match(m.text, /바꾸는 방법: 워크인 › 설정/); assert.match(m.text, /\/settings#marketing-consent/);
    const [n] = await sql`select reason, ok from consent_notices n join users u on u.id = n.user_id where u.email = 'mk1@consent.test'`;
    assert.deepEqual([n.reason, n.ok], ['result_agree', true]);
    await signup(new Client('mk2'), 'mk2@consent.test', { agree: { ...agree, marketing: false } });
    assert.equal(mailTo('mk2@consent.test', RESULT).length, 0, '동의 안 하면 처리 결과 메일 없음');
  });

  test('설정에서 끄기·켜기 → 처리 결과 메일 · 같은 값이면 메일 없음 · 직원도 바꿀 수 있음 · 로그인 없이 401', async () => {
    const a = ctx.staffA.client;
    assert.equal((await new Client().req('GET', '/api/account/marketing-consent')).status, 401);
    let st = await a.ok('GET', '/api/account/marketing-consent');
    assert.equal(st.agreed, false); assert.equal(st.at, null); assert.match(st.label, /광고성 정보/);
    assert.equal((await a.req('PUT', '/api/account/marketing-consent', { agreed: 'yes' })).status, 400);
    st = await a.ok('PUT', '/api/account/marketing-consent', { agreed: true });
    assert.equal(st.agreed, true); assert.equal(st.changed, true); assert.equal(st.mailed, true);
    assert.match(mailTo('staffA@dagym.test', RESULT).at(-1).text, /처리 결과: 수신 동의/);
    const before = mails.length;
    st = await a.ok('PUT', '/api/account/marketing-consent', { agreed: true });
    assert.equal(st.changed, false); assert.equal(mails.length, before, '같은 값은 메일 없음');
    st = await a.ok('PUT', '/api/account/marketing-consent', { agreed: false });
    assert.equal(st.agreed, false); assert.equal(st.changed, true);
    assert.match(mailTo('staffA@dagym.test', RESULT).at(-1).text, /처리 결과: 수신 거부/);
    const audits = await sql`select action from audit_logs where actor_id = ${ctx.staffA.id} and action like 'consent.%' order by created_at`;
    assert.deepEqual(audits.map((x) => x.action), ['consent.marketing_agree', 'consent.marketing_withdraw']);
    assert.deepEqual((await sql`select reason from consent_notices where user_id = ${ctx.staffA.id} order by id`).map((x) => x.reason), ['result_agree', 'result_withdraw']);
  });

  test('2년마다 확인: 동의한 지 1년 11개월 지난 사람에게 안내 1번(정기 실행) · 철회한 사람·최근 동의한 사람은 안 보냄', async () => {
    const b = ctx.staffB.client;
    await b.ok('PUT', '/api/account/marketing-consent', { agreed: true });
    await sql`update consents set created_at = now() - interval '2 years' + interval '20 days' where user_id = ${ctx.staffB.id} and kind = 'marketing'`;
    await sql`update consents set created_at = now() - interval '2 years' + interval '20 days' where user_id = ${ctx.staffA.id} and kind = 'marketing'`; // 철회한 사람
    const RE = /수신 동의 확인 안내\(2년마다\)/;
    // 14일 안 보장: 360차 배포 전(처리 결과 메일 없이) 사흘 전에 동의한 사람 → 정기 실행이 보냄(처리 일시 = 동의한 때)
    const [{ version }] = await sql`select version from consents where user_id = ${ctx.staffB.id} and kind = 'marketing' limit 1`;
    await sql`insert into consents (user_id, kind, version, agreed, created_at) values (${ctx.managerA.id}, 'marketing', ${version}, true, now() - interval '3 days')`;
    const before = mails.length;
    await tick();
    const got = mailTo('staffB@dagym.test', RE);
    assert.equal(got.length, 1, '안내 메일');
    assert.match(got[0].text, /동의하셨습니다/); assert.match(got[0].text, /전송자: 시험회사\(워크인\)/); assert.match(got[0].text, /그만 받으시려면/);
    assert.equal(mailTo('staffA@dagym.test', RE).length, 0, '철회한 사람은 안 보냄');
    assert.equal(mailTo('mk1@consent.test', RE).length, 0, '오늘 동의한 사람은 안 보냄');
    const late = mailTo('managerA@dagym.test', RESULT);
    assert.equal(late.length, 1, '배포 전 동의한 사람도 14일 안에 처리 결과'); assert.match(late[0].text, /처리 결과: 수신 동의/);
    assert.equal(mailTo('mk2@consent.test', RESULT).length, 0, '가입 때 받지 않음은 거부 요청이 아님 — 안 보냄');
    assert.equal(mailTo('mk1@consent.test', RESULT).length, 1, '이미 보낸 사람은 다시 안 보냄');
    assert.equal(mails.slice(before).filter((m) => RESULT.test(m.subject)).length, 1);
    await tick();
    assert.equal(mailTo('managerA@dagym.test', RESULT).length, 1, '처리 결과도 한 번만');
    assert.equal(mailTo('staffB@dagym.test', RE).length, 1, '한 번만');
    const st = await b.ok('GET', '/api/account/marketing-consent');
    assert.equal(st.agreed, true, '답이 없어도 동의는 그대로'); assert.ok(st.reconfirmedAt);
  });
});

describe('360차 워크인 체험 신청 → 광고 전환(키워드·캠페인별)', () => {
  test('신청 utm·첫 광고 주소 → 키워드 줄 신청·승인·실사용 + 캠페인별 건당 광고비', async () => {
    await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
    const acc = await ctx.owner.ok('POST', '/api/marketing/ads/accounts', { label: '네이버', customerId: '1234567', apiKey: 'naver-license-abc', secretKey: 'naver-secret-key-xyz' });
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    await sql`insert into mkt_ad_items (account_id, day, kind, item_id, item_name, campaign_id, campaign_name, clicks, cost_krw) values
      (${acc.id}, ${day}, 'keyword', 'nkw-1', '업무관리 프로그램', 'cmp-a', '워크인 검색', 20, 30000),
      (${acc.id}, ${day}, 'keyword', 'nkw-2', '헬스장 위탁운영', 'cmp-c', '다짐 검색', 15, 15000)`;
    const LAND = '/welcome?n_media=27758&n_query=%EC%97%85%EB%AC%B4%EA%B4%80%EB%A6%AC&n_keyword_id=nkw-1&n_keyword=%EC%97%85%EB%AC%B4%EA%B4%80%EB%A6%AC%20%ED%94%84%EB%A1%9C%EA%B7%B8%EB%9E%A8';
    assert.equal((await new Client().req('POST', '/api/auth/signup', { email: 'bad@ads.test', name: '신청자', password: 'signup-pass-1234', mode: 'team', company: '나쁜 상사', size: '2-10', industry: '제조', agree, contact: '010 1234 5678', utm: { landing: 'https://evil.test/x' } })).status, 400, '첫 주소는 우리 주소(/…)만');
    await signup(new Client('a1'), 'a1@ads.test', { utm: { source: 'naver', medium: 'cpc', landing: LAND } });
    await signup(new Client('a2'), 'a2@ads.test', { utm: { landing: LAND } });
    await signup(new Client('a3'), 'a3@ads.test', { utm: { source: 'naver', medium: 'cpc' } });
    await signup(new Client('a4'), 'a4@ads.test');
    await signup(new Client('a5'), 'a5@ads.test', { utm: { source: 'google', medium: 'cpc', campaign: '워크인 구글', term: '일정 공유' } });
    const t1 = await tenantOfEmail('a1@ads.test');
    await ctx.owner.ok('POST', `/api/platform/signups/${t1}/approve`, {});
    const [u1] = await sql`select id from users where email = 'a1@ads.test'`;
    for (const k of [0, 1, 2]) await sql`insert into user_active_days (user_id, tenant, day) values (${u1.id}, ${t1}, ((now() at time zone 'Asia/Seoul')::date + ${k}::int))`;

    const r = await ctx.owner.ok('GET', '/api/marketing/ad-ops/leads?days=30');
    // 앞 시험(동의)에서 가입한 mk1·mk2 도 광고 아닌 신청으로 셈
    assert.deepEqual({ ...r.workin, byCampaign: undefined }, { signups: 7, approved: 1, active: 1, fromAds: 3, untracked: 1, organic: 3, byCampaign: undefined });
    const k1 = r.rows.find((x) => x.itemId === 'nkw-1');
    assert.deepEqual([k1.wkSignup, k1.wkApproved, k1.wkActive, k1.leads, k1.cpa, k1.flag], [2, 1, 1, 2, 15000, null]);
    const g = r.rows.find((x) => x.provider === 'google');
    assert.deepEqual([g.keyword, g.campaign, g.wkSignup, g.cost], ['일정 공유', '워크인 구글', 1, 0]);
    assert.equal(r.rows.find((x) => x.itemId === 'nkw-2').wkSignup, 0);
    assert.equal(r.totals.wkSignup, 3);
    const camp = Object.fromEntries(r.workin.byCampaign.map((c) => [c.campaign, c]));
    assert.deepEqual(Object.keys(camp).sort(), ['워크인 검색', '워크인 구글'], '워크인 캠페인만(다짐 검색 없음)');
    assert.deepEqual([camp['워크인 검색'].cost, camp['워크인 검색'].signups, camp['워크인 검색'].approved, camp['워크인 검색'].active, camp['워크인 검색'].perSignup, camp['워크인 검색'].perActive], [30000, 2, 1, 1, 15000, 30000]);
    assert.equal(r.unknown.inquiries, 1, '광고인데 키워드 모르는 신청 1건 = 키워드 모르는 리드');
    const [t2] = await sql`select signup_utm from tenants where id = ${await tenantOfEmail('a2@ads.test')}`;
    assert.equal(t2.signup_utm.landing, LAND, '첫 광고 주소를 그대로 남김');
  });
});

describe('360차 네이버 자동 추적 URL 모든 캠페인 켜기', () => {
  test('미리 보기(쓰기 없음) → 켜기(전체 객체·필드 지정 없음) → 다시 읽어 확인 · 이미 켜짐·다른 방식 그대로 · 반영 안 됨 표시 · 직원 403', async () => {
    const [acc] = await sql`select id from mkt_ad_accounts where provider = 'naver' limit 1`;
    await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
    assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/ad-ops/tracking', { accountId: acc.id, dryRun: true })).status, 403);
    assert.equal((await ctx.owner.req('POST', '/api/marketing/ad-ops/tracking', { accountId: 'x', dryRun: true })).status, 400);
    calls = [];
    const d = await ctx.owner.ok('POST', '/api/marketing/ad-ops/tracking', { accountId: acc.id, dryRun: true });
    assert.deepEqual([d.total, d.already, d.otherMode, d.wouldChange], [4, 1, 1, 2]);
    assert.deepEqual(calls.filter((c) => c.method !== 'GET'), [], '미리 보기는 읽기만');
    calls = [];
    const r = await ctx.owner.ok('POST', '/api/marketing/ad-ops/tracking', { accountId: acc.id, dryRun: false });
    assert.deepEqual([r.changed, r.notApplied, r.failed, r.already, r.otherMode], [1, 1, 0, 1, 1]);
    const puts = calls.filter((c) => c.method === 'PUT');
    assert.deepEqual(puts.map((c) => [c.path, c.fields, c.body.trackingMode, c.body.name]), [['/ncc/campaigns/cmp-a', null, 'AUTO_TRACKING_MODE', '워크인 검색'], ['/ncc/campaigns/cmp-d', null, 'AUTO_TRACKING_MODE', '바디랩 검색']]);
    assert.equal(camps['cmp-a'].trackingMode, 'AUTO_TRACKING_MODE');
    assert.equal(camps['cmp-c'].trackingMode, 'PASS_THROUGH_SITE_MODE', '다른 추적 방식은 그대로');
    assert.equal(camps['cmp-a'].dailyBudget, 1000, '예산 그대로');
    assert.equal(r.rows.find((x) => x.id === 'cmp-d').status, 'not_applied');
    const [au] = await sql`select detail from audit_logs where action = 'mkt_ads.tracking_all' order by created_at desc limit 1`;
    assert.deepEqual(au.detail, { changed: 1, notApplied: 1, failed: 0 });
  });
});
