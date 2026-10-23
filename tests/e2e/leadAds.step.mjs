// 광고 2차 ① 리드 광고(메타) → 영업 리드: 광고 운영 '리드 광고' 상자(받는 중·웹후크 마지막 수신·요약·최근 신청 이름 가림·첫 연락·재알림·광고별 리드당 비용)
// · 실패 [다시 처리](실제 처리 — 토큰 없는 페이지라 '건너뜀'+이유) · 휴대폰 폭 → 연결 계정 '리드 광고 받는 중' → 영업 리드 상세 '리드 광고' 상자(양식·광고·질문 답·[전화] 누르면 첫 연락 기록)
// 시험 서버에는 가짜 Meta 가 없다 → 페이지 연결·신청 기록은 DB 에 만들고, 웹후크·리드 읽기·시험 리드는 tests/api/meta-leads.test.mjs 에서
import assert from 'node:assert/strict';

export async function leadAds({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await owner.setViewportSize({ width: 1366, height: 900 });
  const scopes = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish', 'business_management', 'leads_retrieval', 'pages_manage_ads', 'pages_manage_metadata', 'ads_management'];
  const [acc] = await sql`insert into mkt_publish_accounts (tenant, provider, external_id, label, token_enc, scopes, status, created_by) values ('default', 'meta_fb', '880001', 'E2E 다짐 본점', null, ${scopes}, 'active', ${ctx.ownerId})
    on conflict (tenant, provider, external_id) do update set label = excluded.label, scopes = excluded.scopes returning id`;
  await sql`insert into mkt_lead_pages (account_id, tenant, page_id, enabled, enabled_by, subscribed_at, webhook_at, polled_at) values (${acc.id}, 'default', '880001', true, ${ctx.ownerId}, now(), now() - interval '3 minutes', now() - interval '10 minutes')
    on conflict (account_id) do update set enabled = true, webhook_at = excluded.webhook_at`;
  const [ma] = await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, created_by) values ('default', 'meta', 'e2e-act-1', 'E2E 메타 광고', ${ctx.ownerId}) returning id`;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  await sql`insert into mkt_ad_items (account_id, day, kind, item_id, item_name, campaign_name, impressions, clicks, cost_krw) values (${ma.id}, ${today}, 'ad', '888', '동네 주부 PT 소재', '동네 리드', 4000, 90, 45000)`;
  const ago = (min) => new Date(Date.now() - min * 60e3);
  const [l1] = await sql`insert into sales_leads (tenant, name, status, owner_id, contact_name, phone, email, next_contact_date, src) values ('default', 'E2E 홍길동', '신규리드', ${ctx.ownerId}, 'E2E 홍길동', '010-1234-5678', 'hong@example.com', ${today},
    ${sql.json({ from: 'meta_lead', formName: '가을 PT 상담', adName: '가을 PT 이벤트 A', createdTime: ago(20).toISOString(), answers: [{ q: 'full_name', a: 'E2E 홍길동' }, { q: 'phone_number', a: '+821012345678' }, { q: '희망_운동', a: 'PT 주 2회' }] })}) returning id`;
  const [l2] = await sql`insert into sales_leads (tenant, name, status, owner_id, phone, next_contact_date, src) values ('default', 'E2E 김영희', '신규리드', ${ctx.ownerId}, '010-5555-6666', ${today}, ${sql.json({ from: 'meta_lead', formName: '가을 PT 상담' })}) returning id`;
  const row = (o) => sql`insert into mkt_meta_leads ${sql({ tenant: 'default', account_id: acc.id, page_id: '880001', via: 'webhook', form_name: '가을 PT 상담', owner_id: ctx.ownerId, ...o })} returning id`;
  await row({ leadgen_id: 'e2e-9001', status: 'created', lead_id: l2.id, ad_id: '888', ad_name: '동네 주부 PT 소재', created_time: ago(30), received_at: ago(30), contacted_at: ago(28), contact_via: '전화' });
  await row({ leadgen_id: 'e2e-9002', status: 'created', lead_id: l1.id, ad_id: '777', ad_name: '가을 PT 이벤트 A', created_time: ago(20), received_at: ago(20), late_notified_at: ago(14) });
  await row({ leadgen_id: 'e2e-9003', status: 'failed', owner_id: null, received_at: ago(5), error: 'Meta API 오류 400 /9003 (#200) Requires leads_retrieval permission' });

  await owner.goto(`${BASE}/s/marketing/ad-ops`);
  const box = owner.getByTestId('lead-ads');
  await box.getByTestId('lead-ads-row').first().waitFor();
  assert.match(await box.getByTestId('lead-ads-summary').innerText(), /신청 2건\(새 리드 2 · 기존 리드에 붙임 0\) · 5분 안 첫 연락 1\/2 · 첫 연락까지 중간값 2분 · 연락 전 1건 · 처리 못 함 1건/);
  const page = box.getByTestId('lead-ads-page').filter({ hasText: 'E2E 다짐 본점' });
  assert.equal(await page.getAttribute('data-state'), 'on');
  assert.match(await page.getByTestId('lead-ads-webhook').innerText(), /웹후크 마지막 수신 .+ · 놓친 리드 확인/);
  assert.equal(await page.getByTestId('lead-ads-devmode').innerText(), '개발 모드: 실제 광고 리드는 30분마다 불러오기로 들어옵니다(앱 심사·라이브 뒤 실시간)', '로컬 10/23 #469');
  const rows = box.getByTestId('lead-ads-row');
  assert.equal(await rows.count(), 3);
  const late = rows.filter({ hasText: '가을 PT 이벤트 A' });
  assert.equal(await late.getByTestId('lead-ads-contact').innerText(), '연락 전(재알림 보냄)');
  assert.match(await late.innerText(), /E\*\*\*동/, '마케팅 화면에서는 이름 가림');
  assert.match(await rows.filter({ hasText: '동네 주부 PT 소재' }).getByTestId('lead-ads-contact').innerText(), /^2분 · 전화$/);
  assert.match(await box.getByTestId('lead-ads-ad').filter({ hasText: '동네 주부 PT 소재' }).innerText(), /1\s+1\/1\s+45,000원\s+45,000원/, '광고별 리드당 비용');
  await box.screenshot({ path: `${SHOTS}/205-lead-ads.png` });
  // 실패 → [다시 처리]: 실제 처리(이 페이지는 토큰이 없어 '건너뜀' + 다시 연결 안내)
  await rows.filter({ has: owner.getByTestId('lead-ads-retry') }).getByTestId('lead-ads-retry').click();
  await owner.getByText('다시 처리했습니다').waitFor();
  await box.locator('[data-testid=lead-ads-row][data-status=skipped]').getByText(/페이지 연결이 끊겨/).waitFor();
  // 휴대폰 폭: 표는 상자 안에서만 옆으로
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/ad-ops`);
  await owner.getByTestId('lead-ads-row').first().waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 연결 계정: 페이스북 페이지 줄에 '리드 광고 받는 중'
  await owner.goto(`${BASE}/s/marketing/connections`);
  await owner.getByTestId('publish-account-leads').filter({ hasText: '리드 광고 받는 중' }).waitFor();
  // 영업 리드 상세: '리드 광고' 상자(양식·광고·질문 답) + [전화] = 첫 연락 기록
  await owner.goto(`${BASE}/s/sales/leads?id=${l1.id}`);
  const meta = owner.getByTestId('lead-meta-box'); await meta.waitFor();
  assert.match(await meta.innerText(), /리드 광고\(메타\)[\s\S]*양식 가을 PT 상담 · 광고 가을 PT 이벤트 A/);
  assert.match(await meta.getByTestId('lead-meta-answers').innerText(), /희망 운동\s+PT 주 2회/);
  await meta.getByTestId('lead-meta-call').evaluate((a) => a.addEventListener('click', (e) => e.preventDefault())); // 전화 앱 열기는 막고 기록 요청만 확인
  const touched = owner.waitForResponse((r) => r.url().includes(`/api/sales/leads/${l1.id}/touch`) && r.request().method() === 'POST');
  await meta.getByTestId('lead-meta-call').click();
  assert.equal((await touched).status(), 200);
  const [m] = await sql`select contacted_at, contact_via from mkt_meta_leads where lead_id = ${l1.id}`;
  assert.ok(m.contacted_at); assert.equal(m.contact_via, '전화');
  await owner.screenshot({ path: `${SHOTS}/206-lead-meta.png` });
  // 정리
  await sql`delete from mkt_meta_leads where account_id = ${acc.id}`;
  await sql`delete from sales_leads where id in (${l1.id}, ${l2.id})`;
  await sql`delete from mkt_publish_accounts where id = ${acc.id}`;
  await sql`delete from mkt_ad_accounts where id = ${ma.id}`;
}
