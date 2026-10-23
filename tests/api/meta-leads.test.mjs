// 광고 2차 ① Meta 리드 광고 → 영업 리드 자동 등록 (가짜 Meta Graph 서버 = 구조 시험 — 실계정·실제 웹후크 수신은 로컬 확인 전)
// [리드 광고 받기](리드 권한·페이지 앱 설치 leadgen) → 웹후크(확인 토큰·앱 시크릿 서명, 큰 숫자 id) → 리드 읽기 → 영업 리드 '신규리드'(담당 규칙·업무·알림 이름 가림)
// · 같은 리드 두 번 = 한 번 · 같은 전화번호 = 기존 리드에 기록 · 광고 이름 칸 못 읽으면 문서 칸만 + 광고 성과에서 이름 · 놓친 리드 불러오기 · 시험 리드(알림은 누른 사람만)
// · 첫 연락([전화] 누름·상담 기록) · 5분 넘으면 담당·관리자 재알림(한 번) · 보고서(이름 가림·광고별 리드당 비용) · 영업 공간 꺼짐 → 건너뜀 → [다시 처리] · 끄기 · 권한
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { BASE, bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

const PORT = 3235;
const PAGE = '1001';
const FORM = '5005';
let srv, ctx, sql, fake, calls = [], grantLeads = true, failAdName = false, seq = 7000;
const leads = new Map(); // 리드 id → 리드(Graph 모양)
const testLeads = new Map(); // 양식 → 시험 리드 id 목록
const nowMeta = (ms = Date.now()) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+0000');
const addLead = (id, fields, extra = {}) => { leads.set(id, { id, created_time: nowMeta(), form_id: FORM, field_data: Object.entries(fields).map(([name, v]) => ({ name, values: [v] })), ...extra }); return id; };
before(async () => {
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const p = u.pathname; const qs = Object.fromEntries(u.searchParams); const form = Object.fromEntries(new URLSearchParams(body));
    const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    calls.push({ method: req.method, path: p, q: qs, form });
    if (p === '/graph/oauth/access_token') return send(200, { access_token: qs.grant_type ? 'meta-long' : 'meta-short' });
    if (p === '/graph/me') return send(200, { id: 'fb-user-1' });
    if (p === '/graph/me/permissions') return send(200, { data: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish', 'business_management',
      ...(grantLeads ? ['leads_retrieval', 'pages_manage_ads', 'pages_manage_metadata', 'ads_management'] : [])].map((permission) => ({ permission, status: 'granted' })) });
    if (p === '/graph/me/accounts') return send(200, { data: [{ id: PAGE, name: '다짐 본점', access_token: 'page-token-1', tasks: ['MANAGE', 'CREATE_CONTENT', 'ADVERTISE'] }] });
    const tok = (qs.access_token ?? form.access_token) === 'page-token-1';
    if (p === `/graph/${PAGE}/subscribed_apps`) { if (!tok) return send(400, { error: { message: 'Invalid OAuth access token', code: 190 } }); return send(200, { success: true }); }
    if (!tok) return send(400, { error: { message: 'Invalid OAuth access token', code: 190 } });
    if (req.method === 'GET' && p === `/graph/${PAGE}/leadgen_forms`) return send(200, { data: [{ id: FORM, name: '가을 PT 상담', status: 'ACTIVE' }] });
    if (req.method === 'GET' && p === `/graph/${FORM}`) return send(200, { id: FORM, name: '가을 PT 상담' });
    if (req.method === 'GET' && p === `/graph/${FORM}/leads`) {
      if (failAdName && /ad_name/.test(qs.fields)) return send(400, { error: { message: '(#100) Tried accessing nonexisting field (ad_name)', code: 100 } });
      const since = Number(JSON.parse(qs.filtering ?? '[]')[0]?.value ?? 0);
      return send(200, { data: [...leads.values()].filter((l) => l.form_id === FORM && Date.parse(l.created_time) / 1000 > since && !l.test) });
    }
    if (p === `/graph/${FORM}/test_leads`) {
      const list = testLeads.get(FORM) ?? [];
      if (req.method === 'GET') return send(200, { data: list.map((id) => ({ id })) });
      if (req.method === 'POST') { if (list.length) return send(400, { error: { message: 'A test lead already exists', code: 100 } }); const id = String(++seq) + '000000000';
        leads.set(id, { id, created_time: nowMeta(), form_id: FORM, test: true, field_data: [{ name: 'full_name', values: ['<test lead: dummy data for full_name>'] }, { name: 'phone_number', values: ['<test lead: dummy data for phone_number>'] }] });
        testLeads.set(FORM, [id]); return send(200, { id }); }
    }
    const lm = p.match(/^\/graph\/(\d+)$/);
    if (lm && leads.has(lm[1])) {
      if (req.method === 'DELETE') { leads.delete(lm[1]); testLeads.set(FORM, (testLeads.get(FORM) ?? []).filter((x) => x !== lm[1])); return send(200, { success: true }); }
      if (failAdName && /ad_name/.test(qs.fields)) return send(400, { error: { message: '(#100) Tried accessing nonexisting field (ad_name)', code: 100 } });
      const l = leads.get(lm[1]); const want = new Set(String(qs.fields ?? '').split(','));
      return send(200, Object.fromEntries(Object.entries(l).filter(([k]) => k === 'id' || want.has(k))));
    }
    send(404, { error: { message: `nope ${req.method} ${p}`, code: 803 } });
  }).listen(PORT);
  await resetDb();
  srv = await startServer({ ADS_TEST_BASE: `http://localhost:${PORT}`, META_APP_ID: 'app-1', META_APP_SECRET: 'app-secret', META_WEBHOOK_VERIFY_TOKEN: 'verify-me' });
  sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing', 'sales'] });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

const sign = (raw, secret = 'app-secret') => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
const hook = (raw, sig = sign(raw)) => fetch(`${BASE}/api/marketing/meta/webhook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body: raw }).then(async (r) => ({ status: r.status, body: await r.json() }));
// 실제 웹후크처럼 id 를 숫자로(큰 숫자는 JSON 자릿수가 깨지는지 확인)
const payload = (leadgen, page = PAGE) => `{"object":"page","entry":[{"id":${page},"time":${Math.floor(Date.now() / 1000)},"changes":[{"field":"leadgen","value":{"leadgen_id":${leadgen},"page_id":${page},"form_id":${FORM},"adgroup_id":444,"ad_id":777,"created_time":${Math.floor(Date.now() / 1000)}}}]}]}`;
async function settled(leadgen) {
  for (let i = 0; i < 50; i++) {
    const [m] = await sql`select * from mkt_meta_leads where leadgen_id = ${leadgen}`;
    if (m && !['pending', 'working'].includes(m.status)) return m;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`처리 안 됨 ${leadgen}`);
}
let accountId;

test('웹후크 확인: 확인 토큰이 맞을 때만 hub.challenge', async () => {
  const ok = await fetch(`${BASE}/api/marketing/meta/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=8237461`);
  assert.equal(ok.status, 200); assert.equal(await ok.text(), '8237461');
  assert.equal((await fetch(`${BASE}/api/marketing/meta/webhook?hub.mode=subscribe&hub.verify_token=wrong-one&hub.challenge=1`)).status, 403);
  assert.equal((await fetch(`${BASE}/api/marketing/meta/webhook?hub.mode=unsubscribe&hub.verify_token=verify-me&hub.challenge=1`)).status, 403);
});

test('[리드 광고 받기]: 리드 권한까지 묻고 → 페이지에 앱 설치(leadgen) → 받는 중', async () => {
  const go = new URL((await ctx.owner.get('/api/marketing/publish/connect/meta?leads=1')).headers.get('location'));
  const scope = go.searchParams.get('scope').split(',');
  for (const s of ['pages_show_list', 'pages_manage_posts', 'leads_retrieval', 'pages_manage_ads', 'pages_manage_metadata', 'ads_management']) assert.ok(scope.includes(s), s);
  const plain = new URL((await ctx.owner.get('/api/marketing/publish/connect/meta')).headers.get('location'));
  assert.ok(!plain.searchParams.get('scope').includes('leads_retrieval'), '보통 [연결]은 리드 권한을 묻지 않음');
  const cb = await ctx.owner.get(`/api/marketing/publish/callback/meta?code=c1&state=${go.searchParams.get('state')}`);
  assert.match(cb.headers.get('location'), /published=meta&pages=1&ig=0&warn=\d+&leads=1/);
  const sub = calls.find((c) => c.method === 'POST' && c.path === `/graph/${PAGE}/subscribed_apps`);
  assert.equal(sub.form.subscribed_fields, 'leadgen'); assert.equal(sub.form.access_token, 'page-token-1');
  const [acc] = await sql`select id, scopes from mkt_publish_accounts where provider = 'meta_fb' and external_id = ${PAGE}`;
  accountId = acc.id;
  assert.ok(acc.scopes.includes('leads_retrieval') && acc.scopes.includes('pages_manage_posts'), '실제로 허용된 권한을 저장');
  const [lp] = await sql`select enabled, enabled_by, subscribed_at from mkt_lead_pages where account_id = ${acc.id}`;
  assert.equal(lp.enabled, true); assert.equal(lp.enabled_by, ctx.ownerId); assert.ok(lp.subscribed_at);
  const ch = await ctx.owner.ok('GET', '/api/marketing/publish/channels');
  const fb = ch.channels.find((c) => c.key === 'facebook').accounts[0];
  assert.deepEqual({ scopes: fb.leads.scopes, on: fb.leads.on, subscribed: fb.leads.subscribed }, { scopes: true, on: true, subscribed: true });
  assert.ok(!JSON.stringify(ch).includes('page-token-1'), '토큰은 화면·API 에 안 나감');
});

test('웹후크 → 영업 리드 신규리드: 서명 확인·큰 숫자 id·담당(연결한 관리자)·업무·알림(이름 가림)·같은 리드는 한 번', async () => {
  const id = addLead('123456789012345678', { full_name: '홍길동', phone_number: '+821012345678', email: 'hong@example.com', '희망_운동': 'PT', city: '천안' }, { ad_id: '777', ad_name: '가을 PT 이벤트 A', campaign_name: '가을 리드', platform: 'ig' });
  const raw = payload(id);
  assert.equal((await hook(raw, sign(raw, 'other-secret'))).status, 403, '서명이 틀리면 403');
  assert.equal((await hook(raw, 'sha256=abc')).status, 403);
  const r = await hook(raw);
  assert.equal(r.status, 200); assert.equal(r.body.received, 1);
  const m = await settled(id);
  assert.equal(m.status, 'created', m.error ?? ''); assert.equal(m.via, 'webhook'); assert.equal(m.form_name, '가을 PT 상담'); assert.equal(m.ad_name, '가을 PT 이벤트 A');
  const [l] = await sql`select * from sales_leads where id = ${m.lead_id}`;
  assert.equal(l.name, '홍길동'); assert.equal(l.status, '신규리드'); assert.equal(l.phone, '010-1234-5678'); assert.equal(l.email, 'hong@example.com'); assert.equal(l.region, '천안');
  assert.equal(l.owner_id, ctx.ownerId, '담당 규칙이 없으면 리드 광고를 켠 관리자');
  assert.equal(l.src.from, 'meta_lead'); assert.equal(l.src.leadgenId, id); assert.equal(l.src.adName, '가을 PT 이벤트 A');
  assert.ok(l.src.answers.some((a) => a.q === '희망_운동' && a.a === 'PT')); assert.match(l.memo, /희망_운동: PT/);
  const [log] = await sql`select to_status, changed_by from sales_status_log where lead_id = ${l.id}`;
  assert.equal(log.to_status, '신규리드'); assert.equal(log.changed_by, null);
  const [t] = await sql`select title, assignee_id, lead_id, priority, sales_ref from tasks where id = ${m.task_id}`;
  assert.equal(t.title, '[리드 광고] 홍길동 — 5분 안에 첫 연락'); assert.equal(t.assignee_id, ctx.ownerId); assert.equal(t.lead_id, l.id); assert.equal(t.priority, 'high'); assert.equal(t.sales_ref.kind, 'lead');
  const [n] = await sql`select title, body, link, user_id from notifications where type = 'lead_ad' and dedupe_key = ${`lead_ad:${m.id}`}`;
  assert.equal(n.title, '리드 광고 새 신청 · 홍*동', '잠금 화면엔 이름 가림'); assert.match(n.body, /5분 안에 연락해 주세요/); assert.equal(n.link, `/s/sales/leads?id=${l.id}`);
  // Meta 가 같은 알림을 다시 보내도 한 번만
  assert.equal((await hook(raw)).body.received, 0);
  assert.equal((await sql`select count(*)::int n from sales_leads where src->>'leadgenId' = ${id}`)[0].n, 1);
  // 리드 광고를 안 켠 페이지의 알림은 무시
  assert.equal((await hook(payload('99887766', '2002'))).body.received, 0);
});

test('담당 규칙(영업 · 리드) → 담당 · 같은 전화번호면 기존 리드에 기록 · 광고 이름 칸 못 읽으면 문서 칸만 + 광고 성과에서 이름', async () => {
  await ctx.owner.ok('PUT', '/api/admin/assignees', { kind: 'sales_source', ref: 'lead', primaryUserId: ctx.staffA.id });
  failAdName = true;
  const [ma] = await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, created_by) values ('default', 'meta', '55001', 'E2E 메타', ${ctx.ownerId}) returning id`;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  await sql`insert into mkt_ad_items (account_id, day, kind, item_id, item_name, campaign_name, impressions, clicks, cost_krw) values (${ma.id}, ${today}, 'ad', '888', '동네 주부 PT 소재', '동네 리드', 5000, 120, 60000)`;
  const id2 = addLead('2000000000000001', { full_name: '김영희', phone_number: '01055556666' }, { ad_id: '888' });
  assert.equal((await hook(payload(id2))).body.received, 1);
  const m2 = await settled(id2);
  assert.equal(m2.status, 'created', m2.error ?? ''); assert.equal(m2.ad_name, '동네 주부 PT 소재', '광고 성과(광고 단위)에서 이름'); assert.equal(m2.campaign_name, '동네 리드');
  const [l2] = await sql`select owner_id from sales_leads where id = ${m2.lead_id}`;
  assert.equal(l2.owner_id, ctx.staffA.id, '영업 담당 규칙(원천 리드)');
  assert.ok(calls.some((c) => c.path === `/graph/${id2}` && c.q.fields === 'id,created_time,ad_id,form_id,field_data'), '문서에 있는 칸만으로 다시 읽음');
  failAdName = false;
  // 같은 전화번호(+82 · 띄어쓰기 달라도) → 새 리드 없이 기존 리드(홍길동)에 기록, 담당은 기존 리드 담당
  const [hong] = await sql`select id, owner_id from sales_leads where name = '홍길동'`;
  const id3 = addLead('2000000000000002', { full_name: '홍길동', phone_number: '+82 10-1234-5678', '문의': '주말 상담 가능?' });
  await hook(payload(id3));
  const m3 = await settled(id3);
  assert.equal(m3.status, 'merged'); assert.equal(m3.lead_id, hong.id); assert.equal(m3.owner_id, hong.owner_id);
  assert.equal((await sql`select count(*)::int n from sales_leads where name = '홍길동'`)[0].n, 1);
  const [rec] = await sql`select data from sales_lead_records where lead_id = ${hong.id} and kind = 'sales_activities'`;
  assert.match(rec.data.content, /리드 광고로 다시 신청/); assert.match(rec.data.content, /문의: 주말 상담 가능\?/); assert.equal(rec.data.source, 'meta_lead');
  const [t3] = await sql`select title from tasks where id = ${m3.task_id}`;
  assert.equal(t3.title, '[리드 광고] 홍길동 — 다시 신청, 5분 안에 첫 연락');
});

test('첫 연락: [전화] 누름·상담 기록 → 첫 연락 시각 · 5분 넘게 없으면 담당·관리자 재알림(한 번)', async () => {
  const [kim] = await sql`select id, lead_id from mkt_meta_leads where leadgen_id = '2000000000000001'`;
  const [hong] = await sql`select id, lead_id from mkt_meta_leads where leadgen_id = '123456789012345678'`;
  // 김영희: 담당(이직원)이 리드 상세 [전화] — 영업 공간 사람만, 다른 회사·없는 리드는 아무것도 안 바뀜
  assert.equal((await ctx.staffB.client.post(`/api/sales/leads/${kim.lead_id}/touch`, { via: 'tel' })).status, 404, '영업 공간 밖은 404');
  const t = await ctx.staffA.client.ok('POST', `/api/sales/leads/${kim.lead_id}/touch`, { via: 'tel' });
  assert.equal(t.marked, 1);
  // 홍길동: 10분 전 신청인데 연락 기록 없음 → 점검이 재알림
  await sql`update mkt_meta_leads set received_at = now() - interval '10 minutes', created_time = now() - interval '10 minutes' where id = ${hong.id}`;
  await tick();
  const [h] = await sql`select contacted_at, late_notified_at from mkt_meta_leads where id = ${hong.id}`;
  assert.equal(h.contacted_at, null); assert.ok(h.late_notified_at);
  const late = await sql`select user_id, title from notifications where dedupe_key = ${`lead_ad_late:${hong.id}`} order by user_id`;
  assert.ok(late.length >= 1); assert.ok(late.some((x) => x.user_id === ctx.ownerId), '관리자(대표)'); assert.match(late[0].title, /리드 광고 신청 1\d분째 연락 전 · 홍\*동/);
  await tick();
  assert.equal((await sql`select count(*)::int n from notifications where dedupe_key = ${`lead_ad_late:${hong.id}`}`)[0].n, late.length, '재알림은 한 번');
  // 그 뒤 상담 기록 → 첫 연락으로 채움(보고서를 열면 바로)
  await ctx.owner.ok('POST', `/api/sales/leads/${hong.lead_id}/activities`, { type: '전화', content: '통화 — 토요일 방문 예약' });
  const rep = await ctx.owner.ok('GET', '/api/marketing/lead-ads');
  const [h2] = await sql`select contacted_at, contact_via from mkt_meta_leads where id = ${hong.id}`;
  assert.ok(h2.contacted_at); assert.equal(h2.contact_via, '상담 기록');
  const [k2] = await sql`select contacted_at, contact_via from mkt_meta_leads where id = ${kim.id}`;
  assert.ok(k2.contacted_at); assert.equal(k2.contact_via, '전화');
  const row = rep.recent.find((r) => r.id === kim.id);
  assert.equal(row.name, '김*희', '보고서도 이름 가림'); assert.ok(row.contactMin <= 5); assert.equal(row.contactVia, '전화');
  assert.equal(rep.recent.find((r) => r.id === hong.id).contactMin >= 10, true);
});

test('놓친 리드 불러오기: 웹후크 없이 양식 리드 읽기 → 처음 보는 것만 · 시험 리드(알림은 누른 사람만)', async () => {
  addLead('3000000000000001', { full_name: '박민수', phone_number: '010-7777-8888' }, { ad_id: '888' });
  const r = await ctx.owner.ok('POST', '/api/marketing/lead-ads/pull', { days: 3 });
  assert.equal(r.results[0].created, 1); assert.ok(r.results[0].seen >= 1);
  const [mp] = await sql`select status, via from mkt_meta_leads where leadgen_id = '3000000000000001'`;
  assert.deepEqual({ ...mp }, { status: 'created', via: 'poll' });
  assert.equal((await ctx.owner.ok('POST', '/api/marketing/lead-ads/pull', { days: 3 })).results[0].created, 0, '두 번 읽어도 한 번');
  // 시험 리드: 양식 목록 → [시험 리드 보내기](있던 시험 리드는 지우고 새로) → 바로 처리, 이름 [시험], 알림은 누른 사람만
  const forms = await ctx.owner.ok('GET', `/api/marketing/lead-ads/forms?accountId=${accountId}`);
  assert.deepEqual(forms.forms, [{ id: FORM, name: '가을 PT 상담', status: 'ACTIVE' }]);
  const t1 = await ctx.owner.ok('POST', '/api/marketing/lead-ads/test', { accountId, formId: FORM });
  assert.equal(t1.status, 'created');
  const [tl] = await sql`select l.name, l.owner_id, l.phone, l.src, m.is_test, m.via from mkt_meta_leads m join sales_leads l on l.id = m.lead_id where m.id = ${t1.id}`;
  assert.equal(tl.name, '[시험] 리드 광고 신청', '시험 값은 이름·전화로 쓰지 않음'); assert.equal(tl.phone, null); assert.equal(tl.is_test, true); assert.equal(tl.src.test, true);
  assert.equal(tl.owner_id, ctx.staffA.id, '담당은 규칙대로');
  const tn = await sql`select user_id from notifications where dedupe_key = ${`lead_ad:${t1.id}`}`;
  assert.deepEqual(tn.map((x) => x.user_id), [ctx.ownerId], '시험 알림은 누른 사람에게만(#104)');
  const t2 = await ctx.owner.ok('POST', '/api/marketing/lead-ads/test', { accountId, formId: FORM });
  assert.notEqual(t2.id, t1.id);
  assert.ok(calls.some((c) => c.method === 'DELETE' && /^\/graph\/\d+$/.test(c.path)), '양식당 시험 리드 1개 — 있던 것은 지움');
});

test('보고서: 받는 중·웹후크 마지막 수신 · 5분 안 연락 · 광고별 리드당 비용 · 직원은 보기만 · 공간 밖 404', async () => {
  const rep = await ctx.owner.ok('GET', '/api/marketing/lead-ads?days=7');
  assert.equal(rep.pages[0].enabled, true); assert.ok(rep.pages[0].webhookAt); assert.equal(rep.setup.webhook, true); assert.equal(rep.setup.devMode, true, '라이브 전 = 개발 모드 안내');
  // 시험 리드 2건은 빼고: 홍길동·김영희·박민수(새 리드 3) + 홍길동 다시 신청(기존 리드에 붙임 1)
  assert.deepEqual({ leads: rep.summary.leads, created: rep.summary.created, merged: rep.summary.merged, problems: rep.summary.problems }, { leads: 4, created: 3, merged: 1, problems: 0 });
  assert.ok(rep.summary.fast >= 1, '김영희 = [전화] 바로');
  const ad = rep.byAd.find((g) => g.key === '888');
  assert.deepEqual({ ad: ad.ad, leads: ad.leads, cost: ad.cost, cpl: ad.cpl }, { ad: '동네 주부 PT 소재', leads: 2, cost: 60000, cpl: 30000 });
  assert.ok(rep.recent.every((r) => !r.name || r.name.includes('*')), '이름은 가림');
  // 직원(마케팅 공간): 보기만
  const st = await ctx.staffA.client.ok('GET', '/api/marketing/lead-ads');
  assert.equal(st.canEdit, false); assert.equal(st.canSales, true);
  assert.equal((await ctx.staffA.client.post('/api/marketing/lead-ads/pull', { days: 1 })).status, 403);
  assert.equal((await ctx.staffA.client.post('/api/marketing/lead-ads/test', { accountId, formId: FORM })).status, 403);
  assert.equal((await ctx.staffA.client.req('PUT', `/api/marketing/lead-ads/pages/${accountId}`, { enabled: false })).status, 403);
  assert.equal((await ctx.staffB.client.get('/api/marketing/lead-ads')).status, 404, '마케팅 공간 밖은 404');
});

test('영업 공간 꺼짐 → 건너뜀(이유) → 켜고 [다시 처리] · 끄기 = 앱 설치 지움·웹후크 무시', async () => {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: false });
  const id = addLead('4000000000000001', { full_name: '최지우', phone_number: '010-2222-3333' });
  await hook(payload(id));
  const m = await settled(id);
  assert.equal(m.status, 'skipped'); assert.match(m.error, /영업 공간이 꺼져/); assert.equal(m.lead_id, null);
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  assert.equal((await ctx.owner.post(`/api/marketing/lead-ads/${m.id}/retry`, {})).status, 200);
  const [m2] = await sql`select status, lead_id from mkt_meta_leads where id = ${m.id}`;
  assert.equal(m2.status, 'created'); assert.ok(m2.lead_id);
  assert.equal((await ctx.owner.post(`/api/marketing/lead-ads/${m.id}/retry`, {})).status, 409, '처리된 것은 다시 안 함');
  // 끄기
  await ctx.owner.ok('PUT', `/api/marketing/lead-ads/pages/${accountId}`, { enabled: false });
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.path === `/graph/${PAGE}/subscribed_apps`));
  addLead('4000000000000002', { full_name: '정하늘', phone_number: '010-4444-5555' });
  assert.equal((await hook(payload('4000000000000002'))).body.received, 0, '끄면 웹후크 무시');
  // 리드 권한 없이 연결된 페이지는 켤 수 없음(다시 연결 안내)
  await sql`update mkt_publish_accounts set scopes = ${['pages_show_list', 'pages_manage_posts']} where id = ${accountId}`;
  const on = await ctx.owner.req('PUT', `/api/marketing/lead-ads/pages/${accountId}`, { enabled: true });
  assert.equal(on.status, 409); assert.match(on.body.error.message, /리드 광고 받기/);
  // [리드 광고 받기]에서 리드 권한을 끄면 안내(권한 없음 → 받기 안 켬)
  grantLeads = false;
  const go = new URL((await ctx.owner.get('/api/marketing/publish/connect/meta?leads=1')).headers.get('location'));
  const cb = await ctx.owner.get(`/api/marketing/publish/callback/meta?code=c2&state=${go.searchParams.get('state')}`);
  assert.ok(!/leads=/.test(cb.headers.get('location')));
  const ch = await ctx.owner.ok('GET', '/api/marketing/publish/channels');
  assert.ok(ch.channels.find((c) => c.key === 'facebook').accounts[0].warnings.some((w) => /리드 광고 권한/.test(w)));
  grantLeads = true;
});
