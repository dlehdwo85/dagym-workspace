// 384차 #1005(대표 11/07 "공기업 사이트 공고도 받게"): 공공기관 입찰 수집기에 한국수자원공사 전자조달(15101635 — 용역·공사·물품, searchDt=YYYYMM, JSON)·
// 한국마사회 전자입찰(15058158 — notice_month, XML)을 더함. 담당자 이름은 저장 안 함 · 마사회 작성·품의 단계(공고 전)·매각은 뺌 ·
// 나라장터에도 보낸 마사회 공고(renotifyCnt=1)는 나라장터 줄이 맡음
// (구조 시험 — 가짜 공공데이터포털 응답은 11/07 공공데이터포털 명세(swagger·요청/출력 표)의 칸 이름 그대로. 실제 연동은 활용신청 뒤 운영 확인 몫)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const PORT = 3303;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date());
const plus = (n) => kst(new Date(Date.parse(`${today}T12:00:00+09:00`) + n * 864e5));
const ymd8 = (d) => d.replace(/-/g, '');
const ym = today.slice(0, 7).replace('-', '');
const hits = [];
const json = (items) => JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' }, body: { items: { item: items }, numOfRows: 100, pageNo: 1, totalCount: items.length } } });
const xmlEsc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xml = (items) => `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><items>${items.map((it) => `<item>${Object.entries(it).map(([k, v]) => `<${k}>${xmlEsc(v)}</${k}>`).join('')}</item>`).join('')}</items><numOfRows>100</numOfRows><pageNo>1</pageNo><totalCount>${items.length}</totalCount></body></response>`;
const KRA = (bCode, bidName, o = {}) => ({ bCode, renotifyCnt: '0', bidName, status: '20', noticeDate: ymd8(today), noticeTime: '09:00', workType: '03', contGubun: '총액', contMethod: '1',
  noticeAuth: '한국마사회', demandAuth: '렛츠런파크 서울', registEndDate: ymd8(plus(5)), registEndTime: '18:00:00', openDate: ymd8(plus(6)), openTime: '10:00', bidEndDate: ymd8(plus(6)), bidEndTime: '17:00', openPlace: '입찰 담당자 PC', sendDate: ymd8(today), ...o });
let srv, ctx, sql, fake;
before(async () => {
  fake = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const q = Object.fromEntries(u.searchParams); hits.push({ path: u.pathname, q });
    const send = (code, text, type = 'application/json') => { res.statusCode = code; res.setHeader('content-type', type); res.end(text); };
    if (u.pathname === '/agency/kwater_servc') return send(200, json(q.searchDt === ym ? [{ cntrctDivNm: '용역', tndrPblancDe: ymd8(today), tndrPblancEnddt: ymd8(plus(7)), intnChargerNm: '김담당', tndrPlnprc: '150000000',
      cntrctDeptNm: '시설관리처', tndrPbanno: 'KW-2026-1005', tndrPblancNm: '수자원공사 사옥 피트니스센터 위탁운영 용역', ctrmthdCdNm: '제한경쟁', tndrStat: '공고중' }] : []));
    if (u.pathname === '/agency/kwater_cntrwk') return send(200, json(q.searchDt === ym ? [{ cntrctDivNm: '공사', tndrPblancDe: ymd8(today), tndrPblancEnddt: ymd8(plus(7)), tndrPbanno: 'KW-2026-2001', tndrPblancNm: '정수장 배관 교체공사', tndrStat: '공고중' }] : []));
    if (u.pathname === '/agency/kwater_gds') return send(200, json([]));
    if (u.pathname === '/agency/kra_bid') {
      if (q.type || q._type) return send(400, 'type not allowed'); // 마사회는 XML 만
      return send(200, xml(q.notice_month === ym ? [KRA('2026110701', '렛츠런파크 서울 직원 체력단련실 위탁운영 용역'), KRA('2026110702', '렛츠런파크 부산 피트니스센터 위탁운영 용역', { renotifyCnt: '1' }),
        KRA('2026110703', '렛츠런파크 제주 체력단련실 위탁운영 용역', { status: '10' }), KRA('2026110704', '경마공원 골프연습장 부지 매각', { workType: '05' })] : []), 'application/xml;charset=UTF-8');
    }
    if (u.pathname.startsWith('/agency/lh_')) return send(200, xml([]), 'application/xml;charset=UTF-8');
    if (u.pathname.startsWith('/agency/')) return send(200, json([]));
    send(404, 'nope');
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}`, DATA_GO_KR_SERVICE_KEY: 'test-key' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('수자원공사 용역 위탁운영 = 관련 · 공사는 걸러짐 · 담당자 이름 저장 안 함 · 마사회 공고중만·매각 빼고·나라장터에도 보낸 공고는 나라장터 줄로', async () => {
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/public_agency_bids/run', {});
  assert.notEqual(r.status, 'failed', r.summary);
  for (const k of ['kwater_servc', 'kwater_cntrwk', 'kwater_gds', 'kra_bid']) assert.equal(r.sources[k].ok, true, `${k} ${JSON.stringify(r.sources[k])}`);
  assert.deepEqual([r.sources.kwater_servc.received, r.sources.kwater_servc.kept], [1, 1]);
  assert.deepEqual([r.sources.kwater_cntrwk.received, r.sources.kwater_cntrwk.kept], [1, 0], '배관 교체공사는 관련 아님');
  assert.deepEqual([r.sources.kra_bid.received, r.sources.kra_bid.kept], [4, 1], '공고중 1건만 — 품의중·매각·나라장터 전송 건 제외');
  assert.match(r.summary, /수자원공사 입찰\(용역\) 받음 1·관련 1/); assert.match(r.summary, /마사회 전자입찰 받음 4·관련 1/);
  assert.match(r.summary, /나라장터에도 올린 마사회 관련 공고 1건은 나라장터 줄로/);
  // 요청 칸: 수자원 searchDt=이번 달·JSON / 마사회 notice_month=이번 달·XML(type 칸 없음)
  assert.ok(hits.some((h) => h.path === '/agency/kwater_servc' && h.q.searchDt === ym && h.q._type === 'json' && h.q.serviceKey === 'test-key'));
  assert.ok(hits.filter((h) => h.path === '/agency/kra_bid').every((h) => !h.q.type && !h.q._type) && hits.some((h) => h.path === '/agency/kra_bid' && h.q.notice_month === ym));
  const row = async (st, ext) => (await sql`select row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_type' = ${st} and row->>'source_external_id' = ${ext} and not gone`)[0]?.row;
  const kw = await row('kwater_bid', 'KW-2026-1005');
  assert.deepEqual([kw.title, kw.issuer, kw.demand_agency, kw.estimated_amount, kw.contract_method, kw.bid_category, kw.fit_business, kw.posted_date, kw.deadline_at],
    ['수자원공사 사옥 피트니스센터 위탁운영 용역', '한국수자원공사', '시설관리처', 150000000, '제한경쟁', '용역', '다짐', today, `${plus(7)}T23:59:00+09:00`]);
  assert.deepEqual([kw.notice_no, kw.source_url], ['KW-2026-1005', 'https://ebid.kwater.or.kr'], '바로 가는 주소가 없어 전자조달 첫 화면 + 공고번호');
  assert.ok(!JSON.stringify(kw).includes('김담당'), '담당자 이름 저장 안 함');
  assert.equal(await row('kwater_bid', 'KW-2026-2001'), undefined);
  const kra = await row('kra_bid', '2026110701');
  assert.deepEqual([kra.title, kra.issuer, kra.demand_agency, kra.contract_method, kra.bid_category, kra.current_status, kra.deadline_at, kra.participation_deadline_at],
    ['렛츠런파크 서울 직원 체력단련실 위탁운영 용역', '한국마사회', '렛츠런파크 서울', '일반경쟁', '일반용역', '진행중', `${plus(6)}T17:00:00+09:00`, `${plus(5)}T18:00:00+09:00`]);
  assert.match(kra.task_scope, /개찰 장소 입찰 담당자 PC/);
  for (const ext of ['2026110702', '2026110703', '2026110704']) assert.equal(await row('kra_bid', ext), undefined, ext);
  // 입찰 목록 카드 원천 이름
  const items = (await ctx.owner.ok('GET', `/api/sales/src?view=bids&tab=all&q=${encodeURIComponent('위탁운영')}`)).items;
  const k1 = items.find((n) => n.noticeNo === 'KW-2026-1005'), k2 = items.find((n) => n.noticeNo === '2026110701');
  assert.ok(k1 && k2, JSON.stringify(items.map((n) => n.noticeNo)));
  assert.deepEqual([k1.source, k2.source], ['kwater_bid', 'kra_bid']);
  // 바로 가는 상세 주소가 없음 → '○○에서 공고번호 검색' 안내
  assert.deepEqual([k1.search?.site, k1.search?.no, k2.search?.site, k2.search?.no], ['수자원공사 전자조달', 'KW-2026-1005', '마사회 전자입찰', '2026110701']);
});
