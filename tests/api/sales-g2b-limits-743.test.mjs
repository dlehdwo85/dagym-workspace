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
const EMPTY = 'R26BK0074303'; // 이미 물었는데 값이 없던 공고(245차 진단)
// 258차: 마감 칸(bidClseDt)이 빈 협상 공고 — 공고번호 조회에 날짜 칸만 돌려주는지(담당자 전화는 안 돌려줌)
const NODL = { bidNtceNo: 'R26BK0074304', bidNtceOrd: '000', bidNtceNm: '(협상)시험 파크골프장 타당성 조사 용역', bidNtceDt: `${today} 09:00:00`, bidClseDt: '', opengDt: `${plus(12)} 11:00:00`,
  rgstDt: `${today} 08:59:00`, cntrctCnclsMthdNm: '협상에 의한 계약', bidMethdNm: '전자입찰', ntceInsttOfclTelNo: '010-1234-5678' };
// 259차: 목록 응답에 입찰 마감이 없는 공고(직찰·협상) — 공동수급협정 마감을 임시 마감으로(관련 아닌 제목: 참가 제한 조회 건수에 안 섞임)
const AGR = { bidNtceNo: 'R26BK0074305', bidNtceOrd: '000', bidNtceNm: '청사 청소 용역(협상)', ntceInsttNm: '시험군청', bidNtceDt: `${today} 09:00:00`, bidClseDt: '',
  cmmnSpldmdAgrmntClseDt: `${plus(7)} 18:00:00`, opengDt: `${plus(8)} 17:00:00` };
let srv, ctx, sql, fake; const calls = [];
before(async () => {
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); for await (const _ of req) { /* 본문 없음 */ }
    const send = (text) => { res.statusCode = 200; res.setHeader('content-type', 'application/json'); res.end(text); };
    // 245차 진단: 게시일 기간(inqryDiv 1)으로 물으면 번호로는 안 나오던 공고 줄이 나오는 경우
    if (u.searchParams.get('inqryDiv') === '1' && /LicenseLimit|PrtcptPsblRgn$/.test(u.pathname)) return send(dataGo(u.pathname.endsWith('/getBidPblancListInfoLicenseLimit') ? [{ bidNtceNo: EMPTY, bidNtceOrd: '000', lcnsLmtNm: '체육시설업(4993)' }, { bidNtceNo: 'R26BK0099999', bidNtceOrd: '000', lcnsLmtNm: '남의 공고' }] : []));
    if (u.pathname.endsWith('/getBidPblancListInfoLicenseLimit')) { calls.push(['license', u.searchParams.get('bidNtceNo'), u.searchParams.get('inqryDiv')]);
      return send(dataGo(u.searchParams.get('bidNtceNo') === FIT.bidNtceNo ? [{ bidNtceNo: FIT.bidNtceNo, bidNtceOrd: '000', lmtGrpNo: '1', lcnsLmtNm: '체육시설업(4993)', permsnIndstrytyList: '체육시설업' },
        { bidNtceNo: FIT.bidNtceNo, bidNtceOrd: '001', lcnsLmtNm: '다른 차수 면허' }] : [])); }
    if (u.pathname.endsWith('/getBidPblancListInfoPrtcptPsblRgn')) { calls.push(['region', u.searchParams.get('bidNtceNo'), u.searchParams.get('inqryDiv')]);
      return send(dataGo(u.searchParams.get('bidNtceNo') === FIT.bidNtceNo ? [{ bidNtceNo: FIT.bidNtceNo, bidNtceOrd: '000', lmtSno: '1', prtcptPsblRgnNm: '경기도' }, { bidNtceNo: FIT.bidNtceNo, bidNtceOrd: '000', lmtSno: '2', prtcptPsblRgnNm: '서울특별시' }] : [])); }
    if (u.pathname.endsWith('/getBidPblancListInfoServcPPSSrch')) return send(dataGo(u.searchParams.get('bidNtceNm') === '피트니스' ? [FIT, OTHER] : u.searchParams.get('bidNtceNm') === '골프' ? [AGR] : []));
    if (u.pathname.endsWith('/getBidPblancListInfoServc')) return send(dataGo(u.searchParams.get('bidNtceNo') === NODL.bidNtceNo && u.searchParams.get('inqryDiv') === '2' ? [NODL] : []));
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
  // 252차 #786: 업종·지역 제한은 '입찰 방식' 줄이 아니라 '참가자격' 줄로(공고문을 아직 안 읽었으면 API 칸만)
  assert.equal(it?.elig?.line, '업종 체육시설업 · 지역 경기도·서울특별시'); assert.ok(!/업종 제한|지역 제한/.test(it?.terms ?? ''), it?.terms);
});

test('245차 플랫폼 공고 조회 g2b=1: 이미 물었는데 값이 없는 공고를 세 가지 방법으로 다시 물어 응답만(저장 안 함 · 키 가림) · 번호 지정', async () => {
  const id = '00000000-0000-4000-8000-000000245001';
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${id}, ${sql.json({ id, source_type: 'g2b_bid', source_external_id: `${EMPTY}-000`, title: '시험 체육관 위탁운영 용역',
    posted_date: today, limits_read_at: new Date().toISOString() })}, 'workin')`;
  const before = (await sql`select row, synced_at from sales_src_rows where src_id = ${id}`)[0];
  const r = (await ctx.owner.ok('GET', '/api/platform/sales-notices?g2b=1')).g2b;
  assert.equal(r.picked, 'read-but-empty');
  assert.deepEqual(r.notices.map((n) => n.no), [`${EMPTY}-000`], '값을 읽은 공고(FIT)는 안 고름');
  const t = r.notices[0].tries; const one = (kind, how) => t.find((x) => x.kind === kind && x.how === how);
  assert.equal(t.length, 6, '두 조회 × 공고번호·공고번호+차수·게시일 기간');
  assert.deepEqual([one('license', '공고번호').raw, one('license', '공고번호').same, one('license', '공고번호').codes], [0, 0, { '00': 1 }]);
  assert.deepEqual([one('license', '게시일 기간').raw, one('license', '게시일 기간').same], [2, 1], '같은 공고 줄만 셈');
  assert.match(one('license', '게시일 기간').first, /체육시설업\(4993\)/);
  assert.ok(t.every((x) => !JSON.stringify(x).includes('test-key')), '키 가림');
  const after = (await sql`select row, synced_at from sales_src_rows where src_id = ${id}`)[0];
  assert.deepEqual([after.row, after.synced_at], [before.row, before.synced_at], '저장 안 함');
  const g = (await ctx.owner.ok('GET', `/api/platform/sales-notices?g2b=1&no=${FIT.bidNtceNo}`)).g2b;
  assert.deepEqual([g.picked, g.notices[0].no, g.notices[0].tries.find((x) => x.kind === 'region' && x.how === '공고번호').same], ['given', `${FIT.bidNtceNo}-000`, 2]);
  assert.equal((await ctx.owner.ok('GET', `/api/platform/sales-notices?g2b=1&no=${encodeURIComponent('../x')}`)).g2b, undefined, '이상한 번호는 진단 없음');
});

test('245차: 예전에 저장된 줄(limits_read_at 빈 값)은 아직 안 읽은 것 — 다음 수집에서 물음', async () => {
  await sql`update sales_src_rows set row = row || '{"limits_read_at": null, "license_limit": null}'::jsonb where tbl = 'procurement_notices' and row->>'source_external_id' = ${`${FIT.bidNtceNo}-000`}`;
  const n0 = calls.length;
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/g2b_bid_notices/run', {});
  assert.match(r.summary, /참가 제한 조회 1건\(값 1\)/, r.summary);
  assert.deepEqual(calls.slice(n0).map((c) => c.join('|')).sort(), [`license|${FIT.bidNtceNo}|2`, `region|${FIT.bidNtceNo}|2`]);
  const a = await rowOf(FIT.bidNtceNo);
  assert.deepEqual([a.license_limit, !!a.limits_read_at], ['체육시설업(4993) / 체육시설업', true]);
});

test('258차 플랫폼 공고 조회 g2b=dates: 공고번호로 날짜 칸·계약 방식만(담당자 전화·키 없음 · 저장 안 함) · 못 찾은 조회는 한 줄씩', async () => {
  const d = (await ctx.owner.ok('GET', `/api/platform/sales-notices?g2b=dates&no=${NODL.bidNtceNo}-000`)).g2bDates;
  const f = d.found.find((x) => x.cat === '용역' && x.how === '공고번호');
  assert.deepEqual([f.same, f.bidClseDt, f.dates, f.method.cntrctCnclsMthdNm], [1, null, { bidNtceDt: NODL.bidNtceDt, opengDt: NODL.opengDt, rgstDt: NODL.rgstDt }, '협상에 의한 계약']);
  assert.ok(!JSON.stringify(d).includes('010-1234-5678') && !JSON.stringify(d).includes('test-key'));
  assert.ok(d.notFound.some((x) => x.startsWith('공사·공고번호')), JSON.stringify(d.notFound));
  assert.equal((await sql`select count(*)::int n from sales_src_rows where row->>'source_external_id' = ${`${NODL.bidNtceNo}-000`}`)[0].n, 0, '저장 안 함');
  assert.equal((await ctx.owner.ok('GET', `/api/platform/sales-notices?g2b=dates&no=${encodeURIComponent('../x')}`)).g2bDates, undefined);
  assert.equal((await ctx.staffA.client.req('GET', `/api/platform/sales-notices?g2b=dates&no=${NODL.bidNtceNo}`)).status, 404, '플랫폼 운영자만');
});

test('259차 입찰 마감이 없는 나라장터 공고: 공동수급협정 마감을 임시 마감(agreement) · 공고문 마감(doc)은 다음 수집이 안 덮음 · API 에 입찰 마감이 오면 그것으로 · g2b=nodl 수', async () => {
  const a = await rowOf(AGR.bidNtceNo);
  assert.deepEqual([a.deadline_at, a.deadline_src, a.agreement_close_at, a.opening_at], [`${plus(7)}T18:00:00+09:00`, 'agreement', `${plus(7)}T18:00:00+09:00`, `${plus(8)}T17:00:00+09:00`]);
  const fit = await rowOf(FIT.bidNtceNo);
  assert.deepEqual([fit.deadline_src ?? null, fit.agreement_close_at ?? null], [null, null], '입찰 마감이 있는 공고는 칸을 더하지 않음');
  await sql`update sales_src_rows set row = row || ${sql.json({ deadline_at: `${plus(5)}T18:00:00+09:00`, deadline_src: 'doc' })}::jsonb where row->>'source_external_id' = ${`${AGR.bidNtceNo}-000`}`;
  await ctx.owner.ok('POST', '/api/sales/collectors/g2b_bid_notices/run', {});
  const b = await rowOf(AGR.bidNtceNo);
  assert.deepEqual([b.deadline_at, b.deadline_src], [`${plus(5)}T18:00:00+09:00`, 'doc'], '공고문에서 읽은 마감은 임시 마감으로 되돌리지 않음');
  AGR.bidClseDt = `${plus(6)} 10:00:00`;
  await ctx.owner.ok('POST', '/api/sales/collectors/g2b_bid_notices/run', {});
  const c = await rowOf(AGR.bidNtceNo);
  assert.deepEqual([c.deadline_at, c.deadline_src], [`${plus(6)}T10:00:00+09:00`, null], 'API 에 진짜 입찰 마감이 오면 그것으로');
  AGR.bidClseDt = '';
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', '00000000-0000-4000-8000-000000259001',
    ${sql.json({ id: '00000000-0000-4000-8000-000000259001', source_type: 'g2b_bid', source_external_id: 'R26BK0259001-000', title: '(협상)시험 파크골프장 기본계획 용역', related: true, posted_date: today, deadline_at: `${plus(7)}T18:00:00+09:00`, deadline_src: 'agreement' })}, 'workin')`;
  const n = (await ctx.owner.ok('GET', '/api/platform/sales-notices?g2b=nodl')).g2bNoDeadline;
  assert.ok(n.count >= 1 && n.agreement >= 1 && n.items.some((x) => x.ext === 'R26BK0259001-000'), JSON.stringify(n));
  assert.equal((await ctx.staffA.client.req('GET', '/api/platform/sales-notices?g2b=nodl')).status, 404);
});
