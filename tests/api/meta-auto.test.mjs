// #494 메타 광고 자동 세팅(가짜 Meta 서버 = 구조 시험, 실계정 집행 아님): [광고 만들기 권한으로 다시 연결] 범위 → 세팅안 검사(위험 표현·특별 카테고리·기간·상한) →
// 상한·권한 없으면 막힘 → [Meta에 초안 만들기] = 소재 올리기 + 캠페인·광고 세트·광고 모두 PAUSED + spend_cap(토큰은 본문, ACTIVE 없음) → 승인함 '광고 초안' →
// 직원 403 · Meta 쪽 상한이 다르면 안 켬 · [승인하고 집행] = 광고→세트→캠페인 ACTIVE + 기록·감사 → 끄기·다시 켜기·예산(증액 = 돈 나가는 변경) → tick 리드당 비용 넘으면 자동 일시정지 ·
// 영상 소재는 Meta 처리 중이면 멈췄다가 이어서 · 반려 = 보관(Meta 에는 꺼진 채)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BASE, bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

const PORT = 3238;
const PAGE = '777000111'; const FORM = '880000222'; const ACT = '998877';
const CAMP = '120210000000000101', ADSET = '120210000000000102', CREATIVE = '120210000000000103', AD = '120210000000000104';
const VCAMP = '120210000000000201', VADSET = '120210000000000202', VCREATIVE = '120210000000000203', VAD = '120210000000000204', VIDEO = '120210000000000299';
let srv, ctx, sql, fake; let calls = [];
let grantManage = false, metaCap = 150000, metaDaily = 10000, videoReady = false, privacyMode = 'ok';
const day = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
before(async () => {
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const p = u.pathname; const qs = Object.fromEntries(u.searchParams); const form = Object.fromEntries(new URLSearchParams(body));
    const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(typeof j === 'string' ? j : JSON.stringify(j)); };
    calls.push({ method: req.method, path: p, q: qs, form });
    if (p === '/graph/oauth/access_token') return send(200, { access_token: qs.grant_type ? 'meta-long' : 'meta-short' });
    if (p === '/graph/me') return send(200, { id: 'fb-user-1' });
    if (p === '/graph/me/permissions') return send(200, { data: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish', 'business_management', 'ads_read',
      ...(grantManage ? ['ads_management', 'pages_manage_ads'] : [])].map((permission) => ({ permission, status: 'granted' })) });
    if (p === '/graph/me/accounts') return send(200, { data: [{ id: PAGE, name: '다짐 본점', access_token: 'page-token-1', tasks: ['MANAGE', 'CREATE_CONTENT', 'ADVERTISE'] }] });
    if (p === '/graph/me/adaccounts') return send(200, { data: [{ account_id: ACT, name: '다짐 메타 광고' }] });
    if (p === `/graph/act_${ACT}/insights`) return send(200, { data: [] });
    if (req.method === 'GET' && p === `/graph/act_${ACT}`) return send(200, { id: `act_${ACT}`, currency: 'KRW', account_status: 1, balance: '0' });
    if (req.method === 'GET' && p === `/graph/${PAGE}/leadgen_forms`) return send(200, { data: [{ id: FORM, name: '가을 PT 상담', status: 'ACTIVE' }] });
    if (req.method === 'GET' && p === `/graph/${FORM}`) {
      if ((qs.access_token ?? '') !== 'page-token-1') return send(400, { error: { message: 'Invalid OAuth access token', code: 190 } });
      if (privacyMode === 'unknown' && /privacy_policy_url/.test(qs.fields)) return send(400, { error: { message: '(#100) Tried accessing nonexisting field (privacy_policy_url)', code: 100 } });
      return send(200, { id: FORM, name: '가을 PT 상담', status: 'ACTIVE', ...(privacyMode === 'ok' ? { privacy_policy_url: 'https://example.com/privacy' } : {}) });
    }
    // 광고 만들기 — 토큰은 본문(access_token)으로만
    if (req.method === 'POST' && p.startsWith(`/graph/act_${ACT}/`) && form.access_token !== 'meta-long') return send(400, { error: { message: 'Invalid OAuth access token', code: 190 } });
    const video = (form.name ?? '').includes('영상');
    if (req.method === 'POST' && p === `/graph/act_${ACT}/adimages`) return send(200, { images: { bytes: { hash: `imghash-${form.bytes.length}`, url: 'https://scontent.example/img.png' } } });
    if (req.method === 'POST' && p === `/graph/act_${ACT}/advideos`) return send(200, `{"id":${VIDEO}}`); // 큰 숫자 그대로(JSON 숫자) — 자릿수가 깨지면 안 됨
    if (req.method === 'GET' && p === `/graph/${VIDEO}`) return send(200, { id: VIDEO, status: { video_status: videoReady ? 'ready' : 'processing' }, picture: 'https://scontent.example/thumb.jpg' });
    if (req.method === 'POST' && p === `/graph/act_${ACT}/campaigns`) return send(200, `{"id":${video ? VCAMP : CAMP}}`);
    if (req.method === 'POST' && p === `/graph/act_${ACT}/adsets`) return send(200, { id: form.campaign_id === VCAMP ? VADSET : ADSET });
    if (req.method === 'POST' && p === `/graph/act_${ACT}/adcreatives`) return send(200, { id: JSON.parse(form.object_story_spec).video_data ? VCREATIVE : CREATIVE });
    if (req.method === 'POST' && p === `/graph/act_${ACT}/ads`) return send(200, { id: form.adset_id === VADSET ? VAD : AD });
    if (req.method === 'GET' && p === `/graph/${CAMP}`) return send(200, { id: CAMP, spend_cap: String(metaCap), status: 'PAUSED' });
    if (req.method === 'GET' && p === `/graph/${ADSET}`) return send(200, { id: ADSET, daily_budget: String(metaDaily), status: 'PAUSED' });
    if (req.method === 'GET' && p === `/graph/${CAMP}/insights`) return send(200, { data: [{ spend: '40000', clicks: '50', actions: [{ action_type: 'lead', value: '1' }, { action_type: 'link_click', value: '50' }] }] });
    if (req.method === 'POST' && /^\/graph\/\d+$/.test(p)) return send(200, { success: true });
    send(404, { error: { message: `nope ${req.method} ${p}` } });
  }).listen(PORT);
  await resetDb();
  srv = await startServer({ ADS_TEST_BASE: `http://localhost:${PORT}`, META_APP_ID: 'meta-app', META_APP_SECRET: 'meta-secret' });
  sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

async function upload(name, mime, bytes) {
  const lf = await ctx.owner.ok('POST', '/api/library', { fileName: name, mimeType: mime, size: bytes.length, folder: '마케팅' });
  await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: bytes });
  await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`);
  return lf.id;
}
const plan = (o, over = {}) => ({ accountId: o.accountId, pageAccountId: o.pageAccountId, name: '가을 PT 상담 리드', objective: 'leads', leadFormId: FORM,
  creative: { fileId: o.fileId, primary: '가까운 헬스장에서 첫 PT 상담을 받아 보세요. 상담만 받아도 운동 계획표를 드립니다.', headline: '가을 PT 첫 상담', description: '동네 헬스장', cta: 'SIGN_UP' },
  location: { address: '경기 수원시 영통구 광교중앙로 140', radiusKm: 3 }, ageMin: 25, ageMax: 55, startDate: day(1), endDate: day(20), dailyBudget: 10000, totalCap: 150000,
  guard: { maxCpl: 20000, minSpend: 30000 }, ...over });

test('메타 광고 자동 세팅: 연결 권한 → 검사 → 꺼진 초안(PAUSED·spend_cap) → 승인함 → 승인(상한 재확인)·끄기·다시 켜기·예산 → 리드당 비용 자동 일시정지', async () => {
  // 광고 계정 연결: 보통은 성과 읽기(ads_read)만, [광고 만들기 권한으로 다시 연결]은 ads_management·페이지 광고 권한까지
  const plain = new URL((await ctx.owner.get('/api/marketing/ads/connect/meta')).headers.get('location'));
  assert.equal(plain.searchParams.get('scope'), 'ads_read');
  const go = new URL((await ctx.owner.get('/api/marketing/ads/connect/meta?manage=1')).headers.get('location'));
  assert.deepEqual(go.searchParams.get('scope').split(','), ['ads_read', 'ads_management', 'pages_show_list', 'pages_read_engagement', 'pages_manage_ads']);
  await ctx.owner.get(`/api/marketing/ads/callback/meta?code=c1&state=${go.searchParams.get('state')}`);
  const [acc] = await sql`select id from mkt_ad_accounts where provider = 'meta' and external_id = ${ACT}`; assert.ok(acc, '메타 광고 계정 등록');
  // 광고를 내보낼 페이스북 페이지(게시 연결)
  const pg = new URL((await ctx.owner.get('/api/marketing/publish/connect/meta')).headers.get('location'));
  await ctx.owner.get(`/api/marketing/publish/callback/meta?code=p1&state=${pg.searchParams.get('state')}`);
  const [page] = await sql`select id from mkt_publish_accounts where provider = 'meta_fb' and external_id = ${PAGE}`; assert.ok(page);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a40000000049454e44ae426082', 'hex');
  const fileId = await upload('가을 PT 광고.png', 'image/png', png);
  const o = { accountId: acc.id, pageAccountId: page.id, fileId };

  const ov0 = await ctx.owner.ok('GET', '/api/marketing/ad-ops/meta');
  assert.deepEqual([ov0.accounts.length, ov0.pages.length, ov0.plans.length, ov0.canEdit], [1, 1, 0, true]);
  assert.deepEqual((await ctx.owner.ok('GET', `/api/marketing/ad-ops/meta/forms?pageAccountId=${page.id}`)).forms.map((f) => f.id), [FORM], '리드 양식 고르기');
  // 직원은 못 만듦, 공간 밖 직원은 존재도 모름
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/ad-ops/meta', plan(o))).status, 403);
  assert.equal((await ctx.staffB.client.req('GET', '/api/marketing/ad-ops/meta')).status, 404);

  // 검사: 순위 표현·채용(특별 카테고리)·지난 시작일·짧은 기간·작은 상한 → 만들기 막힘
  const bad = await ctx.owner.ok('POST', '/api/marketing/ad-ops/meta', plan(o, { creative: { ...plan(o).creative, headline: '동네 1위 헬스장', primary: '트레이너 채용 중입니다' }, startDate: day(-1), endDate: day(-1), totalCap: 100000 }));
  for (const re of [/순위 표현/, /특별 광고 카테고리\(채용\)/, /시작일이 지났습니다/, /이틀 이상/, /14만 원|140,000원 이상/]) assert.ok(bad.issues.some((x) => re.test(x)), `${re} — ${bad.issues.join(' | ')}`);
  const pre = await ctx.owner.req('POST', `/api/marketing/ad-ops/meta/${bad.id}/draft`, {});
  assert.equal(pre.status, 409); assert.match(pre.body.error.message, /세팅안 검사를 통과하지 못했습니다/);
  await ctx.owner.ok('POST', `/api/marketing/ad-ops/meta/${bad.id}/reject`, { reason: '문구 다시' });
  assert.equal((await sql`select status from mkt_ad_plans where id = ${bad.id}`)[0].status, 'archived', '보관');

  const made = await ctx.owner.ok('POST', '/api/marketing/ad-ops/meta', plan(o));
  assert.deepEqual(made.issues, []); assert.ok(made.warnings.some((w) => /총 상한 150,000원에 닿으면/.test(w)), made.warnings.join(' | '));
  // 회사 월 상한이 없으면 Meta 에 아무것도 안 만듦
  calls = [];
  const noCap = await ctx.owner.req('POST', `/api/marketing/ad-ops/meta/${made.id}/draft`, {});
  assert.equal(noCap.status, 409); assert.match(noCap.body.error.message, /월 광고비 상한/);
  assert.equal(calls.filter((c) => c.path.startsWith('/graph/act_')).length, 0);
  await ctx.owner.ok('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 1_000_000 });
  // 광고 만들기 권한(ads_management)이 없으면 다시 연결 안내 · 실패로 남음
  const noScope = await ctx.owner.req('POST', `/api/marketing/ad-ops/meta/${made.id}/draft`, {});
  assert.equal(noScope.status, 409); assert.match(noScope.body.error.message, /광고 만들기 권한으로 다시 연결/);
  assert.equal((await sql`select status from mkt_ad_plans where id = ${made.id}`)[0].status, 'failed');
  grantManage = true;

  // [Meta에 초안 만들기]: 모두 PAUSED + 총 상한, 토큰은 본문으로, ACTIVE 는 한 번도 없음
  calls = [];
  const dr = await ctx.owner.ok('POST', `/api/marketing/ad-ops/meta/${made.id}/draft`, {});
  assert.equal(dr.status, 'created'); assert.deepEqual(dr.external, { campaignId: CAMP, adsetId: ADSET, creativeId: CREATIVE, adId: AD }, '큰 번호도 문자열 그대로');
  assert.ok(!JSON.stringify(dr).includes('meta-long'), '토큰 안 보임');
  const post = (path) => calls.find((c) => c.method === 'POST' && c.path === `/graph/act_${ACT}/${path}`)?.form;
  assert.equal(post('adimages').bytes, png.toString('base64'));
  const camp = post('campaigns');
  assert.deepEqual([camp.objective, camp.status, camp.special_ad_categories, camp.spend_cap, camp.is_adset_budget_sharing_enabled, camp.buying_type], ['OUTCOME_LEADS', 'PAUSED', '[]', '150000', 'false', 'AUCTION']);
  const set = post('adsets');
  assert.deepEqual([set.campaign_id, set.daily_budget, set.optimization_goal, set.billing_event, set.destination_type, set.status, set.start_time, set.end_time],
    [CAMP, '10000', 'LEAD_GENERATION', 'IMPRESSIONS', 'ON_AD', 'PAUSED', `${day(1)}T00:00:00+0900`, `${day(20)}T23:59:59+0900`]);
  assert.deepEqual(JSON.parse(set.promoted_object), { page_id: PAGE });
  assert.deepEqual(JSON.parse(set.targeting), { geo_locations: { custom_locations: [{ address_string: '경기 수원시 영통구 광교중앙로 140', radius: 3, distance_unit: 'kilometer' }], location_types: ['home', 'recent'] },
    age_min: 25, age_max: 55, targeting_automation: { advantage_audience: 0 } });
  const cr = JSON.parse(post('adcreatives').object_story_spec);
  assert.deepEqual(cr, { page_id: PAGE, link_data: { image_hash: `imghash-${png.toString('base64').length}`, link: 'https://fb.me/', message: plan(o).creative.primary, name: '가을 PT 첫 상담', description: '동네 헬스장',
    call_to_action: { type: 'SIGN_UP', value: { lead_gen_form_id: FORM } } } });
  const ad = post('ads'); assert.deepEqual([ad.adset_id, ad.status, JSON.parse(ad.creative).creative_id], [ADSET, 'PAUSED', CREATIVE]);
  assert.ok(calls.every((c) => c.form.status !== 'ACTIVE'), '초안에서 켜는 호출 없음');
  assert.ok(calls.filter((c) => c.method === 'POST').every((c) => !c.q.access_token), 'POST 는 토큰을 주소에 안 붙임');
  const formCall = calls.find((c) => c.path === `/graph/${FORM}`); assert.match(formCall.q.fields, /privacy_policy_url/); assert.equal(formCall.q.access_token, 'page-token-1', '양식은 페이지 토큰');
  const [ch] = await sql`select kind, money_up, after from mkt_ad_changes where plan_id = ${made.id} and status = 'applied'`;
  assert.deepEqual([ch.kind, ch.money_up, ch.after.paused, ch.after.totalCap], ['create', false, true, 150000]);
  const [nt] = await sql`select title, link from notifications where dedupe_key = ${`metaads:${made.id}`} and user_id = ${ctx.ownerId}`;
  assert.match(nt.title, /메타 광고 초안 — 승인해 주세요 \(하루 10,000원 · 총 상한 150,000원\)/); assert.equal(nt.link, '/s/marketing/approvals?tab=ads');
  // 만든 뒤에는 고칠 수 없음
  assert.equal((await ctx.owner.req('PUT', `/api/marketing/ad-ops/meta/${made.id}`, plan(o, { name: '바꾸기' }))).status, 409);

  // 승인함 '광고 초안'
  const inbox = await ctx.owner.ok('GET', '/api/marketing/inbox');
  assert.equal(inbox.counts.ads, 1); assert.deepEqual([inbox.ads[0].id, inbox.ads[0].page_label, inbox.ads[0].creative_mime], [made.id, '다짐 본점', 'image/png']);
  const sp = (await ctx.owner.ok('GET', '/api/spaces')).summary.marketing; assert.deepEqual([sp.badge, sp.text], [1, '운영 승인 1'], '사이드바·앱 탭 배지에도 광고 초안');
  assert.equal((await ctx.staffA.client.req('POST', `/api/marketing/ad-ops/meta/${made.id}/approve`, {})).status, 403, '직원은 승인 못 함');
  // Meta 쪽 상한이 승인할 값보다 크면(누가 바꿈) 켜지 않음
  metaCap = 999999; calls = [];
  const mism = await ctx.owner.req('POST', `/api/marketing/ad-ops/meta/${made.id}/approve`, {});
  assert.equal(mism.status, 409); assert.match(mism.body.error.message, /Meta 쪽 총 상한\(999,999원\)/);
  assert.ok(!calls.some((c) => c.form.status === 'ACTIVE'));
  metaCap = 150000; calls = [];
  const ap = await ctx.owner.ok('POST', `/api/marketing/ad-ops/meta/${made.id}/approve`, {});
  assert.equal(ap.status, 'active');
  assert.deepEqual(calls.filter((c) => c.form.status === 'ACTIVE').map((c) => c.path), [`/graph/${AD}`, `/graph/${ADSET}`, `/graph/${CAMP}`], '광고 → 세트 → 캠페인 순서');
  const [pl] = await sql`select status, approved_by from mkt_ad_plans where id = ${made.id}`; assert.deepEqual([pl.status, pl.approved_by], ['active', ctx.ownerId]);
  assert.ok((await sql`select 1 from mkt_ad_changes where plan_id = ${made.id} and kind = 'enable' and money_up and after->>'approved' = 'true'`).length);
  assert.ok((await sql`select 1 from audit_logs where action = 'mkt_ads.meta_approve' and target_id::text = ${made.id}`).length, '감사 기록');
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/inbox')).counts.ads, 0);

  // 끄기 → 다시 켜기(상한 검사) → 하루 예산 올리기(돈 나가는 변경)·총 상한 넘으면 막힘
  calls = [];
  await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${made.id}/action`, { action: 'pause' });
  assert.equal(calls.find((c) => c.path === `/graph/${CAMP}`)?.form.status, 'PAUSED');
  await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${made.id}/action`, { action: 'enable' });
  assert.equal((await sql`select status from mkt_ad_plans where id = ${made.id}`)[0].status, 'active');
  await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${made.id}/action`, { action: 'budget', dailyBudget: 12000 });
  assert.equal(calls.find((c) => c.path === `/graph/${ADSET}` && c.form.daily_budget)?.form.daily_budget, '12000');
  const [bud] = await sql`select money_up, before, after from mkt_ad_changes where plan_id = ${made.id} and kind = 'budget'`; assert.deepEqual([bud.money_up, bud.before.dailyBudget, bud.after.dailyBudget], [true, 10000, 12000]);
  assert.equal((await ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${made.id}/action`, { action: 'budget', dailyBudget: 200000 })).status, 400, '총 상한보다 큰 하루 예산');
  const ov = await ctx.owner.ok('GET', '/api/marketing/ad-ops/meta');
  assert.deepEqual(ov.plans.find((x) => x.id === made.id).status, 'active');
  assert.ok(!(await ctx.owner.ok('GET', '/api/marketing/ad-ops')).plans.some((x) => x.id === made.id), '네이버 세팅안 목록에는 안 섞임');

  // tick: 누적 4만 원·리드 1건 = 리드당 4만 원 > 기준 2만 원 → 자동 일시정지 + 기록·알림
  calls = [];
  await tick();
  const [after1] = await sql`select status, external from mkt_ad_plans where id = ${made.id}`;
  assert.equal(after1.status, 'paused', JSON.stringify(after1.external.guardError ?? null));
  assert.deepEqual(after1.external.stats.leads, 1);
  assert.equal(calls.find((c) => c.method === 'POST' && c.path === `/graph/${CAMP}`)?.form.status, 'PAUSED');
  const [auto] = await sql`select after from mkt_ad_changes where plan_id = ${made.id} and kind = 'auto_pause'`;
  assert.deepEqual([auto.after.reason, auto.after.value, auto.after.limit, auto.after.spend], ['cpl', 40000, 20000, 40000]);
  assert.ok((await sql`select 1 from notifications where dedupe_key like ${`metaguard:${made.id}:%`}`).length, '자동 일시정지 알림');
});

test('영상 소재: Meta 처리 중이면 멈췄다가 다시 누르면 이어서 · 방문 광고 링크·버튼 · 양식 개인정보 링크 없음/못 읽음 · 반려', async () => {
  await ctx.owner.ok('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 1_000_000 }); grantManage = true; // 앞 시험과 따로 돌아도 되게
  const [acc] = await sql`select id from mkt_ad_accounts where provider = 'meta'`; const [page] = await sql`select id from mkt_publish_accounts where provider = 'meta_fb'`;
  const vid = await upload('가을 영상.mp4', 'video/mp4', Buffer.from('fake-mp4-bytes'));
  const o = { accountId: acc.id, pageAccountId: page.id, fileId: vid };
  const v = await ctx.owner.ok('POST', '/api/marketing/ad-ops/meta', plan(o, { name: '가을 영상 방문', objective: 'traffic', leadFormId: null, creative: { ...plan(o).creative, cta: 'LEARN_MORE', link: 'https://dagym.example/pt' }, guard: null }));
  assert.deepEqual(v.issues, []); assert.ok(v.warnings.some((w) => /자동 일시정지 기준/.test(w)));
  calls = []; videoReady = false;
  const p1 = await ctx.owner.ok('POST', `/api/marketing/ad-ops/meta/${v.id}/draft`, {});
  assert.equal(p1.pending, true);
  const vpost = calls.find((c) => c.path === `/graph/act_${ACT}/advideos`).form; assert.match(vpost.file_url, /^http/); assert.equal(vpost.name, '가을 영상 방문 소재');
  const [mid] = await sql`select status, error, external from mkt_ad_plans where id = ${v.id}`;
  assert.deepEqual([mid.status, mid.external.videoId], ['draft', VIDEO]); assert.match(mid.error, /영상 처리 중/);
  assert.ok(!calls.some((c) => c.path === `/graph/act_${ACT}/campaigns`), '처리 전에는 캠페인 안 만듦');
  videoReady = true; calls = [];
  const p2 = await ctx.owner.ok('POST', `/api/marketing/ad-ops/meta/${v.id}/draft`, {});
  assert.equal(p2.status, 'created'); assert.ok(!calls.some((c) => c.path === `/graph/act_${ACT}/advideos`), '영상은 다시 안 올림');
  const camp = calls.find((c) => c.path === `/graph/act_${ACT}/campaigns`).form; assert.equal(camp.objective, 'OUTCOME_TRAFFIC');
  const set = calls.find((c) => c.path === `/graph/act_${ACT}/adsets`).form;
  assert.deepEqual([set.optimization_goal, set.destination_type, set.promoted_object], ['LINK_CLICKS', 'WEBSITE', undefined]);
  const cr = JSON.parse(calls.find((c) => c.path === `/graph/act_${ACT}/adcreatives`).form.object_story_spec);
  assert.deepEqual(cr.video_data, { video_id: VIDEO, image_url: 'https://scontent.example/thumb.jpg', message: plan(o).creative.primary, title: '가을 PT 첫 상담', link_description: '동네 헬스장',
    call_to_action: { type: 'LEARN_MORE', value: { link: 'https://dagym.example/pt' } } });
  // 반려: 보관 + 기록, Meta 에는 꺼진 채(켜는 호출 없음)
  calls = [];
  await ctx.owner.ok('POST', `/api/marketing/ad-ops/meta/${v.id}/reject`, { reason: '예산 줄여서 다시' });
  const [rj] = await sql`select status, error from mkt_ad_plans where id = ${v.id}`; assert.deepEqual([rj.status, rj.error], ['archived', '반려: 예산 줄여서 다시']);
  assert.ok((await sql`select 1 from mkt_ad_changes where plan_id = ${v.id} and kind = 'approve' and status = 'rejected'`).length);
  assert.equal(calls.length, 0);
  // 리드 양식: 개인정보처리방침 링크가 없으면 막힘 · 링크를 읽을 수 없으면 담당자 확인 체크가 있어야
  const img = (await sql`select id from library_files where file_name = '가을 PT 광고.png'`)[0].id;
  const o2 = { ...o, fileId: img };
  privacyMode = 'missing';
  const l1 = await ctx.owner.ok('POST', '/api/marketing/ad-ops/meta', plan(o2, { name: '양식 점검' }));
  const r1 = await ctx.owner.req('POST', `/api/marketing/ad-ops/meta/${l1.id}/draft`, {});
  assert.equal(r1.status, 409); assert.match(r1.body.error.message, /개인정보처리방침 링크가 없습니다/);
  privacyMode = 'unknown';
  const r2 = await ctx.owner.req('POST', `/api/marketing/ad-ops/meta/${l1.id}/draft`, {});
  assert.equal(r2.status, 409); assert.match(r2.body.error.message, /확인했습니다'를 체크/);
  await ctx.owner.ok('PUT', `/api/marketing/ad-ops/meta/${l1.id}`, plan(o2, { name: '양식 점검', privacyConfirmed: true }));
  const r3 = await ctx.owner.ok('POST', `/api/marketing/ad-ops/meta/${l1.id}/draft`, {});
  assert.equal(r3.status, 'created');
  privacyMode = 'ok';
});
