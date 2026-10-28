// #743 1단계 나라장터(대표 결정 15-38 '파일 열기 전에 참가자격'): 관련 공고(마감 전)마다 입찰공고정보서비스 면허제한·참가가능지역 조회를 공고번호로 한 번 →
// license_limit·region_restriction(목록 값보다 자세함)·limits_read_at · 다시 수집하면 다시 안 묻고 목록의 짧은 값으로 덮지 않음 · 관련 아닌 공고는 안 물음 ·
// 입찰 목록 '자격·조건' 한 줄 (구조 시험 — 칸 이름은 공공데이터포털 명세, 실제 응답은 운영 키로만 확인)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const PORT = 3277;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date());
const plus = (n) => kst(new Date(Date.parse(`${today}T12:00:00+09:00`) + n * 864e5));
const dataGo = (items) => JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' }, body: { items, numOfRows: 100, pageNo: 1, totalCount: items.length } } });
const FIT = { bidNtceNo: 'R26BK0074301', bidNtceOrd: '000', bidNtceNm: '국민체육센터 피트니스 위탁운영 용역', ntceInsttNm: '시험시청', dminsttNm: '시험시청', bidNtceDt: `${today} 09:00:00`,
  bidClseDt: `${plus(10)} 10:00:00`, prtcptLmtRgnNm: '경기도', cntrctCnclsMthdNm: '제한경쟁' };
const OTHER = { bidNtceNo: 'R26BK0074302', bidNtceOrd: '000', bidNtceNm: '청사 소독 용역(피트니스 아님)', ntceInsttNm: '시험구청', bidNtceDt: `${today} 09:00:00`, bidClseDt: `${plus(10)} 10:00:00` };
let srv, ctx, sql, fake; const calls = [];
before(async () => {
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); for await (const _ of req) { /* 본문 없음 */ }
    const send = (text) => { res.statusCode = 200; res.setHeader('content-type', 'application/json'); res.end(text); };
    if (u.pathname.endsWith('/getBidPblancListInfoLicenseLimit')) { calls.push(['license', u.searchParams.get('bidNtceNo'), u.searchParams.get('inqryDiv')]);
      return send(dataGo(u.searchParams.get('bidNtceNo') === FIT.bidNtceNo ? [{ bidNtceNo: FIT.bidNtceNo, bidNtceOrd: '000', lmtGrpNo: '1', lcnsLmtNm: '체육시설업(4993)', permsnIndstrytyList: '체육시설업' },
        { bidNtceNo: FIT.bidNtceNo, bidNtceOrd: '001', lcnsLmtNm: '다른 차수 면허' }] : [])); }
    if (u.pathname.endsWith('/getBidPblancListInfoPrtcptPsblRgn')) { calls.push(['region', u.searchParams.get('bidNtceNo'), u.searchParams.get('inqryDiv')]);
      return send(dataGo(u.searchParams.get('bidNtceNo') === FIT.bidNtceNo ? [{ bidNtceNo: FIT.bidNtceNo, bidNtceOrd: '000', lmtSno: '1', prtcptPsblRgnNm: '경기도' }, { bidNtceNo: FIT.bidNtceNo, bidNtceOrd: '000', lmtSno: '2', prtcptPsblRgnNm: '서울특별시' }] : [])); }
    if (u.pathname.endsWith('/getBidPblancListInfoServcPPSSrch')) return send(dataGo(u.searchParams.get('bidNtceNm') === '피트니스' ? [FIT, OTHER] : []));
    return send(dataGo([]));
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}`, DATA_GO_KR_SERVICE_KEY: 'test-key' }); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });
const rowOf = async (no) => (await sql`select row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_external_id' = ${`${no}-000`}`)[0]?.row;

test('관련 공고만 면허제한·참가가능지역을 공고번호로 묻고(같은 차수만) 저장 · 요약에 건수', async () => {
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/g2b_bid_notices/run', {});
  assert.match(r.summary, /참가 제한 조회 1건\(값 1\)/, r.summary);
  assert.deepEqual(calls.map((c) => c.join('|')).sort(), [`license|${FIT.bidNtceNo}|2`, `region|${FIT.bidNtceNo}|2`], '관련 아닌 공고는 안 물음 · 공고번호로(inqryDiv 2)');
  const a = await rowOf(FIT.bidNtceNo);
  assert.deepEqual([a.license_limit, a.region_restriction, !!a.limits_read_at], ['체육시설업(4993) / 체육시설업', '경기도 · 서울특별시', true]);
  assert.equal((await rowOf(OTHER.bidNtceNo))?.limits_read_at ?? null, null);
});

test('다시 수집: 다시 안 묻고 목록의 짧은 값(경기도)으로 덮지 않음 · 입찰 목록 자격·조건 한 줄', async () => {
  const a0 = await rowOf(FIT.bidNtceNo);
  await ctx.owner.ok('POST', '/api/sales/collectors/g2b_bid_notices/run', {});
  assert.equal(calls.length, 2, '한 번 읽은 공고는 다시 안 물음');
  const a1 = await rowOf(FIT.bidNtceNo);
  assert.deepEqual([a1.region_restriction, a1.license_limit, a1.limits_read_at, a1.updated_at], [a0.region_restriction, a0.license_limit, a0.limits_read_at, a0.updated_at]);
  const it = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all')).items.find((x) => String(x.noticeNo ?? '').startsWith(FIT.bidNtceNo));
  assert.match(it?.terms ?? '', /업종 제한 체육시설업\(4993\)/); assert.match(it?.terms ?? '', /지역 제한 경기도 · 서울특별시/);
});
