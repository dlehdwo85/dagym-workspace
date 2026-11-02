// 339차(대표 11/02 19:4x #924 '영업기회 허브 지역별로 구분'): 입찰 보기 ?region=시·도 필터 + regions 건수(원천 지역이 비면 참가가능지역·발주처·수요기관·주소·제목에서 시·도, 못 찾으면 '지역 미정') ·
// 허브 건물·시설 sidos 건수 + 지역 필터가 '전라북도 전주시' 도 '전북' 으로 걸림 · 지역별 보기 matrix = 지역 × 리드·진행 중 공고·건물·시설
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday(); const due = `${addDays(today, 14)}T17:00`;
const put = (tbl, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', ${tbl}, ${String(row.id)}, ${sql.json(row)})`;
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await put('procurement_notices', { id: 'R1', title: '체육시설 위탁운영', issuer: '수원시체육회', region: '경기', related: true, first_seen_at: today, deadline_at: due });
  await put('procurement_notices', { id: 'R2', title: '수영장 위탁 용역', issuer: '성남시청', region: '-', related: true, first_seen_at: today, deadline_at: due });
  await put('procurement_notices', { id: 'R3', title: '[서울] 구민체육센터 위탁', issuer: '시험구시설관리공단', related: true, first_seen_at: today, deadline_at: due });
  await put('procurement_notices', { id: 'R4', title: '수영구역 안전시설 보수 용역', issuer: '한국시험공사', related: true, first_seen_at: today, deadline_at: due });
  // 340차(로컬 11/02 후속: 지역 미정 19%): 시·군 뒤에 글자가 이어지는 기관 이름 · 광역시 구 이름 · 큰 시의 구 이름
  await put('procurement_notices', { id: 'R5', title: '국민체육센터 무인 키오스크 구매', issuer: '김해시영운국민체육센터', related: true, first_seen_at: today, deadline_at: due });
  await put('procurement_notices', { id: 'R6', title: '구민운동장 위탁', issuer: '해운대구청', related: true, first_seen_at: today, deadline_at: due });
  await put('procurement_notices', { id: 'R7', title: '체육공원 위탁', issuer: '한국시험공단', demand_agency: '성남시 분당구청', related: true, first_seen_at: today, deadline_at: due });
  // 341차(로컬 11/02 340차 운영 확인: 남은 지역 미정 10건의 발주처 꼴): 시·도+기관 · 도시+기관 · 법인 접두 · 대학 사전 · 부처 지방청 · 제목의 도시+골프장 · 보통 낱말(예산·부산물·경기장)은 그대로 미정
  await put('procurement_notices', { id: 'R8', title: '주민공동시설 현황조사 및 운영기준 검토 용역', issuer: '경기주택도시공사', related: true, first_seen_at: today, deadline_at: due });
  await put('procurement_notices', { id: 'R9', title: '영운국민체육센터 무인BF 키오스크 구매', issuer: '청주도시공사', related: true, first_seen_at: today, deadline_at: due });
  await put('procurement_notices', { id: 'R10', title: '여수국가산업단지 AX실증산단 플랫폼 개발용역', issuer: '재단법인전남테크노파크', related: true, first_seen_at: today, deadline_at: due });
  await put('procurement_notices', { id: 'R11', title: '자동청력검사 키오스크 임차', issuer: '연세대학교 미래의료산학협력단', related: true, first_seen_at: today, deadline_at: due });
  await put('procurement_notices', { id: 'R12', title: '항만출입관리시스템 위탁운영', issuer: '해양수산부 부산지방해양수산청', related: true, first_seen_at: today, deadline_at: due });
  await put('procurement_notices', { id: 'R13', title: '공무원연금공단 천안상록골프장 프로샵 영업대행', issuer: '공무원연금공단', related: true, first_seen_at: today, deadline_at: due });
  await put('procurement_notices', { id: 'R14', title: '예산정보시스템 부산물 처리 경기장 안내판 구매', issuer: '한국시험공사', related: true, first_seen_at: today, deadline_at: due });
  // 342차(로컬 11/02 341차 운영 확인 ⓑ): 단지 발주 공고 — 발주처 '이촌동 현대아파트 리모델링주택조합' → K-apt 단지 목록에서 이촌동의 현대 → 서울 · 동 없는 '현대아파트' 는 서울·부산 둘 → 미정 · 단지 칸 이름이 유일하면 그 시도
  await put('kapt_complex_codes', { id: 'C1', code: 'C1', name: '현대아파트', sido: '서울특별시', sigungu: '용산구', dong: '이촌동' });
  await put('kapt_complex_codes', { id: 'C2', code: 'C2', name: '현대', sido: '부산광역시', sigungu: '수영구', dong: '광안동' });
  await put('kapt_complex_codes', { id: 'C3', code: 'C3', name: '시험타운 아파트', sido: '대전광역시', sigungu: '서구', dong: '둔산동' });
  await put('procurement_notices', { id: 'R15', title: '커뮤니티 프라이빗 시네마 구축 및 상영 위탁 운영업체 선정', issuer: '이촌동 현대아파트 리모델링주택조합', region_restriction: '공고서 참조', related: true, first_seen_at: today, deadline_at: due });
  await put('procurement_notices', { id: 'R16', title: '커뮤니티 운영 위탁', issuer: '현대아파트 입주자대표회의', related: true, first_seen_at: today, deadline_at: due });
  await put('procurement_notices', { id: 'R17', title: '피트니스 운영 위탁', issuer: '입주자대표회의', facility_name: '시험타운아파트', source_type: 'nuri_bid', related: true, first_seen_at: today, deadline_at: due });
  await put('building_sales_pipeline', { id: 'B1', name: '성남 새단지', households: 900, region: '경기도 성남시', first_seen_at: today });
  await put('building_sales_pipeline', { id: 'B2', name: '강남 새단지', households: 1200, address: '서울특별시 강남구 역삼동 1', first_seen_at: today });
  await put('building_sales_pipeline', { id: 'B3', name: '전주 새단지', households: 700, region: '전라북도 전주시', first_seen_at: today });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });
const bids = (p = '') => ctx.owner.ok('GET', `/api/sales/src?view=bids&tab=open${p ? `&${p}` : ''}`);
const ids = (r) => r.items.map((n) => n.id).sort();

test('입찰 보기: regions = 시·도별 건수(원천 지역 · 발주처 시·군 → 시도 · 제목 [서울] · 못 찾으면 지역 미정 맨 뒤) · ?region= 로 그 지역만 · 칩 수는 지역 조건 전', async () => {
  const r = await bids();
  assert.deepEqual(r.regions, [{ key: '경기', n: 4 }, { key: '서울', n: 3 }, { key: '부산', n: 2 }, { key: '경남', n: 1 }, { key: '대전', n: 1 }, { key: '전남', n: 1 }, { key: '충남', n: 1 }, { key: '충북', n: 1 }, { key: '지역 미정', n: 3 }]); assert.equal(r.region, null);
  const g = await bids('region=경기'); assert.equal(g.region, '경기'); assert.deepEqual(ids(g), ['R1', 'R2', 'R7', 'R8'], '경기주택도시공사 → 경기'); assert.deepEqual(g.regions, r.regions, '지역을 골라도 칩 수는 그대로');
  assert.deepEqual(ids(await bids('region=서울')), ['R11', 'R15', 'R3'], '연세대학교 → 서울 · 이촌동 현대아파트 → K-apt 단지 목록(이촌동) → 서울'); assert.deepEqual(ids(await bids(`region=${encodeURIComponent('지역 미정')}`)), ['R14', 'R16', 'R4'], "'수영구역'·'예산정보'·'부산물'·'경기장' 같은 보통 낱말은 지역으로 안 잡음 · 동 없는 '현대아파트' 는 서울·부산 둘이라 미정");
  assert.deepEqual(ids(await bids('region=대전')), ['R17'], '단지 칸 시험타운아파트 → K-apt 유일 → 대전');
  assert.deepEqual(ids(await bids('region=경남')), ['R5'], '김해시영운… → 경남'); assert.deepEqual(ids(await bids('region=부산')), ['R12', 'R6'], '해운대구청·부산지방해양수산청 → 부산');
  assert.deepEqual(ids(await bids('region=충북')), ['R9'], '청주도시공사 → 충북'); assert.deepEqual(ids(await bids('region=전남')), ['R10'], '재단법인전남테크노파크 → 전남'); assert.deepEqual(ids(await bids('region=충남')), ['R13'], '제목 천안상록골프장 → 충남');
  assert.deepEqual(ids(await bids('region=제주')), []);
});

test('허브 건물 탭: sidos 건수(지역 필터 전) · ?region=전북 이 "전라북도 전주시" 에 걸리고 ?region=서울 은 주소로 걸림', async () => {
  const all = await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=buildings');
  assert.deepEqual(all.sidos, [{ key: '경기', n: 1 }, { key: '서울', n: 1 }, { key: '전북', n: 1 }]); assert.equal(all.items.length, 3);
  const jb = await ctx.owner.ok('GET', `/api/sales/src?view=hub&tab=buildings&region=${encodeURIComponent('전북')}`); assert.deepEqual(jb.items.map((b) => b.id), ['B3']); assert.equal(jb.sidos.length, 3, '칩 수는 지역 조건 전');
  assert.deepEqual((await ctx.owner.ok('GET', `/api/sales/src?view=hub&tab=buildings&region=${encodeURIComponent('서울')}`)).items.map((b) => b.id), ['B2']);
});

test('지역별 보기: matrix = 지역 × 리드·진행 중 공고·건물·시설(합 0 은 빼고 많은 순, 지역 미정 맨 뒤) · 예전 regions(리드만)도 그대로', async () => {
  const r = await ctx.owner.ok('GET', '/api/sales/src?view=regions');
  assert.ok(Array.isArray(r.regions));
  const row = (k) => r.matrix.find((x) => x.region === k);
  assert.deepEqual(row('경기'), { region: '경기', leads: 0, bids: 4, buildings: 1, facilities: 0, total: 5 });
  assert.deepEqual(row('서울'), { region: '서울', leads: 0, bids: 3, buildings: 1, facilities: 0, total: 4 });
  assert.deepEqual(row('부산'), { region: '부산', leads: 0, bids: 2, buildings: 0, facilities: 0, total: 2 });
  assert.deepEqual(row('전북'), { region: '전북', leads: 0, bids: 0, buildings: 1, facilities: 0, total: 1 });
  assert.equal(r.matrix[r.matrix.length - 1].region, '지역 미정'); assert.equal(row('지역 미정').bids, 3);
  assert.equal(r.matrix[0].region, '경기');
});
