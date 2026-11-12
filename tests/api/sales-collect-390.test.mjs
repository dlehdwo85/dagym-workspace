// 390차(대표 11/13 00:23 영업 홈 '영업 DB 수집 누락 위험 7곳 — 왜 그런지 확인하고 조치'):
// ① 'LH 사전규격 — 오늘 호출 한도' = 원천이 오류 화면(HTML)을 돌려준 것까지 오류 문장 속 '호출 한도 초과' 글자 때문에 호출 한도로 잘못 분류 → 웹페이지 응답으로
// ② 'LH 입찰공고 — 수집에 실패' = 연결 끊김('요청 실패 (TypeError)')이 분류되지 않았음 + 하루 한 번(06시) 실패하면 그날 공고를 통째로 놓침
//    → 같은 요청 한 번 더 · 그래도 못 받으면 30분 뒤 다시 실행(retry) · 원인 코드(ECONNRESET 등)를 남김
// ③ '협력사 모집 감시 — 원천 서버가 응답하지 않았습니다' = 한 곳만 막혀도 전체가 실패, 해외(싱가포르) 접속을 끊는 국내 사이트(서희건설 등)
//    → 서울 중계로 한 번 더 · 회사별로 따로 기록('협력사 모집 감시 › 시험건설') · 다섯 곳씩 함께 읽음
// ④ 수자원공사·마사회 '활용신청 필요'에 서비스 번호·[신청 방법] 주소 (구조 시험 — 가짜 원천. 운영 원인 원문은 노트북 확인 몫)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const PORT = 3390;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const xml = (items) => `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header><body><items>${items.join('')}</items><numOfRows>100</numOfRows><pageNo>1</pageNo><totalCount>${items.length}</totalCount></body></response>`;
const notReg = '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>';
const hits = {}; let vendorMode = 'resetOnce';
let srv, ctx, sql, fake;
before(async () => {
  fake = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); hits[u.pathname] = (hits[u.pathname] ?? 0) + 1; const n = hits[u.pathname];
    const send = (code, text, type = 'application/json') => { res.statusCode = code; res.setHeader('content-type', type); res.end(text); };
    // 서희건설처럼 해외 접속을 끊는 곳: 첫 요청(직접)은 연결을 끊고, 다음(서울 중계)은 받음 · down = 늘 끊음
    if (u.pathname === '/vendor/notice') { if (vendorMode === 'down' || (vendorMode === 'resetOnce' && n % 2 === 1)) return req.socket.destroy();
      return send(200, `<html><ul><li><a href="/notice/390">2026년 협력업체 정기등록 모집 안내</a> <span>${today}</span></li></ul></html>`, 'text/html; charset=utf-8'); }
    if (u.pathname === '/agency/lh_bid') return n === 1 ? req.socket.destroy() : send(200, xml([]), 'application/xml;charset=UTF-8'); // 첫 요청만 연결 끊김
    if (u.pathname === '/agency/lh_prespec') return send(500, '<html><head><title>Error</title></head><body><h1>500 Internal Server Error</h1></body></html>', 'text/html');
    if (/^\/agency\/(kwater_|kra_bid)/.test(u.pathname)) return send(403, notReg, 'application/xml');
    if (u.pathname.startsWith('/agency/')) return send(200, JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'OK' }, body: { items: [], numOfRows: 100, pageNo: 1, totalCount: 0 } } }));
    send(404, 'nope');
  }).listen(PORT);
  await resetDb();
  srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}`, DATA_GO_KR_SERVICE_KEY: 'test-key', KR_RELAY: 'force' /* 운영(싱가포르)처럼 서울 중계 켬 */ });
  sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('협력사 모집 감시: 직접 접속이 끊긴 사이트는 서울 중계로 받음 · 계속 막히면 그 회사만 누락 위험(회사 이름)', async () => {
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/vendor_recruit_watch/run', {});
  assert.notEqual(r.status, 'failed', r.summary + ' ' + r.errorLog);
  assert.match(r.summary, /서울 중계로 받은 곳 1/);
  const src = Object.values(r.sources);
  assert.deepEqual(src.map((s) => [s.label, s.ok, s.note]), [['시험건설', true, '서울 중계로 받음']], '회사별 기록');
  const [row] = await sql`select row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_type' = 'vendor_recruit' and not gone`;
  assert.equal(row?.row.title, '[시험건설] 2026년 협력업체 정기등록 모집 안내');
  // 직접·중계 모두 막힘 → 2번 연속 실패 → 그 페이지 한 줄(시험은 감시 페이지가 1곳이라 이름 그대로 — 운영 21곳은 '협력사 모집 감시 › 서희건설'처럼 회사별)
  vendorMode = 'down';
  for (let i = 0; i < 2; i++) { const f = await ctx.owner.ok('POST', '/api/sales/collectors/vendor_recruit_watch/run', {}); assert.match(f.errorLog ?? '', /시험건설: .*서울 중계로도 못 받음/, f.errorLog); }
  const al = (await ctx.owner.ok('GET', '/api/sales/collectors')).alerts.filter((a) => a.slug === 'vendor_recruit_watch');
  assert.deepEqual(al.map((a) => [a.label, a.source, a.action]), [['협력사 모집 감시', src.length === 1 && Object.keys(r.sources)[0], 'retry']], JSON.stringify(al));
  assert.match(al[0].error, /서울 중계로도 못 받음/);
  assert.match(al[0].todo, /^원천 서버가 응답하지 않았습니다/);
});

test('공공기관 입찰: 연결 끊김은 한 번 더 받아 성공 · 오류 화면(HTML)은 호출 한도가 아님 · 못 받은 원천이 있으면 30분 뒤 다시 실행 · 활용신청 줄에 서비스 번호', async () => {
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/public_agency_bids/run', {});
  assert.equal(r.sources.lh_bid.ok, true, JSON.stringify(r.sources.lh_bid));
  assert.match(r.sources.lh_bid.note ?? '', /일시 오류로 한 번 더 받음\(요청 실패 \(TypeError/, 'LH 입찰공고: 첫 요청 연결 끊김 → 같은 요청 한 번 더');
  assert.equal(hits['/agency/lh_bid'], 2, '날짜 형식 바꿔 보내기가 아니라 같은 요청 한 번 더(두 번)');
  assert.equal(r.sources.lh_prespec.ok, false); assert.match(r.sources.lh_prespec.error, /웹페이지\(HTML\) 응답 \(HTTP 500\)/);
  assert.equal(r.retry, true, '못 받은 원천(일시 장애)이 있으면 다시 실행 표시');
  const [run] = await sql`select detail from sales_collector_runs where slug = 'public_agency_bids' order by started_at desc limit 1`;
  assert.equal(run.detail.retry, true);
  await ctx.owner.ok('POST', '/api/sales/collectors/public_agency_bids/run', {});
  const al = (await ctx.owner.ok('GET', '/api/sales/collectors')).alerts.filter((a) => a.slug === 'public_agency_bids');
  const by = Object.fromEntries(al.map((a) => [a.source, a]));
  assert.ok(!by.lh_bid, 'LH 입찰공고는 받았으니 문제 아님');
  assert.equal(by.lh_prespec?.action, 'retry', JSON.stringify(by.lh_prespec));
  assert.match(by.lh_prespec.todo, /^원천이 자료 대신 웹페이지\(오류 화면\)를 돌려줬습니다/);
  assert.doesNotMatch(by.lh_prespec.todo, /호출 한도/, '예전: 오류 문장 속 "호출 한도 초과" 글자로 잘못 분류');
  for (const [k, svc] of [['kwater_servc', '15101635'], ['kwater_cntrwk', '15101635'], ['kwater_gds', '15101635'], ['kra_bid', '15058158']]) {
    assert.equal(by[k]?.action, 'apply', k);
    assert.deepEqual([by[k].todo, by[k].link], [`공공데이터포털 활용신청(서비스 ${svc})이 필요합니다`, `https://www.data.go.kr/data/${svc}/openapi.do`], k);
  }
});
