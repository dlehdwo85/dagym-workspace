// 대표 10/21 08:45: 영업 수집기 12개 이식 + 당일 입찰 다이제스트 — 구조 시험(가짜 원천 서버). 실제 원천 연동 완료가 아님.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { fakeKapt } from '../fakeKapt.mjs';

const PORT = 3231;
let srv, ctx, sql, fake, hits = [];
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const plus = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
const tr = (id, cells) => `<tr>${cells.map((c, i) => (i === 3 ? `<td><a href="javascript:goView('${id}')">${c}</a></td>` : `<td>${c}</td>`)).join('')}</tr>`; // 원본 K-apt: 제목 칸의 링크에 goView
const listHtml = (rows) => `<html><table>${rows.join('')}</table></html>`;
const KAPT_ROWS = [
  tr('20261021000001', ['1', 'K-APT', '최저가', '[서울강남] 커뮤니티 피트니스센터 위탁운영 사업자 선정', `${plus(5)} 14:00`, '공고중', '래미안 강남', `${today} 09:00`]),
  tr('20261021000002', ['2', '조달청', '적격심사', '[경기성남] 승강기 보수공사', `${plus(6)} 10:00`, '공고중', '분당 파크뷰', `${today} 09:10`]),
  tr('20261021000003', ['3', 'kg2b', '최저가', '[인천] 어린이집 운영자 선정', `${plus(7)} 10:00`, '공고중', '송도 더샵', `${today} 09:20`]),
];
const dataGo = (items) => JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' }, body: { items, numOfRows: 100, pageNo: 1, totalCount: items.length } } });
// #476: 시험마다 바꾸는 원천 — K-apt 목록 추가 줄·상세 입찰분류·공식 API(15058166) 응답·협력사 게시판
let kaptExtra = [], kaptApiItems = []; const detailCat = {};
// #507 후속: 상세(쿠키·_csrf) → 첨부 목록(POST JSON) — 로컬 10/23 실측 순서의 가짜 K-apt. 상세 본문은 원래 시험 표 그대로
const kapt = fakeKapt({ files: { '20261021000001': [{ seq: 7001, fileName: '래미안 강남 커뮤니티 위탁운영 입찰공고.hwp' }] },
  detailHtml: (bid) => `<table><tr><th>주택관리업자</th><th>단지명</th><th>관리사무소 주소</th><th>전화번호</th><th>팩스번호</th><th>동수</th><th>세대수</th></tr><tr><td>우리관리<td>래미안 강남<td>서울 강남구 역삼로 1<td>02-555-1234<td>02-555-1235<td>12<td>1,250</tr></table>
      <table><tr><th>입찰분류</th><td>${detailCat[bid] ?? '용역 &gt; 커뮤니티 위탁운영'}</td></tr><tr><th>입찰종류</th><td>일반경쟁</td></tr><tr><th>내용</th><td><pre>커뮤니티센터 피트니스·수영장 위탁운영 사업자 선정</pre></td></tr></table><a href="javascript:fileDown('7001')">공고문.hwp</a>` });
let agencyV2 = false, hotelMode = 'ok', lhFail = false; // #522: 새 명세(swagger) 응답 모양 · 관광숙박업 오류 응답(JSON) · 로컬 10/24 LH 오류 11
const ymd8 = (n) => plus(n).replace(/-/g, '');
let vendorStatus = 200, nuriMode = 'denied'; // 누리장터: denied(활용신청 전) · empty(정상 0건) · odd(칸 이름이 다른 응답) · ok(새 명세 칸 이름 — 로컬 10/23 운영 응답)
let vendorHtml = `<html><ul><li><a href="/notice/12">2026년 협력업체 정기등록 모집 안내</a> <span>${today}</span></li><li><a href="/notice/13">추석 연휴 안내</a></li></ul></html>`;
before(async () => {
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c; hits.push({ path: u.pathname, q: Object.fromEntries(u.searchParams), body });
    const send = (code, text, type = 'text/html; charset=utf-8') => { res.statusCode = code; res.setHeader('content-type', type); res.end(text); };
    if (u.pathname === '/kapt/bid/bidList.do') return send(200, u.searchParams.get('pageNo') === '1' ? listHtml([...KAPT_ROWS, ...kaptExtra]) : listHtml([]));
    if (u.pathname === '/kaptbidapi/getPblAncDeSearchV3') return send(200, dataGo(kaptApiItems), 'application/json');
    if (kapt.handle(req, res, body)) return;
    if (u.pathname === '/kapt/bid/bidResultList.do') return send(200, '<html><input name="_csrf" value="csrf-1"></html>');
    if (u.pathname === '/kapt/bid/bidResultListAjax.do') { const kw = new URLSearchParams(body).get('searchKeyword'); return send(200, JSON.stringify(kw === '커뮤니티' ? [{ bidNum: '20261021000001', bidTitle: '[서울강남] 커뮤니티 피트니스센터 위탁운영 사업자 선정', kaptName: '래미안 강남', sucsBidder: '다짐', sucsAmt: '120000000', sucsDate: today }] : []), 'application/json'); }
    if (u.pathname.startsWith('/g2b/ad/BidPublicInfoService/getBidPblancListInfoServcPPSSrch')) return send(200, dataGo(u.searchParams.get('bidNtceNm') === '피트니스' ? [{ bidNtceNo: '20261021001', bidNtceOrd: '00', bidNtceNm: '국민체육센터 피트니스 위탁운영 용역', ntceInsttNm: '성남시', dminsttNm: '성남시체육회', bidNtceDt: `${today} 09:00:00`, bidClseDt: `${plus(9)} 10:00:00`, opengDt: `${plus(9)} 11:00:00`, presmptPrce: '250000000', ntceKindNm: '일반', cntrctCnclsMthdNm: '제한경쟁', prtcptLmtRgnNm: '경기도', bidNtceDtlUrl: 'https://www.g2b.go.kr/x/1', ntceSpecDocUrl1: 'https://www.g2b.go.kr/f/1.hwp' }] : []), 'application/json');
    if (u.pathname.startsWith('/g2b/ad/BidPublicInfoService/')) return send(200, dataGo([]), 'application/json');
    if (u.pathname.startsWith('/g2b/ao/PrvtBidNtceService/')) return nuriMode === 'denied' ? send(200, '<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>', 'application/xml')
      : send(200, dataGo(nuriMode === 'odd' ? [{ ntceNo: 'N-1', ntceNm: '시험 민간 입찰' }] : nuriMode === 'ok' && u.searchParams.get('bidNtceNm') === '커뮤니티' && u.pathname.endsWith('ServcPPSSrch') ? [{ bidNtceNo: 'R26BK00000001', bidNtceOrd: '000', bidNtceClsfc: '용역', nticeDt: `${today} 09:30:00`, refNo: '관리-12', ntceNm: '광교 센트럴 커뮤니티센터 피트니스 위탁운영 업체 선정', ntceDivNm: '일반공고', ntceInsttNm: '광교센트럴 입주자대표회의', bidMethdNm: '전자입찰', cntrctMthdNm: '제한경쟁', sucsfbidMthdNm: '적격심사최저가', rbidDivNm: '재입찰 허용', bidQlfctNm: '공고규격서 참조', ofclNm: '홍길동', ofclTelNo: '010-1234-5678', ofclEmail: 'hong@example.com', bidBeginDt: `${today} 10:00:00`, bidClseDt: `${plus(8)} 17:00:00`, opengDt: `${plus(9)} 11:00:00`, refAmtOpenYn: 'Y', refAmt: '180000000', asignBdgtAmt: '200000000', rgnLmtDivNm: '공고서 참조', servcDtlList: '커뮤니티센터 피트니스·GX 위탁운영', ntceSpecDocUrl1: 'https://nuri.g2b.go.kr/f/spec1.hwp', ntceSpecDocNm1: '공고문.hwp', aptHsmpNm: '광교 센트럴', aptCeoAdrs: '경기도 수원시 영통구 광교중앙로 1', aptMngOfficeTelNo: '0312223333', aptHshldNum: '1,200', rgstDt: `${today} 09:30:00` }] : []), 'application/json');
    if (u.pathname.startsWith('/g2b/ao/HrcspSsstndrdInfoService/')) return send(200, dataGo([{ bfSpecRgstNo: 'PRE-1', prdctClsfcNoNm: '커뮤니티센터 운영 위탁 용역 사전규격', orderInsttNm: 'LH', rcptDt: `${today} 08:00:00`, opninRgstClseDt: `${plus(4)} 18:00:00`, asignBdgtAmt: '90000000' }, { bfSpecRgstNo: 'PRE-2', prdctClsfcNoNm: '도로 포장 공사 사전규격', orderInsttNm: '도로공사' }]), 'application/json');
    if (u.pathname.startsWith('/g2b/as/ScsbidInfoService/')) return send(200, dataGo(u.searchParams.get('bidNtceNm') === '피트니스' ? [{ bidNtceNo: '20261021001', bidNtceOrd: '00', bidNtceNm: '국민체육센터 피트니스 위탁운영 용역', bidwinnrNm: '하이링크', sucsfbidAmt: '240000000', opengDt: `${today} 11:00:00` }] : []), 'application/json');
    if (agencyV2 && u.pathname.startsWith('/agency/')) return agency522(u, send);
    if (u.pathname === '/agency/lh_bid') return send(200, dataGo([{ bidNum: 'LH-1', bidNm: '행복주택 커뮤니티시설 운영 위탁', ognzNm: 'LH', clseDt: `${plus(6)} 17:00`, bidAmt: '50000000' }]), 'application/json');
    if (u.pathname.startsWith('/agency/')) return send(403, '<r><returnReasonCode>SERVICE ACCESS DENIED</returnReasonCode></r>', 'application/xml');
    if (u.pathname === '/vendor/notice') return send(vendorStatus, vendorHtml);
    if (u.pathname === '/files/kicox.csv') return send(200, '﻿유형,시도,시군,단지명,조성상태,입주업체(개),가동업체(개),관리면적(천제곱미터)\n일반,경기,성남시,판교테크노밸리,완료,1200,1150,660\n일반,경기,화성시,동탄,조성중,30,0,100\n', 'text/csv');
    if (u.pathname === '/files/reb.csv') return send(200, `﻿단지고유번호,주소,단지명_공시가격,단지종류,세대수,동수,사용승인일,도로명주소\nA100,경기도 성남시 분당구 정자동 1,분당 새아파트,1,850,8,${plus(-100)},경기도 성남시 분당구 정자로 1\nA101,서울특별시 강남구 역삼동 2,옛날아파트,1,300,3,2010-01-01,\n`, 'text/csv');
    if (u.pathname === '/hotels/info' && hotelMode === 'denied') return send(401, JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', returnAuthMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', returnReasonCode: '30' } } }), 'application/json');
    if (u.pathname === '/hotels/info' && hotelMode === 'nocond' && u.searchParams.has('cond[SALS_STTS_CD::EQ]')) return send(200, JSON.stringify({ response: { header: { resultCode: '00' }, body: { totalCount: 0, items: '' } } }), 'application/json');
    if (u.pathname === '/hotels/info') return send(200, JSON.stringify({ response: { header: { resultCode: '00' }, body: { totalCount: 1, items: { item: [{ BPLC_NM: '판교 호텔', SALS_STTS_CD: '01', ROAD_NM_ADDR: '경기도 성남시 분당구 대왕판교로 1', GSRM_CNT: '320', LCPMT_YMD: '20200101', TOUR_LDGBIZ_DTL_NM: '관광호텔업', MNG_NO: 'H1' }] } } } }), 'application/json');
    if (u.pathname === '/kaptapi/getKaptBidResultList') return send(200, dataGo([{ bidNo: 'SA-1', kaptName: '래미안 강남', kaptCode: 'A10001', doroJuso: '서울 강남구 역삼로 1', sido: '서울', hhldCnt: '1250', bidCategoryName: '커뮤니티 시설 위탁운영', selectedCompany: '다짐', ctrtStartYmd: `${plus(-300)}`, ctrtEndYmd: `${plus(65)}` }, { bidNo: 'SA-2', kaptName: '분당 파크뷰', kaptCode: 'A10002', bidCategoryName: '승강기 유지보수', selectedCompany: '현대엘리베이터' }]), 'application/json');
    send(404, 'nope');
  }).listen(PORT);
  await resetDb(); srv = await startServer({ MAIL_DEV: '1', SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}`, DATA_GO_KR_SERVICE_KEY: 'test-key', KAPT_SERVICE_KEY: 'kapt-key' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('수집기 12개 목록 · K-apt 입찰공고(목록→관련 상세→적재, 비관련은 참고) · 다시 돌리면 변화없음 · origin=workin', async () => {
  const v = await ctx.owner.ok('GET', '/api/sales/collectors');
  assert.equal(v.collectors.length, 15, '영업 12 + 지원사업 3(#450)'); assert.deepEqual(v.collectors.map((c) => c.slug).slice(0, 3), ['kapt_sa_sun', 'operating_from_kapt', 'kicox_industrial_complexes']);
  assert.ok(v.collectors.find((c) => c.slug === 'kapt_sa_sun').needs[0].present, '시험 환경은 키 있음');
  assert.equal((await ctx.staffA.client.req('POST', '/api/sales/collectors/kapt_bid_notices/run', {})).status, 403, '지금 수집은 관리자');
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  assert.equal(r.status, 'success', JSON.stringify(r)); assert.equal(r.inserted, 3);
  const rows = await sql`select src_id, row, origin from sales_src_rows where tbl = 'procurement_notices' and scope = 'global' order by row->>'source_external_id'`;
  assert.equal(rows.length, 3); assert.ok(rows.every((x) => x.origin === 'workin'));
  const fit = rows[0].row; assert.equal(fit.source_type, 'kapt_bid'); assert.equal(fit.fit_business, '다짐'); assert.equal(fit.classification, '즉시 검토'); assert.equal(fit.related, true); assert.equal(fit.office_phone, '02-555-1234'); assert.equal(fit.household_count, 1250); assert.equal(fit.region, '서울강남'); assert.equal(fit.notice_kind, 'new');
  assert.match(fit.deadline_at, /\+09:00$/); assert.equal(fit.first_seen_at.slice(0, 10), new Date().toISOString().slice(0, 10)); assert.equal(fit.attachment_urls.length, 1);
  // #507 후속: 관련 새 공고는 상세 세션으로 첨부 목록(원래 이름·파일 번호) — 상세 HTML 의 javascript 링크는 쓰지 않음
  assert.equal(fit.attachment_urls[0].name, '래미안 강남 커뮤니티 위탁운영 입찰공고.hwp'); assert.match(fit.attachment_urls[0].url, /\/kapt\/cmm\/file\/BID\/fileDownload\.do\?key=7001&bidNum=20261021000001$/); assert.ok(fit.files_checked_at);
  const lists = kapt.calls.filter((c) => c.path === '/kapt/bid/bidFileListData.do'); assert.equal(lists.length, 1, '관련 공고 1건만');
  assert.match(lists[0].cookie, /JSESSIONID=/); assert.match(lists[0].csrf, /^csrf-/); assert.deepEqual(JSON.parse(lists[0].body), { bidNum: '20261021000001' });
  assert.match(r.summary, /첨부 목록 1건\(파일 1\)/, r.summary);
  assert.equal(rows[1].row.related, false, '승강기 보수공사 = 비관련'); assert.equal(rows[1].row.classification, '참고(비관련)');
  assert.equal(rows[2].row.fit_business, null, '어린이집은 제외 주제');
  const r2 = await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  assert.equal(r2.inserted, 0); assert.equal(r2.unchanged, 3);
  assert.equal(kapt.calls.filter((c) => c.path === '/kapt/bid/bidFileListData.do').length, 1, '이미 읽은 공고는 다시 읽지 않음(새 공고만)');
  const runs = await sql`select slug, status, trigger from sales_collector_runs order by id`; assert.equal(runs.length, 2); assert.equal(runs[0].trigger, 'manual');
  assert.equal((await ctx.owner.ok('GET', '/api/sales/collectors')).collectors.find((c) => c.slug === 'kapt_bid_notices').lastStatus, 'success');
  // 영업 화면: 오늘 새 공고에 보임
  const bids = await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=today');
  assert.ok(bids.items.some((i) => i.title.includes('커뮤니티 피트니스센터')), JSON.stringify(bids.items.map((i) => i.title)));
});

test('나라장터(검색어 × 4대상) + 누리장터 활용신청 필요 → 일부 · 사전규격(matchFit 거름)·낙찰 병합 · LH 관련 + 나머지 DENIED', async () => {
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/g2b_bid_notices/run', {});
  assert.equal(r.status, 'partial', JSON.stringify(r)); assert.equal(r.inserted, 1); assert.match(r.errorLog, /활용신청 필요/); assert.match(r.summary, /누리장터 0건\(응답 없음\)/, r.summary);
  const [g] = await sql`select row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_type' = 'g2b_bid'`;
  assert.equal(g.row.source_external_id, '20261021001-00'); assert.equal(g.row.fit_business, '다짐'); assert.equal(g.row.region, '경기도'); assert.equal(g.row.estimated_amount, 250000000); assert.equal(g.row.attachment_urls.length, 1);
  const p = await ctx.owner.ok('POST', '/api/sales/collectors/g2b_prespec_awards/run', {});
  assert.ok(p.inserted >= 1, JSON.stringify(p));
  const pre = await sql`select row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_type' = 'g2b_prespec'`;
  assert.equal(pre.length, 1, '도로 포장 공사는 걸러짐'); assert.equal(pre[0].row.current_status, '예정');
  const [g2] = await sql`select row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_type' = 'g2b_bid'`;
  assert.equal(g2.row.winner_name, '하이링크'); assert.equal(g2.row.current_status, '낙찰'); assert.equal(g2.row.winner_amount, 240000000);
  const a = await ctx.owner.ok('POST', '/api/sales/collectors/public_agency_bids/run', {});
  assert.equal(a.inserted, 1, JSON.stringify(a)); assert.match(a.summary, /활용신청·주소 확인 필요: lh_prespec/);
  const k = await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_results/run', {});
  assert.equal(k.updated, 1, JSON.stringify(k));
  const [kr] = await sql`select row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_external_id' = '20261021000001'`;
  assert.equal(kr.row.winner_name, '다짐'); assert.equal(kr.row.current_status, '낙찰'); assert.equal(kr.row.classification, '즉시 검토', '담당자 분류는 그대로');
  const vr = await ctx.owner.ok('POST', '/api/sales/collectors/vendor_recruit_watch/run', {});
  assert.equal(vr.inserted, 1, JSON.stringify(vr));
  const [v] = await sql`select row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_type' = 'vendor_recruit'`;
  assert.equal(v.row.notice_type, '협력사 모집'); assert.equal(v.row.related, true); assert.equal(v.row.classification, '중장기 영업리드', '#476 후속 d: 협력사 모집은 즉시 검토 아님'); assert.equal(v.row.posted_checked, true);
});

test('영업 DB 수집기: 산업단지 CSV·부동산원 CSV(18개월)·관광숙박업 API·K-apt 사업자선정 → 파생(커뮤니티 업무만) · 수동 필드 보존', async () => {
  const k = await ctx.owner.ok('POST', '/api/sales/collectors/kicox_industrial_complexes/run', {});
  assert.equal(k.inserted, 2, JSON.stringify(k));
  const [pan] = await sql`select row from sales_src_rows where tbl = 'operating_facility_prospects' and row->>'name' like '판교%'`;
  assert.equal(pan.row.operating_status, '운영중'); assert.equal(pan.row.facility_scale, 1150); assert.equal(pan.row.region, '경기 성남시'); assert.ok(pan.row.dedupe_key.startsWith('산업단지|'));
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/reb_recent_complexes/run', {});
  assert.equal(r.inserted, 1, JSON.stringify(r));
  const [bd] = await sql`select row from sales_src_rows where tbl = 'operating_facility_prospects' and row->>'name' = '분당 새아파트'`;
  assert.equal(bd.row.operating_status, '입주중'); assert.equal(bd.row.household_count, 850); assert.equal(bd.row.dedupe_key, '아파트|code:A100'); assert.ok(['상', '중'].includes(bd.row.sales_likelihood), bd.row.sales_likelihood);
  const h = await ctx.owner.ok('POST', '/api/sales/collectors/tourist_hotels_localdata/run', {});
  assert.equal(h.inserted, 1, JSON.stringify(h));
  const s = await ctx.owner.ok('POST', '/api/sales/collectors/kapt_sa_sun/run', {});
  assert.equal(s.inserted, 2, JSON.stringify(s));
  // 수동 메모가 있는 파생 대상 — 파생해도 수동 필드 유지
  await sql`update sales_src_rows set row = row || '{"notes":"대표 메모"}'::jsonb where tbl = 'operating_facility_prospects' and row->>'name' = '분당 새아파트'`;
  const d = await ctx.owner.ok('POST', '/api/sales/collectors/operating_from_kapt/run', {});
  assert.equal(d.inserted, 1, JSON.stringify(d)); assert.match(d.summary, /대상외 업무 1/);
  const [der] = await sql`select row from sales_src_rows where tbl = 'operating_facility_prospects' and row->>'dedupe_key' = '아파트|code:A10001'`;
  assert.equal(der.row.current_operator, '다짐'); assert.equal(der.row.contract_end_date, plus(65)); assert.equal(der.row.sales_likelihood, '상');
  // 다시 돌려도 변화없음 + 산업단지 수동 메모 보존
  await sql`update sales_src_rows set row = row || '{"notes":"메모 유지"}'::jsonb where tbl = 'operating_facility_prospects' and row->>'name' like '판교%'`;
  const k2 = await ctx.owner.ok('POST', '/api/sales/collectors/kicox_industrial_complexes/run', {});
  assert.equal(k2.unchanged, 2); assert.equal((await sql`select row->>'notes' n from sales_src_rows where tbl = 'operating_facility_prospects' and row->>'name' like '판교%'`)[0].n, '메모 유지');
  assert.equal((await sql`select count(*)::int n from sales_src_rows where tbl = 'kapt_vendor_selection'`)[0].n, 2);
});

test('맞춤 설정(검색어·제외어·지역) → 당일 다이제스트(새 공고·취소 구분, 메일·알림) → 하루 1건 · 회사별 수집기 끄기 → 다이제스트에서 제외', async () => {
  assert.equal((await ctx.staffA.client.req('PUT', '/api/sales/digest/prefs', { keywords: ['x'] })).status, 403);
  const pr = await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { keywords: ['행복주택'], excludes: ['사전규격'], regions: ['서울', '경기'], digestHour: 7 });
  assert.deepEqual(pr.keywords, ['행복주택']); assert.equal(pr.digest_hour, 7);
  // 과거 마감 공고(오늘 처음 봄)는 '새 공고'에 섞이지 않는다
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${'00000000-0000-4000-8000-00000000c0de'}, ${sql.json({ id: '00000000-0000-4000-8000-00000000c0de', source_type: 'g2b_bid', source_external_id: 'OLD-1', source_url: 'https://g2b.go.kr/old', title: '구청 헬스장 운동기구 구매(마감 지남)', fit_business: 'dagym', matched_keywords: ['헬스'], deadline_at: `${new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10)} 10:00`, first_seen_at: new Date().toISOString(), updated_at: new Date().toISOString(), notice_kind: 'new', current_status: '마감' })}, 'workin') on conflict do nothing`;
  const pv = await ctx.owner.ok('GET', '/api/sales/digest');
  assert.equal(pv.preview, true); assert.ok(!pv.items.some((i) => i.title.includes('마감 지남')), '과거 마감 제외'); assert.ok(pv.counts.skipped['마감 지남'] >= 1, JSON.stringify(pv.counts.skipped)); const titles = pv.items.map((i) => i.title);
  assert.ok(titles.some((t) => t.includes('커뮤니티 피트니스센터')), '적합 공고'); assert.ok(titles.some((t) => t.includes('행복주택')), '관심 검색어로 통과(LH)');
  assert.ok(!titles.some((t) => t.includes('사전규격')), '제외어'); assert.ok(!titles.some((t) => t.includes('승강기')), '비관련');
  assert.ok(pv.counts.skipped['업종 무관'] >= 1, JSON.stringify(pv.counts));
  // 로컬 10/24 12:20(#537 후속): 앞 시험에서 낙찰이 붙은 나라장터 공고(하이링크)는 새 공고가 아니라 '결과' 구역 — 낙찰 줄이 다른 구역에 섞이지 않음
  const won = pv.items.find((i) => i.section === 'result' && /^낙찰 하이링크/.test(i.result ?? ''));
  assert.ok(won && won.dday != null && won.url && won.source, JSON.stringify(pv.items.map((i) => [i.section, i.title, i.result])));
  assert.ok(!pv.items.some((i) => i.section !== 'result' && i.result), '결과 줄은 결과 구역에만');
  // 취소 공고 — 오늘 바뀐 건은 별도
  await sql`update sales_src_rows set row = row || ${sql.json({ current_status: '취소', notice_kind: 'cancel', updated_at: new Date().toISOString() })}::jsonb where tbl = 'procurement_notices' and row->>'source_external_id' = 'LH-1'`;
  const sent = await ctx.owner.ok('POST', '/api/sales/digest/send', {});
  assert.equal(sent.sent, true); assert.ok(sent.counts.cancel >= 1, JSON.stringify(sent.counts)); assert.ok(sent.mailed >= 1, '개발 모드 메일(dev) 집계'); assert.ok(sent.notified >= 1);
  const [n] = await sql`select title, link from notifications where user_id = ${ctx.ownerId} and type = 'briefing' order by created_at desc limit 1`;
  assert.match(n.title, /오늘 새 공고/); assert.equal(n.link, '/s/sales/bids?tab=today');
  assert.equal((await sql`select count(*)::int n from sales_digests where tenant = 'default' and day = ${today}`)[0].n, 1);
  const again = await ctx.owner.ok('GET', '/api/sales/digest'); assert.equal(again.preview, undefined, '보낸 뒤에는 보낸 것 그대로'); assert.equal(again.mailed, sent.mailed);
  // 회사별 수집기 끄기 → 그 출처 제외
  await ctx.owner.ok('PUT', '/api/sales/collectors', { slug: 'kapt_bid_notices', enabled: false });
  const re = await ctx.owner.ok('POST', '/api/sales/digest/send', {});
  assert.ok(!re.items.some((i) => i.source === 'K-apt'), JSON.stringify(re.items.map((i) => i.source)));
  assert.equal((await ctx.owner.ok('GET', '/api/sales/collectors')).collectors.find((c) => c.slug === 'kapt_bid_notices').enabled, false);
  await ctx.owner.ok('PUT', '/api/sales/collectors', { slug: 'kapt_bid_notices', enabled: true });
  // 직원은 보기만
  assert.equal((await ctx.staffA.client.ok('GET', '/api/sales/digest/prefs')).canEdit, false);
  assert.equal((await ctx.staffB.client.req('GET', '/api/sales/collectors')).status, 404, '영업 공간 미배정');
});

test('#476 입찰공고 누락: 지난 메일 뒤 처음 본 공고 → 다음 메일·오늘 탭(배지)·홈 수 · K-apt 공식 API(15058166) 병행·분류(위탁관리·주민운동시설의 위탁)·옛 분류 올림 · 협력사 게시일·꼬리·결과 글·30일·옛 줄 정리 · 수집 06·10·14·18시', async () => {
  const yd = plus(-1); const kst = (d, hm) => new Date(`${d}T${hm}:00+09:00`).toISOString();
  const h8 = (x) => createHash('sha256').update(x).digest('hex').slice(0, 16);
  const ins = (id, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${id}, ${sql.json({ id, ...row })}, 'workin')`;
  const base = { source_type: 'kapt_bid', source_url: 'https://www.k-apt.go.kr/bid/x', fit_business: '다짐', related: true, matched_keywords: ['운동시설'], deadline_at: `${plus(10)}T17:00:00+09:00`, notice_kind: 'new', current_status: '진행중', classification: '즉시 검토', region: '경기용인' };
  // a) 어제 12:38 메일 발송 → 어제 14:18 처음 본 공고(대표 지적 건과 같은 모양)는 오늘 메일에, 메일 전(10:00)에 본 공고는 어제 메일에 있었으니 빼고
  await sql`insert into sales_digests (tenant, day, items, counts, mailed, notified, created_at) values ('default', ${yd}, '[]', '{}', 1, 1, ${new Date(kst(yd, '12:38'))}) on conflict (tenant, day) do update set created_at = excluded.created_at`;
  await ins('00000000-0000-4000-8000-0000000476a1', { ...base, source_external_id: 'T476-LATE', title: '[경기용인] 시험 단지 주민 운동시설 위탁관리업체 선정(메일 뒤)', posted_date: yd, first_seen_at: kst(yd, '14:18'), updated_at: kst(yd, '14:18') });
  await ins('00000000-0000-4000-8000-0000000476a2', { ...base, source_external_id: 'T476-EARLY', title: '[경기용인] 시험 단지 헬스장 위탁운영(메일 전)', posted_date: yd, first_seen_at: kst(yd, '10:00'), updated_at: kst(yd, '10:00') });
  await ins('00000000-0000-4000-8000-0000000476a3', { ...base, source_external_id: 'T476-YDPOST', title: '[경기용인] 시험 단지 피트니스 위탁운영(어제 공고·오늘 수집)', posted_date: yd, first_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  const sent = await ctx.owner.ok('POST', '/api/sales/digest/send', {});
  const st = sent.items.map((i) => i.title);
  assert.ok(st.some((t) => t.includes('(메일 뒤)')), `지난 메일 뒤 공고가 오늘 메일에: ${JSON.stringify(st)}`); assert.ok(!st.some((t) => t.includes('(메일 전)')), '메일 전에 본 공고는 어제 메일 몫');
  assert.equal(sent.items.find((i) => i.title.includes('(메일 뒤)')).late, true, '어제 수집 표시'); assert.equal(sent.items.find((i) => i.title.includes('(어제 공고·오늘 수집)')).late, false);
  // b) 오늘 탭 = 공고일 오늘 · 처음 본 날 오늘 · 지난 메일 뒤 — 까닭 배지 · 홈 '오늘 새 공고' 수도 같은 기준
  const tt = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=today')).items;
  const late = tt.find((n) => n.title.includes('(메일 뒤)')), ydp = tt.find((n) => n.title.includes('(어제 공고·오늘 수집)'));
  assert.ok(late && ydp, JSON.stringify(tt.map((n) => n.title))); assert.ok(!tt.some((n) => n.title.includes('(메일 전)')));
  assert.equal(late.todayLabel, '어제 메일 뒤 수집'); assert.equal(ydp.todayLabel, '어제 공고·오늘 수집');
  const home = await ctx.owner.ok('GET', '/api/sales/src?view=summary'); assert.equal(home.today.newNotices, tt.length, '홈 수 = 오늘 탭 수');
  // c) 수집 시각: K-apt·나라장터 06·10·14·18시(지원사업은 08·14 그대로)
  const cs = (await ctx.owner.ok('GET', '/api/sales/collectors')).collectors; const hours = (slug) => cs.find((c) => c.slug === slug).hours;
  assert.deepEqual([hours('kapt_bid_notices'), hours('g2b_bid_notices'), hours('bizinfo_support')], [[6, 10, 14, 18], [6, 10, 14, 18], [8, 14]]);
  // d) K-apt: 공식 API 에만 있는 공고(목록에서 놓친 것) 추가 · '위탁관리업체' = 즉시 검토 · 상세 입찰분류 '주민운동시설의 위탁' = 즉시 검토 · 옛 규칙의 '중장기'는 올림
  kaptExtra = [tr('20261022000009', ['4', 'K-APT', '적격심사', '[경기용인] 주민 운동시설 관리 용역', `${plus(8)} 17:00`, '신규공고', '용인 시험단지', `${today} 10:10`])];
  detailCat['20261022000009'] = '사업자 &gt; 용역 &gt; 주민운동시설의 위탁';
  await ins('00000000-0000-4000-8000-0000000476b1', { ...base, source_external_id: '20261022000009', title: '[경기용인] 주민 운동시설 관리 용역', classification: '중장기 영업리드', first_seen_at: kst(yd, '09:00'), updated_at: kst(yd, '09:00') });
  kaptApiItems = [{ bidNum: '20261022135202498', bidTitle: '동일스위트리버스카이1단지 주민 운동시설 위탁관리업체 선정', bidKaptname: '동일스위트리버스카이1단지', bidRegDate: yd.replace(/-/g, ''), bidDeadline: `${plus(11).replace(/-/g, '')}1700`, bidArea: 41, bidState: '1', codeAuth: '01', codeKind: '01', codeSucWay: '02' },
    { bidNum: '20261021000001', bidTitle: '커뮤니티 피트니스센터 위탁운영 사업자 선정', bidKaptname: '래미안 강남', bidRegDate: today.replace(/-/g, ''), bidState: '1', codeAuth: '01' }];
  const k = await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  assert.equal(k.status, 'success', JSON.stringify(k)); assert.match(k.summary, /공식 API 2건/); assert.match(k.summary, /목록에 없던 1건 추가/);
  const byExt = async (ext) => (await sql`select row, gone from sales_src_rows where tbl = 'procurement_notices' and row->>'source_external_id' = ${ext}`)[0];
  const api = (await byExt('20261022135202498')).row;
  assert.deepEqual([api.classification, api.fit_business, api.issuer, api.region, api.posted_date, api.bid_system, api.award_method, api.notice_state], ['즉시 검토', '다짐', '동일스위트리버스카이1단지', '경기', yd, 'K-APT', '적격심사', '신규공고']);
  assert.match(api.deadline_at, /T17:00:00\+09:00$/); assert.ok(api.source_url.includes('bidNum=20261022135202498'));
  const up = (await byExt('20261022000009')).row; assert.equal(up.bid_category, '사업자 > 용역 > 주민운동시설의 위탁'); assert.equal(up.classification, '즉시 검토', '옛 규칙의 중장기 → 즉시 검토로 올림');
  assert.equal((await byExt('20261021000001')).row.title, '[서울강남] 커뮤니티 피트니스센터 위탁운영 사업자 선정', '목록에 있는 공고는 목록 화면 값이 기준');
  // e) 협력사 게시판(#476 후속 로컬 10/23): 링크 글자 = 제목 · 게시판 날짜를 읽은 글만 줄 · 30일 넘은 글·결과 공지 빼기 · 날짜 없는 줄은 글로 쪼개지 않고 '안내 페이지 바뀜' 1줄
  // · 예전 방식 줄(꼬리·공고일 = 수집일) 숨김 · 회사 진행 기록이 걸린 줄은 남기되 게시일 비움 · 분류 '즉시 검토' → '중장기 영업리드'
  const dot = (x) => x.replace(/-/g, '.');
  vendorHtml = `<html><table><tr><th>번호</th><th>제목</th><th>작성자</th><th>날짜</th><th>조회</th></tr>
<tr><td>14</td><td><a href="/notice/view?id=114">2026년 협력업체 정기등록 모집 안내</a></td><td>관리자</td><td>${dot(today)}</td><td>351</td></tr>
<tr><td>13</td><td><a href="/notice/view?id=113">협력업체 신규 등록 접수 안내</a></td><td>관리자</td><td>2019.03.05</td><td>3501</td></tr>
<tr><td>12</td><td><a href="/notice/view?id=112">2026 하반기 협력업체 모집 결과 공지</a></td><td>관리자</td><td>${dot(yd)}</td><td>20</td></tr>
<tr><td>11</td><td><a href="javascript:goView(111)">우수 협력사 등록 신청 안내</a></td><td>관리자</td><td>-</td><td>12</td></tr>
<tr><td>10</td><td><a href="/notice/view?id=110">파트너사 신규 모집 안내 [N]</a></td><td>관리자</td><td></td><td>3</td></tr></table></html>`;
  const vrow = (title, ext, first, posted = first.slice(0, 10)) => ({ source_type: 'vendor_recruit', source_external_id: ext, source_url: 'http://x/vendor/notice', title: `[시험건설] ${title}`, issuer: '시험건설', notice_type: '협력사 모집', bid_category: '협력사 모집', related: true, classification: '즉시 검토', posted_date: posted, first_seen_at: first, updated_at: first });
  await ins('00000000-0000-4000-8000-0000000476c1', vrow('협력업체 신규 등록 접수 안내 조회 Hit 3501 추천 0 관리자 2019.03.05', 'junk-1', new Date().toISOString()));
  await ins('00000000-0000-4000-8000-0000000476c2', vrow('우수 협력사 등록 신청 안내 조회 12 추천 0', 'junk-2', kst(yd, '07:00')));
  await ins('00000000-0000-4000-8000-0000000476c3', vrow('협력업체 모집 결과 공지 조회 5 추천 0', 'junk-3', kst(yd, '07:00')));
  await ins('00000000-0000-4000-8000-0000000476c4', vrow('협력업체 신규 등록 접수 안내', 'old-clean', kst(yd, '07:00'))); // 제목은 깨끗하지만 게시판에선 2019년 글
  await sql`insert into sales_work_records (tenant, src_tbl, src_id, ref_id, status, data) values ('default', 'opportunity_work', 'w-476', '00000000-0000-4000-8000-0000000476c3', '검토', '{}')`;
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('default', 'opportunity_work', 'w-476v', ${sql.json({ id: 'w-476v', notice_id: '00000000-0000-4000-8000-0000000476c3', status: '검토' })}, 'src')`; // 화면(진행 기록 복사본)에서도 걸린 줄
  const v = await ctx.owner.ok('POST', '/api/sales/collectors/vendor_recruit_watch/run', {});
  assert.match(v.summary, /모집 글 1건\(최근 30일·게시일 있는 글\) · 안내 페이지 바뀜 1 /, v.summary); assert.match(v.summary, /제목 고침 0 · 숨김 3 · 게시일 지움 1/, v.summary);
  const vr = await sql`select row, gone from sales_src_rows where tbl = 'procurement_notices' and row->>'source_type' = 'vendor_recruit' order by row->>'title'`;
  const live = vr.filter((r) => !r.gone).map((r) => r.row);
  assert.ok(live.every((r) => !/조회|Hit|추천 \d/.test(r.title) || r.source_external_id === 'junk-3'), JSON.stringify(live.map((r) => r.title)));
  assert.ok(!live.some((r) => r.title.includes('결과 공지') && r.source_external_id !== 'junk-3'), '결과 공지는 안 들어옴(진행 기록이 걸린 옛 줄만 남음)');
  assert.ok(!live.some((r) => r.title.includes('신규 등록 접수 안내')), '2019년 글 = 30일 넘음 → 옛 꼬리 줄은 숨김');
  assert.deepEqual([(await byExt('junk-1')).gone, (await byExt('junk-2')).gone, (await byExt('old-clean')).gone], [true, true, true], '게시판에서 게시일을 확인 못 한 옛 줄은 숨김');
  const j3 = await byExt('junk-3'); assert.deepEqual([j3.gone, j3.row.posted_date, j3.row.classification], [false, null, '중장기 영업리드'], '회사 진행 기록이 걸린 줄은 그대로(게시일만 비움)');
  const regular = live.find((r) => r.title === '[시험건설] 2026년 협력업체 정기등록 모집 안내');
  assert.deepEqual([regular.posted_date, regular.posted_checked, regular.classification, regular.source_url], [today, true, '중장기 영업리드', 'http://localhost:3231/notice/view?id=114'], '게시일 = 게시판 날짜 · 확인 표시');
  assert.ok(!live.some((r) => /우수 협력사 등록 신청 안내$|파트너사 신규 모집 안내$/.test(r.title)), '날짜 없는 줄은 글로 쪼개지 않음');
  const chg = live.filter((r) => r.notice_state === '안내 페이지 바뀜');
  assert.equal(chg.length, 1, JSON.stringify(live.map((r) => r.title)));
  assert.deepEqual([chg[0].title, chg[0].posted_date, chg[0].task_scope], ['[시험건설] 협력사 안내 페이지 바뀜 — 우수 협력사 등록 신청 안내 외 1줄', today, '새로 보인 줄 2: 우수 협력사 등록 신청 안내 / 파트너사 신규 모집 안내']);
  const tt2 = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=today')).items.map((n) => n.title);
  assert.ok(tt2.includes('[시험건설] 2026년 협력업체 정기등록 모집 안내') && tt2.includes(chg[0].title), JSON.stringify(tt2)); assert.ok(!tt2.some((x) => x.includes('결과 공지')), '게시일 비운 줄은 오늘 탭 밖');
  const rc = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=recruit')).items;
  assert.deepEqual(rc.map((n) => n.title).sort(), [chg[0].title, '[시험건설] 2026년 협력업체 정기등록 모집 안내', '[시험건설] 협력업체 모집 결과 공지 조회 5 추천 0'].sort(), '협력사 모집 탭 = 확인된 글 + 안내 페이지 바뀜 + 진행 기록 걸린 줄');
  assert.equal(rc.find((n) => n.title.includes('결과 공지')).noticeDate, null);
  const again = await ctx.owner.ok('POST', '/api/sales/collectors/vendor_recruit_watch/run', {});
  assert.equal(again.inserted, 0, again.summary); assert.match(again.summary, /안내 페이지 바뀜 0/, '같은 페이지면 다시 넣지 않음');
  // f) 로컬 10/23 14:20 운영 지적: 안내 페이지 조각(목록 기호·메뉴·고정 링크)·예전 방식 '공고일 = 수집일' 줄이 '공고일 오늘'로 오늘 탭에 → 수집 전에도 오늘 탭·협력사 탭·메일 밖,
  // 수집하면 숨김 · 게시판 줄 전체가 링크인 곳(대방건설형)은 링크 안 날짜를 읽음 · 메뉴·바닥 고정 링크 뒤 날짜는 그 링크 날짜가 아님
  for (const [n, title] of [['1', '개요 CEO 인사말 연혁 조직도 오시는길 협력업체등록'], ['2', '1) 협력사 등록 신청서 (당사 양식)'], ['3', '협력업체등록신청']]) await ins(`00000000-0000-4000-8000-0000000476d${n}`, vrow(title, `j476-${n}`, kst(yd, '13:00'), today));
  const tt3 = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=today')).items.map((n) => n.title);
  assert.ok(!tt3.some((x) => /인사말|신청서 \(당사|협력업체등록신청/.test(x)), `예전 방식 줄은 공고일을 믿지 않음: ${JSON.stringify(tt3)}`);
  assert.ok(!(await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=recruit')).items.some((n) => /인사말|신청서 \(당사|협력업체등록신청/.test(n.title)), '협력사 탭에도 없음');
  const mail = await ctx.owner.ok('POST', '/api/sales/digest/send', {});
  assert.ok(!mail.items.some((i) => /인사말|신청서 \(당사|협력업체등록신청/.test(i.title)), `메일 밖: ${JSON.stringify(mail.items.map((i) => i.title))}`); assert.ok(mail.counts.skipped['게시일 미상'] >= 3, JSON.stringify(mail.counts.skipped));
  vendorHtml = `<html><ul class="gnb"><li><a href="/c/1">개요</a> <a href="/c/2">CEO 인사말</a> <a href="/c/3">연혁</a> <a href="/c/4">조직도</a> <a href="/c/5">오시는길</a> <a href="/c/6">협력업체등록</a></li></ul>
<div class="board"><a href="javascript:goBoardView('/b','View','753');"><p>공지</p><div><p>시험건설 2026년도 하반기 협력업체 모집공고</p></div><p class="date">${dot(plus(-3))}</p><p>3,489</p></a>
<a href="javascript:goBoardView('/b','View','703');"><p>1</p><div><p>시험건설 2025년도 협력업체 모집공고</p></div><p class="date">2024.12.09</p><p>3,363</p></a></div>
<ul><li>1) 협력사 등록 신청서 (당사 양식) 제출 — 협력업체 등록</li><li>b. 신용등급 B이상, 현금흐름도 C이상 (협력업체 등록 요건)</li></ul>
<table><tr><td>구분 2021년 신규협력업체 모집</td></tr></table><a href="/files/form.zip">협력업체 등록신청서 다운로드</a> <span>${dot(today)} 갱신</span></html>`;
  const f = await ctx.owner.ok('POST', '/api/sales/collectors/vendor_recruit_watch/run', {});
  assert.match(f.summary, /모집 글 1건\(최근 30일·게시일 있는 글\) · 안내 페이지 바뀜 1 /, f.summary); assert.match(f.summary, /숨김 3/, f.summary);
  assert.deepEqual(await Promise.all(['j476-1', 'j476-2', 'j476-3'].map(async (x) => (await byExt(x)).gone)), [true, true, true], '조각·메뉴·고정 링크 줄 숨김');
  const db2 = (await sql`select row from sales_src_rows where tbl = 'procurement_notices' and not gone and row->>'title' = '[시험건설] 시험건설 2026년도 하반기 협력업체 모집공고'`)[0]?.row;
  assert.deepEqual([db2?.posted_date, db2?.posted_checked, db2?.classification], [plus(-3), true, '중장기 영업리드'], '링크 안 날짜 = 게시일');
  const all2 = (await sql`select row->>'title' t from sales_src_rows where tbl = 'procurement_notices' and not gone and row->>'source_type' = 'vendor_recruit'`).map((r) => r.t);
  assert.ok(!all2.some((x) => /2025년도|^\[시험건설\] (1\)|b\.|구분|협력업체등록$|협력업체 등록신청서)/.test(x)), `30일 넘은 글·조각은 줄이 아님: ${JSON.stringify(all2)}`);
  assert.ok(all2.includes('[시험건설] 협력사 안내 페이지 바뀜 — 협력업체등록 외 4줄'), JSON.stringify(all2));
  const mail2 = await ctx.owner.ok('POST', '/api/sales/digest/send', {}); // 메일 줄에 공고일(오늘보다 앞이면 '공고일 YYYY-MM-DD') — 지난 메일 뒤 처음 본 옛 공고가 오늘 공고처럼 보이지 않게
  assert.equal(mail2.items.find((i) => i.title.includes('2026년도 하반기'))?.posted, plus(-3), JSON.stringify(mail2.items.map((i) => [i.title, i.posted])));
  const tt4 = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=today')).items;
  assert.equal(tt4.find((n) => n.title.includes('2026년도 하반기')).todayLabel, `${Number(plus(-3).slice(5, 7))}/${Number(plus(-3).slice(8, 10))} 공고·오늘 수집`);
  assert.match((await ctx.owner.ok('POST', '/api/sales/collectors/vendor_recruit_watch/run', {})).summary, /안내 페이지 바뀜 0 · 신규 0/);
  // g) 로컬 10/23 '서희건설 시간 초과 반복': 3번 연속 실패한 페이지는 3일 쉼(다른 페이지 시간을 잡아먹지 않게) · 쉬는 동안 요약에 표시 · 다시 되면 실패 수 0
  vendorStatus = 503;
  for (let i = 1; i <= 3; i++) { const r = await ctx.owner.ok('POST', '/api/sales/collectors/vendor_recruit_watch/run', {}); assert.match(r.errorLog ?? '', i === 3 ? /시험건설: HTTP 503 — 3번 연속 실패라 3일 쉬고 다시 시도/ : /^시험건설: HTTP 503$/m, JSON.stringify(r)); }
  const rest = await ctx.owner.ok('POST', '/api/sales/collectors/vendor_recruit_watch/run', {});
  assert.match(rest.summary, /쉬는 페이지 1: 시험건설\(\d+\/\d+까지\)/, rest.summary);
  vendorStatus = 200; const purl = `http://localhost:${PORT}/vendor/notice`;
  await sql`update app_settings set value = jsonb_set(value, ${[purl, 'restUntil']}::text[], '"2000-01-01T00:00:00.000Z"'::jsonb) where key = 'sales_vendor_page_state'`;
  const back = await ctx.owner.ok('POST', '/api/sales/collectors/vendor_recruit_watch/run', {});
  assert.ok(!/쉬는 페이지/.test(back.summary) && /안내 페이지 바뀜 0/.test(back.summary), back.summary);
  const [pst] = await sql`select value->${purl} v from app_settings where key = 'sales_vendor_page_state'`; assert.deepEqual([pst.v.fails, pst.v.restUntil, pst.v.seen.length], [0, null, 7], '기준(본 줄)은 그대로');
  kaptExtra = []; kaptApiItems = [];
});

test('플랫폼 운영자: 협력사 감시 페이지·기관 엔드포인트 입력(app_settings) → 수집기가 읽음 · 다른 사람 404', async () => {
  assert.equal((await ctx.staffA.client.req('GET', '/api/platform/sales-collectors')).status, 404);
  assert.equal((await ctx.staffA.client.req('PUT', '/api/platform/sales-collectors', { vendorPages: [] })).status, 404);
  const g = await ctx.owner.ok('GET', '/api/platform/sales-collectors');
  assert.equal(g.vendorPages.length, 21, '마이그레이션 142 seed(원본 21곳)'); assert.ok(g.vendorPages.every((x) => x.company && /^https?:\/\//.test(x.url))); assert.ok(g.endpoints.lh_bid.startsWith('http')); assert.ok(g.endpoints.nuri_bid_servc.endsWith('PrvtBidNtceService/getPrvtBidPblancListInfoServcPPSSrch') && g.endpoints.nuri_bid_thng.endsWith('getPrvtBidPblancListInfoThngPPSSrch'), '누리장터 = getPrvtBidPblancListInfo*(10/23 주소 확인)'); assert.deepEqual(g.endpointOverrides, {});
  const p = await ctx.owner.ok('PUT', '/api/platform/sales-collectors', { vendorPages: [{ company: '현대건설', url: 'https://www.hdec.kr/notice', registerUrl: 'https://www.hdec.kr/register' }, { company: '현대건설', url: 'https://www.hdec.kr/notice' }, { company: '대우건설', url: 'https://www.daewooenc.com/partner' }], endpoints: { lh_bid: 'https://apis.data.go.kr/B552555/lhBidInfo2/getList', onbid_lease: '' } });
  assert.deepEqual(p.vendorPages.map((x) => x.company), ['현대건설', '대우건설'], '같은 주소 중복 제거'); assert.equal(p.vendorPages[0].register_url, 'https://www.hdec.kr/register'); assert.equal(p.vendorPages[1].register_url, null);
  assert.equal(p.endpoints.lh_bid, 'https://apis.data.go.kr/B552555/lhBidInfo2/getList'); assert.deepEqual(Object.keys(p.endpointOverrides), ['lh_bid'], '비운 칸은 기본값(덮어쓰기 없음)');
  assert.equal((await ctx.owner.req('PUT', '/api/platform/sales-collectors', { vendorPages: [{ company: 'x', url: 'javascript:alert(1)' }] })).status, 400);
  assert.equal((await ctx.owner.req('PUT', '/api/platform/sales-collectors', { endpoints: { nope: 'https://a.b/c' } })).status, 400);
  const [row] = await sql`select value from app_settings where key = 'sales_vendor_watch_pages'`; assert.equal(row.value.length, 2);
  const [a] = await sql`select count(*)::int n from audit_logs where action = 'platform.sales_collectors.settings'`; assert.ok(a.n >= 1);
});

test('누리장터 응답 통계(로컬 10/23 "0건이 진짜 0건인지"): 정상 0건 = 검색 n회 · 응답 00 · 전체 0건 · 칸 이름이 다르면 받은 줄을 못 읽음(칸 이름)', async () => {
  nuriMode = 'empty';
  const e = await ctx.owner.ok('POST', '/api/sales/collectors/g2b_bid_notices/run', {});
  assert.match(e.summary, /누리장터 0건\(검색 \d+회 · 응답 00 · 전체 0건\)/, e.summary);
  nuriMode = 'odd';
  const o = await ctx.owner.ok('POST', '/api/sales/collectors/g2b_bid_notices/run', {});
  assert.match(o.summary, /누리장터 0건\(검색 \d+회 · 응답 00 · 전체 \d+건 · 받은 \d+줄을 못 읽음\(칸: ntceNo,ntceNm\)\)/, o.summary);
  // 새 명세 칸 이름(로컬 10/23 운영: ntceNm·nticeDt·ntceInsttNm·bidNtceNo+bidNtceOrd·bidMethdNm·cntrctMthdNm·ntceDivNm·bidNtceClsfc) → 읽음. 담당자 이름·전화·메일은 저장 안 함
  nuriMode = 'ok';
  const k = await ctx.owner.ok('POST', '/api/sales/collectors/g2b_bid_notices/run', {});
  assert.match(k.summary, /누리장터 1건\(검색 \d+회 · 응답 00 · 전체 1건\)/, k.summary);
  const [n] = await sql`select row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_type' = 'nuri_bid' and row->>'source_external_id' = 'R26BK00000001-000'`;
  assert.ok(n, '누리장터 공고 저장');
  const r = n.row;
  assert.deepEqual([r.title, r.issuer, r.posted_date, r.contract_method, r.bid_system, r.award_method, r.notice_state, r.bid_category, r.region, r.facility_name, r.office_phone, r.household_count, r.estimated_amount, r.budget_amount, r.source_url, r.related],
    ['광교 센트럴 커뮤니티센터 피트니스 위탁운영 업체 선정', '광교센트럴 입주자대표회의', today, '제한경쟁', '전자입찰', '적격심사최저가', '일반공고', '용역', '경기', '광교 센트럴', '031-222-3333', 1200, 180000000, 200000000, 'https://nuri.g2b.go.kr/f/spec1.hwp', true]);
  assert.ok(String(r.deadline_at).startsWith(plus(8)) && String(r.opening_at).startsWith(plus(9)), '마감·개찰');
  const raw = JSON.stringify(r);
  assert.ok(!raw.includes('홍길동') && !raw.includes('010-1234-5678') && !raw.includes('1234-5678') && !raw.includes('hong@example.com'), '담당자 이름·전화·메일은 저장하지 않음(개인정보)');
  nuriMode = 'denied';
});

test('#507 후속(로컬 10/23): 같은 공고 여러 줄(원본 복사 + 워크인 수집) → 수집 뒤 한 줄로 — 업무·진행 기록이 걸린 줄의 id 를 살리고 첨부는 합치고 빈 칸은 채움 · 둘 다 걸려 있으면 그대로 두고 목록은 한 줄', async () => {
  const one = async () => (await sql`select src_id, origin, gone, row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and row->>'source_external_id' = '20261021000001' order by src_id`);
  const [w] = (await one()).filter((x) => !x.gone);
  assert.equal(w.origin, 'workin');
  // ① 원본 복사 줄(연결 없음): 같은 공고 · 예산 · 옛 주소 첨부 → 워크인 줄이 남고 예산·첨부를 받음
  const src = (id, extra) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${id}, ${sql.json({ ...w.row, id, ...extra })}, 'src')`;
  await src('SRC-1', { budget_amount: 98000000, attachment_urls: ['https://www.k-apt.go.kr/bid/bidFileDown.do?bidNum=20261021000001&fileSeq=7002'], updated_at: '2026-01-01T00:00:00.000Z' });
  const a = await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  assert.match(a.summary, /같은 공고 1줄 합침\(K-apt 1\)/, a.summary);
  let rows = await one(); const keep = rows.find((x) => x.src_id === w.src_id); const s1 = rows.find((x) => x.src_id === 'SRC-1');
  assert.deepEqual([keep.gone, s1.gone, s1.row.merged_into], [false, true, w.src_id]);
  assert.equal(Number(keep.row.budget_amount), 98000000, '빈 칸은 다른 줄 값으로');
  assert.deepEqual(keep.row.attachment_urls.map((x) => (typeof x === 'string' ? x : x.url).replace(/^.*key=/, '')), ['7001&bidNum=20261021000001', '7002&bidNum=20261021000001'], '첨부는 합침(옛 주소도 같은 모양으로)');
  // ② 원본 복사 줄에 업무가 걸려 있으면 그 줄의 id 를 살리고 워크인 줄을 숨김
  await src('SRC-2', { attachment_urls: [] });
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: '광명 공고 검토', assigneeId: ctx.ownerId, approvalRequired: false });
  await sql`update tasks set sales_ref = ${sql.json({ kind: 'bid', id: 'SRC-2', name: '시험' })} where id = ${t.id}`;
  await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  rows = await one();
  assert.deepEqual(rows.filter((x) => !x.gone).map((x) => x.src_id), ['SRC-2'], '업무가 걸린 줄만 남음');
  assert.equal(rows.find((x) => x.src_id === 'SRC-2').row.attachment_urls.length, 2, '첨부를 넘겨받음');
  // ③ 둘 다 걸려 있으면(진행 기록 + 업무) 숨기지 않음 — 입찰 목록은 한 줄(첨부 합침)
  await src('SRC-3', { attachment_urls: [] });
  await sql`insert into sales_work_records (tenant, src_tbl, src_id, ref_id, status, data) values ('default', 'opportunity_work', 'w:bid:SRC-3', 'SRC-3', '검토중', '{}')`;
  const c = await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  assert.match(c.summary, /두 줄 모두 진행 기록·업무가 있어 그대로 둔 공고 1건/, c.summary);
  rows = await one();
  assert.deepEqual(rows.filter((x) => !x.gone).map((x) => x.src_id), ['SRC-2', 'SRC-3']);
  const v = await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all');
  const hit = v.items.filter((i) => i.noticeNo === '20261021000001');
  assert.equal(hit.length, 1, JSON.stringify(hit.map((i) => i.id))); assert.equal(hit[0].attachments.length, 2);
});

/** #522 새 명세 응답(가짜 원천): LH 는 body.item 에 바로·날짜 yyyy-MM-dd 만 받음(yyyyMMdd 면 오류) · 국방은 response.body.items.item · 온비드는 resultType=json·필수 입력 확인 */
function agency522(u, send) {
  const q = Object.fromEntries(u.searchParams); const json = (o) => send(200, JSON.stringify(o), 'application/json');
  const ok = (item, wrap = false) => (wrap ? { response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' }, body: { items: { item }, numOfRows: 100, pageNo: 1, totalCount: item.length } } } : { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' }, body: { item, numOfRows: 100, pageNo: 1, totalCount: item.length } });
  // 로컬 10/24: LH 2종은 XML 만(produces application/xml) — JSON 요청 칸(type·_type)이 오면 400 으로 막아 안 보내는지 확인
  const xmlEsc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const xml = (items) => send(200, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><items>${items.map((it) => `<item>${Object.entries(it).map(([k, v]) => `<${k}>${xmlEsc(v)}</${k}>`).join('')}</item>`).join('')}</items><numOfRows>100</numOfRows><pageNo>1</pageNo><totalCount>${items.length}</totalCount></body></response>`, 'application/xml;charset=UTF-8');
  const xmlErr = (code, msg) => send(200, `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>${code}</resultCode><resultMsg>${xmlEsc(msg)}</resultMsg></header><body/></response>`, 'application/xml;charset=UTF-8');
  if (u.pathname.startsWith('/agency/lh_') && (q.type || q._type)) return send(400, 'type not allowed');
  if (u.pathname.startsWith('/agency/lh_') && lhFail) return xmlErr('11', `NO MANDATORY REQUEST PARAMETERS ERROR (문의 tester@lh.example 031-000-1111)`);
  if (u.pathname === '/agency/lh_bid') {
    if (!/^\d{8}$/.test(q.tndrbidRegDtStart ?? '')) return xmlErr('99', 'INVALID REQUEST PARAMETER ERROR'); // 포털 기본값 '20161122' = yyyyMMdd
    return xml([{ bidNum: '2026-0001', bidDegree: '0', bidnmKor: '행복주택 커뮤니티 피트니스 운영 위탁 용역', cstrtnJobGbNm: '용역', zoneHqCd: '경기남부지역본부', bidKind: '일반', bidProgrsStatus: '공고중', tndrCtrctMedCd: '제한경쟁', tndrbidRegDt: plus(0), presmtPrc: '50000000', fdmtlAmt: '55000000', sunjungNm: '적격심사', tndrdocAcptBgninDtm: `${plus(2)} 10:00`, tndrdocAcptEndDtm: `${plus(6)} 17:00`, openDtm: `${plus(7)} 11:00`, zoneRstrct1: '경기도', zoneRstrct2: '서울특별시', req1Reqlic1Nm: '체육시설업' },
      { bidNum: '2026-0002', bidDegree: '0', bidnmKor: '아파트 외벽 도장공사', cstrtnJobGbNm: '공사', tndrbidRegDt: plus(0) }]);
  }
  if (u.pathname === '/agency/lh_prespec' && /^\d{8}$/.test(q.opinionRegEndDtmStart ?? '')) return xmlErr('99', 'INVALID REQUEST PARAMETER ERROR'); // 날짜 형식 다시 보내기 시험
  if (u.pathname === '/agency/lh_prespec') return xml([{ inadvcStddztNm: '임대주택 커뮤니티센터 피트니스 운영 위탁 용역', gdsnm: '운영 위탁', assignBudgetAmt: '90000000', opinionRegEndDtm: `${plus(4)} 18:00`, revertDeptNm: '경기남부지역본부 주거복지부', dlvgdsSpot: '경기도 화성시 동탄', dlvgdsTmlmt: '계약일부터 2년', cstrtnJobGbNm: '용역', chpsnEmail: 'tester@lh.example', chpsnTelNum: '031-000-1111' }]);
  if (u.pathname === '/agency/d2b_bid') return json(ok(q.bidNm === '체력단련' ? [{ pblancNo: '2026-D-77', pblancOdr: '1', pblancSe: '정상공고', pblancDate: plus(0), bidNm: '부대 체력단련장 위탁운영 용역', ornt: '국군재정관리단', cntrctMth: '제한경쟁', bidStle: '전자입찰', busiDivs: '용역', bidPartcptRegistClosDt: `${plus(5)} 18:00`, biddocPresentnClosDt: `${plus(6)} 10:00`, opengDt: `${plus(6)} 11:00`, bsicExpt: '120000000' }]
    : q.bidNm === '피트니스' ? [{ pblancNo: '2026-D-78', pblancOdr: '1', pblancSe: '정상공고', pblancDate: plus(0), bidNm: '국군 체육시설 피트니스 위탁운영 용역', ornt: '국방부', busiDivs: '용역', g2bPblancNo: '20261021001', g2bPblancOdr: '00', biddocPresentnClosDt: `${plus(9)} 10:00` }] : [], true));
  if (u.pathname === '/agency/d2b_fclty') return json(ok([], true));
  if (u.pathname === '/agency/onbid_lease') {
    if (q.resultType !== 'json' || q.cltrTypeCd !== '0001' || q.prptDivCd !== '0002,0010,0005' || !/^\d{8}$/.test(q.opbdDtStart ?? '')) return json({ header: { resultCode: '10', resultMsg: '필수 입력 누락' }, body: {} });
    return json(ok(q.onbidPbancNm === '스포츠' ? [{ onbidPbancNo: '202610-36613-00', pbancMngNo: 'M-1', pbctNo: 'P-1', onbidPbancNm: '진영스포츠센터 내 용품점 및 자판기 사용·수익허가(3차)', orgNm: '김해시도시개발공사', rspbSbrNm: '시설운영팀', pbancYmd: ymd8(0), cltrBidBgngDt: `${ymd8(1)}1000`, cltrBidEndDt: `${ymd8(3)}1700`, cltrOpbdDt: `${ymd8(4)}1000`, dspsMthodNm: '임대', prptDivNm: '공유재산', pbancKindNm: '일반공고', bidDivNm: '인터넷', pbctNsq: '3' }]
      : q.onbidPbancNm === '골프' ? [{ onbidPbancNo: '202610-90589-00', onbidPbancNm: '골프장 27홀 매각 수의계약 공고', orgNm: '시험 레스포타운', pbancYmd: ymd8(0), cltrBidBgngDt: `${ymd8(1)}1000`, cltrBidEndDt: `${ymd8(5)}1700`, cltrOpbdDt: `${ymd8(6)}1000`, dspsMthodNm: '매각', prptDivNm: '기타일반재산', pbancKindNm: '수의계약공고' }] : [], true)); // #537 후속2: 매각은 영업 대상 아님
  }
  return send(404, 'nope');
}

test('#522 LH·국방·온비드 새 주소·칸: LH(body.item·날짜 형식 다시)·사전규격(번호 없음·담당자 개인정보 안 씀)·국방(나라장터와 같은 공고는 한 줄)·온비드(체육시설 임대는 자판기 섞여도) · 원천별 받은 줄·관련·첫 줄 칸 이름 기록', async () => {
  agencyV2 = true; hits = [];
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/public_agency_bids/run', {});
  assert.equal(r.status, 'success', JSON.stringify(r));
  for (const k of ['lh_bid', 'lh_prespec', 'd2b_bid', 'd2b_fclty', 'onbid_lease']) assert.equal(r.sources[k].ok, true, `${k} ${JSON.stringify(r.sources[k])}`);
  assert.deepEqual([r.sources.lh_bid.received, r.sources.lh_bid.kept, r.sources.lh_bid.note], [2, 1, undefined], '도장공사는 걸러짐 · XML 로 받아 읽음');
  assert.equal(r.sources.lh_prespec.note, '날짜를 yyyy-MM-dd 로 다시 보냄');
  assert.ok(hits.filter((h) => h.path.startsWith('/agency/lh_')).every((h) => !h.q.type && !h.q._type), 'LH 는 type·_type 안 보냄');
  assert.equal(r.sources.lh_bid.sent, undefined, '성공한 원천은 보낸 주소를 안 남김');
  assert.ok(r.sources.lh_bid.keys.includes('bidnmKor') && r.sources.lh_bid.keys.includes('zoneRstrct1'), '첫 줄 칸 이름(값 없이)');
  assert.ok(!JSON.stringify(r.sources).includes('행복주택'), '값은 안 남김');
  assert.match(r.summary, /LH 입찰공고 받음 2·관련 1/); assert.match(r.summary, /온비드 공고\(차세대\) 받음 2·관련 1/, '매각 1건은 받았지만 관련 아님(#537 후속2)'); assert.match(r.summary, /나라장터와 같은 국방 공고 1건은 나라장터 줄로/);
  const row = async (st, ext) => (await sql`select row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_type' = ${st} and row->>'source_external_id' = ${ext} and not gone`)[0]?.row;
  const lh = await row('lh_bid', '2026-0001-0');
  assert.deepEqual([lh.title, lh.estimated_amount, lh.base_amount, lh.region_restriction, lh.demand_agency, lh.fit_business, lh.deadline_at.slice(0, 16)], ['행복주택 커뮤니티 피트니스 운영 위탁 용역', 50000000, 55000000, '경기도, 서울특별시', '경기남부지역본부', '다짐', `${plus(6)}T17:00`]);
  const pre = (await sql`select row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_type' = 'lh_prespec'`).map((x) => x.row);
  assert.equal(pre.length, 1); assert.deepEqual([pre[0].budget_amount, pre[0].region, pre[0].current_status, pre[0].notice_type], [90000000, '경기 화성시', '예정', '사전규격']);
  assert.ok(!JSON.stringify(pre[0]).includes('tester@lh.example') && !JSON.stringify(pre[0]).includes('031-000-1111'), '담당자 메일·전화 저장 안 함');
  const d2b = await row('d2b_bid', '2026-D-77-1');
  assert.deepEqual([d2b.issuer, d2b.base_amount, d2b.bid_category, d2b.participation_deadline_at.slice(0, 16)], ['국군재정관리단', 120000000, '용역', `${plus(5)}T18:00`]);
  assert.deepEqual([d2b.notice_no, d2b.source_url], ['2026-D-77', 'https://www.d2b.go.kr'], '#543 원천 사이트에서 검색할 공고번호(차수 뺌)');
  assert.equal(await row('d2b_bid', '2026-D-78-1'), undefined, '나라장터(20261021001)에 이미 있는 국방 공고는 따로 안 만듦');
  const on = await row('onbid_lease', '202610-36613-00');
  assert.deepEqual([on.title, on.issuer, on.fit_business, on.related, on.notice_type, on.deadline_at.slice(0, 16)], ['진영스포츠센터 내 용품점 및 자판기 사용·수익허가(3차)', '김해시도시개발공사', '다짐', true, '공유재산 임대', `${plus(3)}T17:00`]);
  assert.equal(on.notice_no, '202610-36613-00');
  assert.equal(await row('onbid_lease', '202610-90589-00'), undefined, '#537 후속2(로컬 10/24 12:58): 온비드 매각(재산 팔기)은 저장 안 함 — 임대·사용허가만');
  const oq = hits.find((h) => h.path === '/agency/onbid_lease' && h.q.onbidPbancNm === '스포츠').q;
  assert.deepEqual([oq.resultType, oq.cltrTypeCd, oq.prptDivCd, oq.opbdDtStart, oq.opbdDtEnd], ['json', '0001', '0002,0010,0005', ymd8(0), ymd8(60)]);
  const [run] = await sql`select detail from sales_collector_runs where slug = 'public_agency_bids' order by started_at desc limit 1`;
  assert.deepEqual(Object.keys(run.detail.sources).sort(), ['d2b_bid', 'd2b_fclty', 'lh_bid', 'lh_prespec', 'onbid_lease']);
  const v = await ctx.owner.ok('GET', '/api/sales/collectors');
  assert.ok(v.collectors.find((c) => c.slug === 'public_agency_bids').last.detail.sources.lh_bid.keys.length > 0, '수집기 칸에 원천별 줄');
  // 로컬 10/24 운영: LH 가 '11 NO MANDATORY REQUEST PARAMETERS ERROR' → 원천별 줄에 보낸 주소(키 ***)·응답 앞 300자(메일·전화 가림)
  lhFail = true;
  const f = await ctx.owner.ok('POST', '/api/sales/collectors/public_agency_bids/run', {});
  const lf = f.sources.lh_bid;
  assert.equal(lf.ok, false); assert.match(lf.error, /11 NO MANDATORY REQUEST PARAMETERS ERROR/);
  assert.equal(lf.note, '날짜를 yyyy-MM-dd 로 다시 보냄', '두 날짜 형식 모두 시도');
  assert.match(lf.sent, /\/agency\/lh_bid\?serviceKey=\*\*\*&numOfRows=100&pageNo=1&tndrbidRegDtStart=\d{4}-\d{2}-\d{2}&tndrbidRegDtEnd=/, lf.sent);
  assert.match(lf.head, /^<\?xml .*<resultCode>11<\/resultCode>/); assert.ok(lf.head.length <= 300);
  assert.ok(!lf.head.includes('tester@lh.example') && !lf.head.includes('031-000-1111') && lf.head.includes('***@***'), '응답 앞부분의 메일·전화는 가림');
  assert.equal(f.sources.d2b_bid.ok, true, '다른 원천은 그대로');
  lhFail = false; agencyV2 = false;
});

test('#522 관광숙박업 오류 응답(JSON)도 코드·사유 그대로 · 영업상태 조건으로 0건이면 조건 없이 · 누락 점검(2회 연속 실패 → 영업 홈 빨간 띠·수집기 칸)', async () => {
  hotelMode = 'denied';
  const a = await ctx.owner.ok('POST', '/api/sales/collectors/tourist_hotels_localdata/run', {});
  assert.equal(a.status, 'failed'); assert.match(a.summary, /^활용신청 필요\(HTTP 401\): 30 SERVICE_KEY_IS_NOT_REGISTERED_ERROR/); assert.equal(a.sources.tourist_hotels.ok, false);
  let v = await ctx.owner.ok('GET', '/api/sales/collectors');
  assert.ok(!v.alerts.some((x) => x.slug === 'tourist_hotels_localdata'), '한 번 실패로는 아직');
  await ctx.owner.ok('POST', '/api/sales/collectors/tourist_hotels_localdata/run', {});
  v = await ctx.owner.ok('GET', '/api/sales/collectors');
  const al = v.alerts.find((x) => x.slug === 'tourist_hotels_localdata');
  assert.ok(al, JSON.stringify(v.alerts)); assert.equal(al.reason, '2회 연속 실패'); assert.match(al.error, /활용신청 필요/); assert.match(al.label, /관광숙박업/);
  const home = await ctx.owner.ok('GET', '/api/sales/src?view=summary');
  assert.ok(home.collectorAlerts.some((x) => x.slug === 'tourist_hotels_localdata'), '영업 홈 빨간 띠 자료');
  // 마지막 성공이 25시간 넘음 → 문제(연속 실패가 아니어도)
  hotelMode = 'nocond';
  const b = await ctx.owner.ok('POST', '/api/sales/collectors/tourist_hotels_localdata/run', {});
  assert.notEqual(b.status, 'failed', JSON.stringify(b)); assert.match(b.summary, /영업상태 조건 없이 받음/);
  v = await ctx.owner.ok('GET', '/api/sales/collectors');
  assert.ok(!v.alerts.some((x) => x.slug === 'tourist_hotels_localdata'), '성공하면 사라짐');
  await sql`update sales_collector_runs set started_at = started_at - interval '26 hours' where slug = 'tourist_hotels_localdata'`;
  v = await ctx.owner.ok('GET', '/api/sales/collectors');
  assert.match(v.alerts.find((x) => x.slug === 'tourist_hotels_localdata').reason, /^마지막 성공 2\d시간 전$/);
  hotelMode = 'ok';
});
