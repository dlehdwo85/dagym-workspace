// 186차(로컬 10/26 19:20 B1·B2): 신규 공동주택 단지 수집기(K-apt 단지 목록 15057332 매일 차이 + 기본정보 15058453) · 청약홈 4년 채우기 · 입주 시기 목록
// 가짜 원천 서버로 보는 구조 시험 — 실제 data.go.kr 응답·활용신청 승인은 운영에서 따로 확인
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const PORT = 3253;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date());
const plusDays = (n) => kst(new Date(Date.now() + n * 864e5));
const ymd8 = (s) => s.replace(/-/g, '');
const ym = (add) => { const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date()).split('-').map(Number); return new Date(Date.UTC(y, m - 1 + add, 1)).toISOString().slice(0, 10); };
let srv, ctx, sql, fake; const hits = [];
const LIST = Array.from({ length: 2350 }, (_, i) => ({ bjdCode: '1168010300', kaptCode: `A1${String(i).padStart(7, '0')}`, kaptName: `기존단지 ${i}`, as1: '서울특별시', as2: '강남구', as3: '개포동' }));
const NEW = [
  { kaptCode: 'A2000001', kaptName: '개포 새단지', usedate: plusDays(-60) }, // 18개월 안 → 입주중
  { kaptCode: 'A2000002', kaptName: '수서 예정단지', usedate: plusDays(60) }, // 1년 안 예정 → 입주예정
  { kaptCode: 'A2000003', kaptName: '오래된 등록단지', usedate: plusDays(-1200) }, // 18개월 밖 → 안 넣음
  { kaptCode: 'A2000004', kaptName: '정보 없는 단지', usedate: null }, // 기본정보 없음(NODATA)
];
const BASIS = {}, DETAIL = {};
for (const n of NEW) if (n.usedate) {
  BASIS[n.kaptCode] = { kaptCode: n.kaptCode, kaptName: n.kaptName, kaptAddr: `서울특별시 강남구 개포동 12 ${n.kaptName}`, doroJuso: '서울특별시 강남구 개포로 100', codeAptNm: '아파트', codeMgrNm: '위탁관리',
    kaptdaCnt: '1234', kaptDongCnt: '12', kaptBcompany: '좋은건설', kaptTel: '02-555-1234', kaptUsedate: ymd8(n.usedate) };
  DETAIL[n.kaptCode] = { kaptCode: n.kaptCode, welfareFacility: '관리사무소, 주민공동시설, 피트니스센터' };
}
let basisBlocked = false;
const APT = Array.from({ length: 2150 }, (_, n) => ({ HOUSE_MANAGE_NO: `H${n}`, PBLANC_NO: `P${n}`, HOUSE_NM: `분양 단지 ${n}`, HOUSE_DTL_SECD_NM: '민영', HSSPLY_ADRES: '경기도 성남시 분당구 판교로 10',
  TOT_SUPLY_HSHLDCO: 300, RCRIT_PBLANC_DE: today, MVN_PREARNGE_YM: '202903' }));
const ok = (body) => JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' }, body } });
const run = () => ctx.owner.ok('POST', '/api/sales/collectors/kapt_new_complexes/run', {});
const listHits = () => hits.filter((h) => h.path === '/aptlist/getTotalAptList4').length;

before(async () => {
  fake = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); hits.push({ path: u.pathname, q: Object.fromEntries(u.searchParams) });
    res.setHeader('content-type', 'application/json');
    if (u.pathname === '/aptlist/getTotalAptList4') {
      if (u.searchParams.get('serviceKey') !== 'kapt-key') { res.statusCode = 401; return res.end('{}'); }
      const page = Number(u.searchParams.get('pageNo')), n = Number(u.searchParams.get('numOfRows'));
      return res.end(ok({ items: LIST.slice((page - 1) * n, page * n), numOfRows: n, pageNo: page, totalCount: LIST.length }));
    }
    if (u.pathname.startsWith('/aptbasis/')) {
      if (basisBlocked) { res.setHeader('content-type', 'text/xml'); return res.end('<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>'); }
      const m = u.pathname.endsWith('/getAphusBassInfoV5') ? BASIS : DETAIL; const item = m[u.searchParams.get('kaptCode')];
      if (!item) return res.end(JSON.stringify({ response: { header: { resultCode: '03', resultMsg: 'NODATA_ERROR' }, body: {} } }));
      return res.end(ok({ item }));
    }
    if (u.pathname.endsWith('/getAPTLttotPblancDetail')) { const page = Number(u.searchParams.get('page')); return res.end(JSON.stringify({ page, perPage: 100, matchCount: APT.length, data: APT.slice((page - 1) * 100, page * 100) })); }
    if (u.pathname.endsWith('LttotPblancDetail')) return res.end(JSON.stringify({ page: 1, matchCount: 0, data: [] }));
    res.statusCode = 404; res.end('{}');
  }).listen(PORT);
  await resetDb();
  srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}`, KAPT_SERVICE_KEY: 'kapt-key', DATA_GO_KR_SERVICE_KEY: 'test-key' });
  sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`update data_sources set endpoint = ${`http://localhost:${PORT}/api/ApplyhomeInfoDetailSvc/v1`} where code = '15098547'`;
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('B1: 처음 한 바퀴 = 기준 목록(새 단지 0) · 같은 날 다시 돌리면 목록은 안 읽음 · 다음 바퀴에 새로 등록된 단지만 → 기본정보(활용신청 안 됐으면 멈춤·2번이면 알림) → 18개월 안만 준공·입주 시설(단지 코드로 한 줄)', async () => {
  const r1 = await run();
  assert.equal(r1.status, 'success', JSON.stringify(r1)); assert.match(r1.summary, /기준 목록 완성\(전국 2,350곳\)/); assert.match(r1.summary, /새로 등록된 단지 0곳/);
  assert.equal(listHits(), 3, '1,000곳씩 3쪽');
  assert.equal((await sql`select count(*)::int n from sales_src_rows where tbl = 'kapt_complex_codes'`)[0].n, 2350);
  assert.equal((await sql`select count(*)::int n from sales_src_rows where tbl = 'kapt_complex_codes' and row->>'fresh' = 'true'`)[0].n, 0, '기준 목록은 새 단지 아님');
  const [st] = await sql`select row from sales_src_rows where tbl = 'kapt_complex_scan' and src_id = 'state'`;
  assert.deepEqual([st.row.baseline_done, st.row.scans, st.row.page, st.row.last_full_scan_day, st.row.total], [true, 1, 1, today, 2350]);
  const r2 = await run();
  assert.match(r2.summary, /단지 목록 오늘 한 바퀴 읽음/); assert.equal(listHits(), 3, '같은 날은 목록을 다시 읽지 않음');

  // K-apt 사업자선정 파생으로 이미 있는 단지(같은 단지 코드) — 새 단지 정보가 같은 줄에 붙어야 함
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'operating_facility_prospects', 'F-KAPT', ${sql.json({ id: 'F-KAPT', dedupe_key: '아파트|code:A2000001', facility_type: '아파트', name: '개포새단지(사업자선정)',
    operating_status: '운영중', current_operator: '좋은운영', source_slug: 'operating_from_kapt', source_name: 'K-apt 사업자선정 결과', source_url: 'https://www.k-apt.go.kr/x', source_external_id: 'BID-1' })}, 'workin')`;
  LIST.push(...NEW.map((n) => ({ bjdCode: '1168010300', kaptCode: n.kaptCode, kaptName: n.kaptName, as1: '서울특별시', as2: '강남구', as3: '개포동' })));
  await sql`update sales_src_rows set row = row || '{"last_full_scan_day":"2000-01-01"}'::jsonb where tbl = 'kapt_complex_scan' and src_id = 'state'`; // 다음 날처럼
  basisBlocked = true;
  const r3 = await run();
  assert.equal(r3.status, 'failed'); assert.match(r3.summary, /새로 등록된 단지 4곳 · 기본정보 확인 0곳\(남은 4\)/);
  assert.match(r3.errorLog, /활용신청 필요\(서비스 15058453\)/);
  assert.equal(r3.sources.apt_list.ok, true); assert.equal(r3.sources.apt_basis.ok, false);
  assert.equal(hits.filter((h) => h.path.startsWith('/aptbasis/')).length, 1, '활용신청이 안 됐으면 첫 단지에서 멈춤');
  await run(); // 두 번째 실패 → 알림(기본정보 원천만, 서비스 번호로 [신청 방법])
  const al = (await ctx.owner.ok('GET', '/api/sales/collectors')).alerts.find((x) => x.slug === 'kapt_new_complexes');
  assert.ok(al, '2회 연속 실패 알림'); assert.equal(al.source, 'apt_basis'); assert.equal(al.service, '15058453'); assert.equal(al.action, 'apply'); assert.match(al.label, /기본정보/);

  basisBlocked = false;
  const r5 = await run();
  assert.equal(r5.status, 'success', JSON.stringify(r5));
  assert.match(r5.summary, /기본정보 확인 4곳\(남은 0\) → 사용승인 18개월 안 2곳\(신규 1 · 갱신 1\)/);
  const fac = async (ext) => (await sql`select src_id, row from sales_src_rows where tbl = 'operating_facility_prospects' and row->>'source_external_id' = ${ext}`);
  const [a] = await fac('A2000001');
  assert.equal(a.src_id, 'F-KAPT', '같은 단지 코드 줄에 붙음(새 줄 아님)');
  assert.deepEqual([a.row.name, a.row.operating_status, a.row.completion_date, a.row.household_count, a.row.office_phone, a.row.current_operator, a.row.region],
    ['개포 새단지', '입주중', NEW[0].usedate, 1234, '02-555-1234', '좋은운영', '서울 강남구']);
  assert.match(a.row.amenities, /피트니스센터/); assert.match(a.row.scale_note, /1,234세대 · 12개 동 · 관리 위탁관리 · 시공 좋은건설/);
  const [b] = await fac('A2000002'); assert.ok(b); assert.deepEqual([b.row.operating_status, b.row.completion_date], ['입주예정', NEW[1].usedate]);
  assert.equal((await fac('A2000003')).length, 0, '사용승인 18개월 밖은 안 넣음');
  const codes = Object.fromEntries((await sql`select src_id, row from sales_src_rows where tbl = 'kapt_complex_codes' and src_id like 'A2%'`).map((x) => [x.src_id, x.row]));
  assert.equal(codes.A2000003.recent, false); assert.equal(codes.A2000003.usedate, NEW[2].usedate);
  assert.equal(codes.A2000004.check_error, '기본정보 없음'); assert.ok(codes.A2000004.checked_at, '자료 없는 단지는 다시 묻지 않음');
  assert.ok(!(await ctx.owner.ok('GET', '/api/sales/collectors')).alerts.some((x) => x.slug === 'kapt_new_complexes'), '성공하면 알림 사라짐');
  // 영업기회 허브 '준공·입주 시설' 탭에 관리사무소 전화·부대시설·준공일
  const hub = await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=facilities');
  const card = hub.items.find((x) => x.name === '개포 새단지');
  assert.ok(card, JSON.stringify(hub.items.map((x) => x.name)));
  assert.deepEqual([card.phone, card.date, card.households], ['02-555-1234', NEW[0].usedate, 1234]); assert.match(card.amenities, /피트니스센터/);
  assert.ok(hub.items.some((x) => x.name === '수서 예정단지'));
});

test('B3(212차 #612 ①): 빈 칸 다시 확인 — K-apt 단지 코드(같은 단지 키)가 있는 준공·입주 시설 줄의 빈 전화·부대시설·세대수만 채움 · 단지마다 7일에 한 번', async () => {
  BASIS.A2000009 = { kaptCode: 'A2000009', kaptName: '빈칸 단지', kaptdaCnt: '777', kaptTel: '02-999-0009', kaptUsedate: ymd8(plusDays(-30)) };
  DETAIL.A2000009 = { kaptCode: 'A2000009', welfareFacility: '경로당, 피트니스' };
  const base = { facility_type: '아파트', operating_status: '입주중', source_slug: 'kapt_new_complexes', source_name: 'K-apt', source_url: 'https://x', completion_date: plusDays(-30) };
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'operating_facility_prospects', 'F-GAP',
    ${sql.json({ id: 'F-GAP', ...base, dedupe_key: '아파트|code:A2000009', name: '빈칸 단지', office_phone: null, current_operator: '있는 값' })}, 'workin')`;
  const basisHits = () => hits.filter((h) => h.path.startsWith('/aptbasis/')).length;
  const h0 = basisHits();
  const r = await run();
  assert.match(r.summary, /빈 칸 다시 확인 1곳\(채움 1\)/, r.summary);
  assert.equal(basisHits() - h0, 2, '기본·상세 한 번씩');
  const row = async () => (await sql`select row from sales_src_rows where src_id = 'F-GAP'`)[0].row;
  const g = await row();
  assert.deepEqual([g.office_phone, g.household_count, g.amenities, g.current_operator, g.name], ['02-999-0009', 777, '경로당, 피트니스', '있는 값', '빈칸 단지'], '빈 칸만 채움');
  await sql`update sales_src_rows set row = row - 'amenities' where src_id = 'F-GAP'`;
  const r2 = await run();
  assert.doesNotMatch(r2.summary, /빈 칸 다시 확인/, '7일 안에는 다시 안 읽음');
  await sql`update sales_src_rows set row = jsonb_set(row, '{at}', to_jsonb(${new Date(Date.now() - 8 * 864e5).toISOString()}::text)) where tbl = 'kapt_recheck' and src_id = 'A2000009'`;
  const r3 = await run();
  assert.match(r3.summary, /빈 칸 다시 확인 1곳\(채움 1\)/, r3.summary);
  assert.equal((await row()).amenities, '경로당, 피트니스');
});

test('B2: 청약홈 처음 채우기 4년(1,461일) — 400일 넘으면 종류마다 60쪽까지 · 1,500일 넘으면 400', async () => {
  const before4 = hits.length;
  const r = await ctx.owner.ok('POST', '/api/platform/sales-sources', { code: '15098547', run: true, days: 1461 });
  assert.equal(r.count, 2150, JSON.stringify({ ...r, since: r.since })); assert.equal(r.since, kst(new Date(Date.now() - 1461 * 864e5)));
  const aptHits = hits.slice(before4).filter((h) => h.path.endsWith('/getAPTLttotPblancDetail'));
  assert.equal(aptHits.length, 22, '2,150건 = 22쪽(예전 상한 20쪽이면 2,000건에서 끊김)'); assert.equal(aptHits[0].q['cond[RCRIT_PBLANC_DE::GTE]'], r.since);
  const r365 = await ctx.owner.ok('POST', '/api/platform/sales-sources', { code: '15098547', run: true, days: 365 });
  assert.equal(r365.count, 2000, '1년 채우기는 예전처럼 20쪽');
  assert.equal((await ctx.owner.req('POST', '/api/platform/sales-sources', { code: '15098547', run: true, days: 1501 })).status, 400);
});

test('B2: 입주 시기 목록 — 입주 예정월이 12개월 전 ~ 6개월 뒤인 청약홈 단지만, 입주가 가까운 순(242차)', async () => {
  for (const [k, add] of [['M-13', -13], ['M-12', -12], ['M-3', -3], ['M0', 0], ['M+6', 6], ['M+7', 7]]) {
    await sql`insert into prospects (source_code, ext_id, name, sido, status, opened_on, category, detail, raw, base_date)
      values ('15098547', ${'win:' + k}, ${'입주 ' + k}, '서울', '모집공고', ${today}, '민영', ${sql.json({ moveIn: ym(add) })}, ${sql.json({})}, current_date)`;
  }
  await ctx.owner.ok('PUT', '/api/sales/sources/15098547', { enabled: true });
  const win = (await ctx.owner.ok('GET', '/api/sales/prospects?moveIn=window')).prospects;
  assert.deepEqual(win.map((x) => x.name), ['입주 M0', '입주 M-3', '입주 M+6', '입주 M-12'], '2029년 입주 분양 2,150건·창 밖은 빠짐 · 242차 #759 입주가 가까운 순');
  const all = (await ctx.owner.ok('GET', '/api/sales/prospects')).prospects;
  assert.ok(all.length > win.length, '필터 없으면 전체');
});
