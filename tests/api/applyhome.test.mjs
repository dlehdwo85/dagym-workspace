// V41 단계 3: 청약홈 분양정보(15098547) 신규단지 수집기 — 세 종류(아파트·오피스텔 등·공공지원민간임대)·모집공고일 기간 조건·페이지·기간 다시 거름·
// 업종 중립 공용 표 + detail(세대·시행·시공·입주월·접수·계약)·회사가 켜야 보임·오류는 종류별로 남김
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const PORT = 3220;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const old = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() - 500 * 864e5));
let srv, ctx, sql, fake, hits = [];
const APT = Array.from({ length: 101 }, (_, n) => ({ HOUSE_MANAGE_NO: `H${n}`, PBLANC_NO: `P${n}`, HOUSE_NM: `판교 새단지 ${n}`, HOUSE_SECD_NM: 'APT', HOUSE_DTL_SECD_NM: '민영',
  HSSPLY_ADRES: '경기도 성남시 분당구 판교로 10', TOT_SUPLY_HSHLDCO: n === 0 ? 1200 : 300, RCRIT_PBLANC_DE: n === 100 ? old : today, RCEPT_BGNDE: today, RCEPT_ENDDE: today,
  MVN_PREARNGE_YM: '202903', BSNS_MBY_NM: '판교개발', CNSTRCT_ENTRPS_NM: '좋은건설', MDHS_TELNO: '1588-0000', PBLANC_URL: 'https://www.applyhome.co.kr/x' }));
before(async () => {
  fake = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); hits.push({ path: u.pathname, q: Object.fromEntries(u.searchParams) });
    res.setHeader('content-type', 'application/json');
    if (u.searchParams.get('serviceKey') !== 'test+key==' || req.headers.authorization !== 'Infuser test+key==') { res.statusCode = 401; return res.end(JSON.stringify({ code: -4, msg: '등록되지 않은 인증키' })); }
    const page = Number(u.searchParams.get('page'));
    if (u.pathname.endsWith('/getAPTLttotPblancDetail')) return res.end(JSON.stringify({ page, perPage: 100, matchCount: APT.length, data: APT.slice((page - 1) * 100, page * 100) }));
    if (u.pathname.endsWith('/getUrbtyOfctlLttotPblancDetail')) return res.end(JSON.stringify({ page, matchCount: 1, data: [{ HOUSE_MANAGE_NO: 'O1', PBLANC_NO: 'O1', HOUSE_NM: '강남 오피스텔', HOUSE_DTL_SECD_NM: '오피스텔', HSSPLY_ADRES: '서울특별시 강남구 테헤란로 5', TOT_SUPLY_HSHLDCO: 80, RCRIT_PBLANC_DE: today }] }));
    res.statusCode = 500; return res.end(JSON.stringify({ code: -1, msg: '시험용 오류' })); // 공공지원민간임대는 실패
  }).listen(PORT);
  await resetDb(); srv = await startServer({ DATA_GO_KR_SERVICE_KEY: 'test%2Bkey%3D%3D', /* 포털 Encoding 키를 넣은 경우 */ SALES_SRC_SERVICE_KEY: 'sb_secret_abcdefghijklmnop123' }); sql = testDb(); ctx = await bootstrap();
  await sql`update data_sources set endpoint = ${`http://localhost:${PORT}/api/ApplyhomeInfoDetailSvc/v1`} where code = '15098547'`;
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('처음 채우기 365일 → 공용 표·회사 필터·detail', async () => {
  assert.equal((await sql`select endpoint from data_sources where code = '15098547'`).length, 1);
  const r = await ctx.owner.ok('POST', '/api/platform/sales-sources', { code: '15098547', run: true, days: 365 });
  assert.equal(r.count, 101, JSON.stringify(r)); // 아파트 100(기간 밖 1건 제외) + 오피스텔 1
  assert.deepEqual(r.byKind, { apt: 100, urbty: 1, pblpvt: 0 });
  assert.match(r.error, /공공지원민간임대/, '실패한 종류만 오류로');
  const aptHits = hits.filter((h) => h.path.endsWith('/getAPTLttotPblancDetail'));
  assert.equal(aptHits.length, 2, '2페이지'); assert.ok(aptHits[0].q['cond[RCRIT_PBLANC_DE::GTE]'].match(/^\d{4}-\d{2}-\d{2}$/));
  const [p] = await sql`select name, sido, status, to_char(opened_on, 'YYYY-MM-DD') opened_on, category, detail from prospects where ext_id = 'apt:P0'`;
  assert.deepEqual([p.sido, p.status, p.opened_on, p.category], ['경기', '모집공고', today, '민영 · 1,200세대']);
  assert.deepEqual([p.detail.developer, p.detail.builder, p.detail.moveIn, p.detail.households], ['판교개발', '좋은건설', '2029-03-01', 1200]);
  // 다시 돌려도 중복 없음
  await ctx.owner.ok('POST', '/api/platform/sales-sources', { code: '15098547', run: true, days: 365 });
  assert.equal((await sql`select count(*)::int n from prospects where source_code = '15098547'`)[0].n, 101);
  // 회사가 켜야 보이고, 지역(서울)만 고르면 오피스텔 1건
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  assert.equal((await ctx.owner.ok('GET', '/api/sales/prospects')).prospects.length, 0, '안 켜면 없음');
  await ctx.owner.ok('PUT', '/api/sales/sources/15098547', { enabled: true, regions: ['서울'] });
  const list = (await ctx.owner.ok('GET', '/api/sales/prospects')).prospects;
  assert.deepEqual(list.map((x) => x.name), ['강남 오피스텔']);
  assert.equal(list[0].detail.households, 80);
});

test('영업관리 원본 키: 새 형식(sb_secret_) 인식, 값은 안 보임', async () => {
  const h = await (await fetch(`${BASE}/api/health`)).json();
  assert.equal(h.config.salesSrcKey, 'secret');
  assert.ok(!JSON.stringify(h).includes('sb_secret_abc'));
});

