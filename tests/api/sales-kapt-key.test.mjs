// #476 f: K-apt 키 — KAPT_SERVICE_KEY 가 없으면 같은 공공데이터포털 키(DATA_GO_KR_SERVICE_KEY)로 · 활용신청 안 된 키 = '활용신청 필요(서비스 번호)'
// 구조 시험(가짜 원천 서버). 실제 data.go.kr 15058166·15059177 응답 확인이 아님(대표 활용신청 중)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const PORT = 3237;
let srv, ctx, sql, fake; const keys = []; let saDenied = false;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const plus = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
const dataGo = (items) => JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' }, body: { items, numOfRows: 100, pageNo: 1, totalCount: items.length } } });
// 포털은 활용신청 안 된 키에 HTTP 403 + XML(30 SERVICE_KEY_IS_NOT_REGISTERED_ERROR)
const DENIED = '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>';
before(async () => {
  fake = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); const send = (code, text, type = 'text/html; charset=utf-8') => { res.statusCode = code; res.setHeader('content-type', type); res.end(text); };
    if (u.pathname === '/kapt/bid/bidList.do') return send(200, u.searchParams.get('pageNo') === '1' ? `<html><table><tr><td>1</td><td>K-APT</td><td>적격심사</td><td><a href="javascript:goView('20261023000001')">[경기용인] 커뮤니티 헬스장 위탁운영 사업자 선정</a></td><td>${plus(9)} 17:00</td><td>신규공고</td><td>용인 시험단지</td><td>${today} 09:00</td></tr></table></html>` : '<html><table></table></html>');
    if (u.pathname === '/kapt/bid/bidDetail.do') return send(200, '<html><table><tr><th>입찰분류</th><td>용역 &gt; 커뮤니티 위탁운영</td></tr></table></html>');
    if (u.pathname === '/kaptbidapi/getPblAncDeSearchV3') return send(403, DENIED, 'application/xml');
    if (u.pathname === '/kaptapi/getBidSttusSearchV3') { keys.push(u.searchParams.get('serviceKey')); return saDenied ? send(403, DENIED, 'application/xml')
      : send(200, dataGo([{ bidNum: 'SA-K1', bidKaptname: '용인 시험단지', aptCode: 'A90001', bidArea: '41', bidTitle: '커뮤니티 시설 위탁운영 사업자 선정', contractPeriodSdate: plus(-300), contractPeriodEdate: plus(65) }, { bidNum: 'SA-K2', bidKaptname: '수원 시험단지', aptCode: 'A90002', bidTitle: '승강기 유지보수' }]), 'application/json'); }
    if (u.pathname === '/kaptapi/getBidEntrpsInfoSearchV3') return send(200, dataGo([{ companyName: '다짐', bidSuccessfulYn: 'Y' }]), 'application/json');
    send(404, 'nope');
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}`, DATA_GO_KR_SERVICE_KEY: 'portal-key', KAPT_SERVICE_KEY: '' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('KAPT_SERVICE_KEY 없음 → 포털 키로 사업자선정 수집 · 키 칸 "있음" · 활용신청 안 됐으면 서비스 번호 안내', async () => {
  const sa = (await ctx.owner.ok('GET', '/api/sales/collectors')).collectors.find((c) => c.slug === 'kapt_sa_sun');
  assert.deepEqual(sa.needs, [{ key: 'KAPT_SERVICE_KEY(없으면 DATA_GO_KR_SERVICE_KEY)', present: true }], '포털 키가 있으면 있음');
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/kapt_sa_sun/run', {});
  assert.equal(r.inserted, 2, JSON.stringify(r)); assert.ok(keys.length && keys.every((k) => k === 'portal-key'), '대체 키로 호출(올해·작년)');
  saDenied = true;
  const d = await ctx.owner.ok('POST', '/api/sales/collectors/kapt_sa_sun/run', {});
  assert.equal(d.status, 'failed'); assert.match(d.summary, /K-apt 사업자선정: 공공데이터포털 활용신청 필요\(서비스 15059177\)/, d.summary); assert.ok(!JSON.stringify(d).includes('portal-key'), '키 값은 안 보임');
});

test('K-apt 입찰공고: 공식 API(15058166) 활용신청 전이면 안내 + 목록 화면 공고는 그대로 적재(일부 성공)', async () => {
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  assert.equal(r.status, 'partial', JSON.stringify(r)); assert.equal(r.inserted, 1);
  assert.match(r.summary, /공식 API: 공공데이터포털 활용신청 필요\(서비스 15058166\)/, r.summary); assert.match(r.errorLog, /공식 API\(15058166\)/);
  const [row] = await sql`select row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_external_id' = '20261023000001'`;
  assert.equal(row.row.classification, '즉시 검토'); assert.ok(!JSON.stringify(r).includes('portal-key'));
});
