// 대표 검수 10/20 ②: 앱 영업 공간 전체 화면을 360/390/430 폭으로 캡처 → docs/screens/sales-app/ (검수용 도구, 자동 시험 아님)
// 실행: node tests/e2e/_sales-shots.mjs  (시험 DB 초기화 → 서버 → 영업 켜기 → 원본 자료 심기 → 캡처)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { bootstrap, resetDb, startServer, testDb, BASE } from '../helpers.mjs';

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const plus = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
await resetDb(); const srv = await startServer(); const sql = testDb(); const ctx = await bootstrap();
const put = (scope, tbl, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values (${scope}, ${tbl}, ${String(row.id)}, ${sql.json(row)})`;
// 영업관리 원본처럼 생긴 자료(영문 키·0.00·영문 날짜·id 노출 등 문제가 드러나게 일부러 원본 그대로)
await put('default', 'leads', { id: 'L1', name: '판교 더샵 퍼스트파크 관리사무소', sales_status: '미팅예정', priority: 'high', region: '경기', facility_type: '아파트 커뮤니티', next_contact_date: plus(2), owner_id: 'P1', updated_at: `${today}T09:12:00Z`, phone: '031-123-4567', contact_name: '김소장', expected_revenue: '0.00', interests: ['커뮤니티 위탁', 'GX'], homepage: 'https://www.pangyo-thesharp.co.kr' });
await put('default', 'leads', { id: 'L2', name: '강남 래미안 커뮤니티센터', sales_status: '제안서발송완료', region: '서울', next_contact_date: plus(-1), owner_id: 'P2', phone: '02-555-0101', expected_revenue: '12500000.00', updated_at: '2026-10-18T02:00:00Z' });
await put('default', 'leads', { id: 'L3', name: '부산 수영장 운영 위탁(해운대구청)', sales_status: '미팅예정', region: '부산', updated_at: 'Sat Oct 18 2026' });
await put('default', 'leads', { id: 'L4', name: '종결 리드', sales_status: '실패', region: '천안용곡 두산위브', next_contact_date: plus(-3) });
await put('default', 'sales_activities', { id: 'A1', lead_id: 'L1', kind: '전화', memo: '견적 요청, 11월 초 미팅 희망', created_at: `${today}T01:00:00Z`, user_id: 'P1' });
await put('default', 'opportunity_work', { id: 'W1', notice_id: '11', status: '검토 중', lead_id: 'L1', memo: '현장 설명회 10/25' });
await put('global', 'procurement_notices', { id: 11, title: '성남시 체육시설 위탁운영 사업자 선정', issuer: '성남시청 체육진흥과', region: '경기 성남', related: true, first_seen_at: `${today}T00:30:00+09:00`, created_at: today, notice_date: today, deadline_at: `${plus(5)}T10:00:00`, current_status: '공고중', fit_score: 82, source: 'g2b', source_url: 'https://www.g2b.go.kr/notice/20261020-1', attachment_urls: ['https://www.g2b.go.kr/files/notice-20261020-1.hwp', 'https://www.g2b.go.kr/files/spec.pdf'], budget: '385000000.00', complex_name: '성남 분당 스포츠센터', households: 1250, industry: '체육시설 운영', office_phone: '031-729-2600', matched_keywords: ['위탁운영', '체육시설'], classification: '즉시 검토', representative_judgment: '참여 — 운영 실적 요건 충족' });
await put('global', 'procurement_notices', { id: 15, title: 'LH 행복주택 커뮤니티 운영 용역', issuer: 'LH 경기남부본부', related: true, first_seen_at: plus(-2), deadline_at: `${plus(8)}T14:00:00`, current_status: '입찰진행', source: 'lh', budget: 0, source_url: 'https://ebid.lh.or.kr/x/1' });
await put('global', 'procurement_notices', { id: 13, title: '낙찰된 공고 — 수원 아파트 피트니스 운영', related: true, first_seen_at: plus(-30), deadline_at: `${plus(-10)}T10:00:00`, current_status: '낙찰', winner_name: '(주)좋은운동', award_amount: '98000000.00', award_date: plus(-9) });
await put('global', 'procurement_notices', { id: 17, title: '사전규격: 용인시 수영장 운영', related: true, source: 'g2b_pre', first_seen_at: plus(-2), deadline_at: `${plus(10)}T10:00:00` });
await put('default', 'procurement_notices__progress', { id: 11, classification: '즉시 검토', representative_judgment: '참여' });
await put('global', 'building_sales_pipeline', { id: 'B1', name: '판교 새단지(가칭) 1·2블록', households: 1200, address: '경기 성남시 분당구 판교동 123-4', approval_date: '2026-03-02', completion_date: '2027-11', move_in_date: '2027-12', developer: '(주)판교개발', builder: '대우건설', status: '영업 전', priority: 'medium', building_type: '아파트', region: '경기', first_seen_at: today });
await put('global', 'building_sales_pipeline', { id: 'B2', name: '동탄 레이크 2차', households: 860, address: '경기 화성시', status: '제안 중', region: '경기' });
await put('global', 'operating_facility_prospects', { id: 'F1', name: '수원 아파트 커뮤니티', score: 88, address: '경기 수원시 영통구 광교로 100', households: 1500, facility_type: '아파트', region: '경기', current_operator: '(주)A위탁', office_phone: '031-222-3333', amenities: '피트니스, 수영장, GX룸, 골프연습장', use_approval_date: '2024-05-13', move_in_date: '2024-06-01', first_seen_at: today, verdict: '즉시 영업' });
await put('default', 'operating_facility_prospects__progress', { id: 'F1', contact_status: '연락함', next_action_date: plus(3), last_note: '소장 통화, 계약 만료 2027-02' });
await put('global', 'vendor_registrations', { id: 'V1', company: '좋은관리(주)', rank: 3, category: '종합관리', recruit_open: true, recruit_period: '연중', requirements: '체육시설업 등록, 운영 실적 2건', certificate: '필요', notice_title: '2026 협력사 모집', url: 'https://good-mgmt.co.kr/notice/1', apply_url: 'https://good-mgmt.co.kr/apply', homepage: 'https://good-mgmt.co.kr', first_seen_at: today });
await sql`insert into sales_user_map (tenant, src_user_id, user_id, name, matched) values ('default', 'P1', ${ctx.ownerId}, '대표', true), ('default', 'P2', ${ctx.staffA.id}, '이직원', true)`;
await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });

const dir = 'docs/screens/sales-app'; mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
const [name, value] = ctx.owner.cookie.split(';')[0].split('=');
const pages = [['home', '/s/sales'], ['leads', '/s/sales/leads'], ['lead-detail', '/s/sales/leads?id=L1'], ['pipeline', '/s/sales/pipeline'], ['deals', '/s/sales/deals'], ['bids', '/s/sales/bids'], ['bids-working', '/s/sales/bids?tab=working'],
  ['hub-buildings', '/s/sales/hub'], ['hub-facilities', '/s/sales/hub?tab=facilities'], ['hub-vendors', '/s/sales/hub?tab=vendors'], ['prospects', '/s/sales/prospects'], ['regions', '/s/sales/regions'], ['sources', '/s/sales/sources']];
for (const w of [360, 390, 430]) {
  const c = await browser.newContext({ viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await c.addCookies([{ name, value: decodeURIComponent(value), url: BASE }]);
  const p = await c.newPage();
  for (const [slug, path] of pages) {
    await p.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => {});
    await p.waitForTimeout(600);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await p.screenshot({ path: `${dir}/${w}-${slug}.png`, fullPage: true });
    console.log(`${w} ${slug} overflow=${over}`);
  }
  await c.close();
}
await browser.close(); srv.proc.kill(); await sql.end();
