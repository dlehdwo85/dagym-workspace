// V41 단계 3(V40): 영업 공공데이터 — 카탈로그 36·AI 자동 세팅(규칙표 대체)·[이대로 켜기]·공통 수집기(가짜 data.go.kr)·지역 필터·출처 표시·회사별 진행 상태·권한
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const PORT = 3217;
let srv, ctx, sql, fake, hits = [];
before(async () => {
  fake = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'); hits.push(Object.fromEntries(u.searchParams));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: { item: [
      { MNG_NO: 'A1', BPLC_NM: '깨끗한 빌딩관리', ROAD_NM_ADDR: '경기도 성남시 분당구 판교로 1', SALS_STTS_NM: '영업/정상', LCPMT_YMD: '20261010' },
      { MNG_NO: 'A2', BPLC_NM: '서울 청소대행', ROAD_NM_ADDR: '서울특별시 강남구 테헤란로 2', SALS_STTS_NM: '영업/정상', LCPMT_YMD: '20261001' },
    ] }, totalCount: 2 } } }));
  }).listen(PORT);
  await resetDb(); srv = await startServer({ DATA_GO_KR_SERVICE_KEY: 'test-key' }); sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('카탈로그·자동 세팅·수집·영업기회', async () => {
  assert.equal((await ctx.owner.get('/api/sales/sources')).status, 404, '영업 공간 꺼짐');
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const cat = await ctx.owner.ok('GET', '/api/sales/sources');
  assert.equal(cat.sources.length, 36); assert.ok(cat.canEdit);
  const sug = await ctx.owner.ok('POST', '/api/sales/sources/suggest', { industry: '서비스업 / 건물청소·시설관리', region: '경기도' });
  assert.ok(sug.rules.includes('건물청소·시설관리·경비'), JSON.stringify(sug));
  assert.ok(sug.sources.includes('15154949') && sug.sources.includes('15081808'), '업종 원천 + 공통');
  assert.deepEqual(sug.regions, ['경기']);
  // 로컬 10/19(대표): 추천마다 근거 한 줄·체크로 고름, 입찰·공고도 선택 추천
  assert.ok(sug.items.length === sug.sources.length && sug.items.every((x) => x.name && x.why), '근거 한 줄');
  assert.match(sug.items.find((x) => x.code === '15081808').why, /모든 업종 공통/);
  assert.equal(sug.bids.recommend, true, '시설관리는 입찰 추천');
  const apt = await ctx.owner.ok('POST', '/api/sales/sources/suggest', { industry: '아파트 커뮤니티 운영', product: '커뮤니티 시설 위탁' });
  assert.ok(['15057332', '15098547'].every((c) => apt.sources.includes(c)), '아파트 = 공동주택 단지·입주 예정');
  assert.match(apt.items.find((x) => x.code === '15098547').why, /입주 예정/);
  const itr = await ctx.owner.ok('POST', '/api/sales/sources/suggest', { industry: '인테리어' });
  assert.ok(itr.sources.includes('15098547') && itr.bids.recommend === false, '인테리어 = 신규 분양·준공, 입찰은 꺼 두기 권장');
  // 처음 켠 회사: 영업 현황에 출처 고르기 안내(관리자) — 고르고 켜면 사라짐
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=summary')).setupNeeded, true);
  // 목록 밖 출처 직접 추가(사이트·키워드·엑셀) — 관리자만
  assert.equal((await ctx.owner.req('POST', '/api/sales/sources/custom', { kind: 'site', label: '지역 카페', value: 'ftp://x' })).status, 400);
  const cs = await ctx.owner.ok('POST', '/api/sales/sources/custom', { kind: 'site', label: '지역 상가 카페', value: 'https://cafe.example.com' });
  await ctx.owner.ok('POST', '/api/sales/sources/custom', { kind: 'keyword', label: '신규 오피스', value: '입주 예정 오피스' });
  assert.deepEqual((await ctx.owner.ok('GET', '/api/sales/sources')).custom.map((c) => c.kind), ['site', 'keyword']);
  // 직원: 영업 공간 미배정 404 · 배정돼도 세팅 403
  assert.equal((await ctx.staffA.client.get('/api/sales/sources')).status, 404);
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  assert.equal((await ctx.staffA.client.req('POST', '/api/sales/sources/apply', { sources: sug.sources, keywords: [], regions: [] })).status, 403);
  assert.equal((await ctx.staffA.client.req('POST', '/api/sales/sources/custom', { kind: 'keyword', label: 'x' })).status, 403, '직원은 출처 추가 못 함');
  assert.equal((await ctx.staffA.client.req('DELETE', `/api/sales/sources/custom/${cs.id}`)).status, 403);
  await ctx.owner.ok('DELETE', `/api/sales/sources/custom/${cs.id}`);
  assert.equal((await ctx.owner.ok('GET', '/api/sales/sources')).custom.length, 1);
  // 체크로 고른 것만 켬 + 입찰 끄기 선택
  const chosen = sug.sources.filter((c) => c !== '15154982');
  await ctx.owner.ok('POST', '/api/sales/sources/apply', { sources: chosen, keywords: sug.keywords, regions: sug.regions, bids: false });
  assert.equal((await sql`select 1 from tenant_data_sources where tenant = 'default' and source_code = '15154982' and enabled`).length, 0, '체크 해제한 출처는 안 켬');
  assert.equal((await ctx.owner.ok('GET', '/api/sales/options')).bids, false, '입찰 선택 반영');
  await ctx.owner.ok('PUT', '/api/sales/options', { bids: null });
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=summary')).setupNeeded, false);
  assert.ok((await sql`select 1 from tenant_data_sources where tenant = 'default' and source_code = '15154949' and enabled and regions = '{경기}'`).length);
  assert.ok(sug.keywords.includes('청소용역'), '규칙표 검색어');
  assert.deepEqual((await ctx.owner.ok('GET', '/api/sales/sources')).sources.find((s) => s.code === '15154949').keywords, sug.keywords, '켠 원천 목록에 검색어');
  const sp = await ctx.owner.ok('POST', '/api/sales/sources/suggest', { industry: '서비스업 / 체육시설 위탁운영' });
  assert.ok(['체육시설 위탁', '커뮤니티', '피트니스'].every((k) => sp.keywords.includes(k)), JSON.stringify(sp.keywords));
  // 공통 수집기: 플랫폼 운영자가 주소를 맞추고 수동 실행 → 공용 표에 2건
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  await sql`update data_sources set endpoint = ${'http://localhost:' + PORT + '/permit'} where code = '15154949'`;
  const run = await ctx.owner.ok('POST', '/api/platform/sales-sources', { code: '15154949', run: true, maxPages: 1 });
  assert.equal(run.count, 2, JSON.stringify(run)); assert.equal(hits.at(-1).serviceKey, 'test-key'); assert.equal(hits.at(-1).type, 'json');
  // 영업기회: 지역(경기) 필터로 1건, 출처 표시
  const list = (await ctx.staffA.client.ok('GET', '/api/sales/prospects')).prospects;
  assert.deepEqual(list.map((p) => p.name), ['깨끗한 빌딩관리']);
  assert.equal(list[0].sido, '경기'); assert.equal(list[0].opened_on, '2026-10-10');
  assert.match(list[0].attribution, /출처: 행정안전부, 공공데이터포털/);
  // 진행 상태는 회사별 — 제외하면 기본 목록에서 빠지고 '제외' 탭에 보임
  await ctx.staffA.client.ok('PATCH', `/api/sales/prospects/${list[0].id}`, { status: 'skip', memo: '이미 거래처' });
  assert.equal((await ctx.staffA.client.ok('GET', '/api/sales/prospects')).prospects.length, 0);
  assert.equal((await ctx.staffA.client.ok('GET', '/api/sales/prospects?status=skip')).prospects[0].memo, '이미 거래처');
  // 회사가 안 켠 원천의 영업기회는 고칠 수 없음(404)
  const [other] = await sql`select id from prospects where name = '서울 청소대행'`;
  await sql`update tenant_data_sources set enabled = false where source_code = '15154949'`;
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/sales/prospects/${other.id}`, { status: 'lead' })).status, 404);
  // 플랫폼 운영자가 아니면 수집 설정 404
  assert.equal((await ctx.staffA.client.get('/api/platform/sales-sources')).status, 404);
});
