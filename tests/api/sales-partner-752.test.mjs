// #752(로컬 10/28 17:25 · 대표 '하이링크는 보통 수의계약, 공개 입찰은 면허를 가진 업체와 협력을 준비하는 단계' — 191차 물음의 답):
// 하이링크 장비 교체·설치 공사 공고(로비폰·출입통제)는 빼지 않고 '면허 업체 협력 필요' 표시로 검토에 — 입찰 목록 배지·분류, 당일 메일 검토 구역·배지, 공고 조회
// 발주 기관 이름의 '공사'(한국토지주택공사 등)는 공사가 아님 · 다짐이 함께 맞은 공고(운영·위탁)는 그대로
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date());
const plus = (n) => kst(new Date(Date.parse(`${today}T12:00:00+09:00`) + n * 864e5));
const ID = (n) => `00000000-0000-4000-8000-000000752${String(n).padStart(3, '0')}`;
const now = new Date().toISOString();
const R = {
  1: { title: '[경기] 시험일아파트 세대 로비폰·출입통제장치 교체 공사', bid_category: '사업자 - 공사 - 장기수선', fit_business: '하이링크', matched_keywords: ['로비폰', '출입통제'] },
  2: { title: '[서울] 시험이아파트 출입통제 시스템 유지보수 용역', bid_category: '사업자 - 용역 - 기타 용역', fit_business: '하이링크', matched_keywords: ['출입통제'] },
  3: { title: '[한국토지주택공사] 시험삼단지 출입통제시스템 구매', bid_category: '물품', fit_business: '하이링크', matched_keywords: ['출입통제'] },
  4: { title: '[경기] 시험사아파트 커뮤니티 위탁운영 및 출입통제 설치 공사', bid_category: '사업자 - 용역 - 주민운동시설의 위탁', fit_business: '다짐·하이링크', matched_keywords: ['커뮤니티', '위탁운영', '출입통제'] },
  5: { title: '[경기] 시험오아파트 공동현관 출입카드리더기 설치', bid_category: '사업자 - 물품 - 기타', fit_business: '하이링크', matched_keywords: ['카드리더'], industry_code: '정보통신공사업' },
};
let srv, ctx, sql, P;

before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: now, daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await sql`insert into sales_digests (tenant, day, items, counts, mailed, notified, created_at) values ('default', ${plus(-1)}, '[]', '{}', 1, 1, ${new Date(`${plus(-1)}T08:00:00+09:00`)})`;
  for (const [n, o] of Object.entries(R)) await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${ID(n)}, ${sql.json({ id: ID(n), source_type: 'kapt_bid',
    source_external_id: `E2E752${n}`, source_url: `https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=E2E752${n}`, issuer: `시험${n}아파트`, related: true, classification: '즉시 검토', current_status: '진행중', notice_kind: 'new',
    deadline_at: `${plus(7)}T17:00:00+09:00`, posted_date: today, first_seen_at: now, updated_at: now, ...o })}, 'workin')`;
  P = await import('../../src/lib/sales/collectors/procurement.ts'); // 순수 함수(외부 import 없음) — Node 22 형식 제거로 .ts 직접
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('규칙: 하이링크 + 공사(제목·업무 구분·업종 제한) = 면허 업체 협력 필요 · 기관 이름 공사·다짐 함께·공사 아닌 하이링크는 아님 · 처음 분류는 즉시 검토가 아니라 검토(중장기)', () => {
  assert.deepEqual(Object.entries(R).map(([n, o]) => [n, P.partnerNeed(o)]), [['1', '면허 업체 협력 필요'], ['2', null], ['3', null], ['4', null], ['5', '면허 업체 협력 필요']]);
  assert.equal(P.partnerNeed({ fit_business: '하이링크', title: '[서울] 시험아파트 출입통제장치 설치 공사' }), '면허 업체 협력 필요');
  assert.equal(P.partnerNeed({ fit_business: '하이링크', title: '[인천도시공사] 시험단지 무인 키오스크 구매' }), null, '기관 이름의 공사');
  assert.equal(P.partnerNeed({ fit_business: '다짐', title: '[경기] 시험아파트 헬스장 위탁운영 (공사 없음)' }), null);
  assert.equal(P.initialClassification({ ...R[1], source_type: 'kapt_bid' }), '중장기 영업리드', '출입·로비폰 공사도 ★즉시 검토로 올리지 않음');
  assert.equal(P.initialClassification({ ...R[2], source_type: 'kapt_bid' }), '즉시 검토', '공사가 아닌 출입통제 용역은 그대로 즉시 검토');
  // 수집기가 분류를 올리는 길(중장기 → 즉시 검토)도 막힘
  const plan = P.planNoticeBatch([{ source_type: 'kapt_bid', source_external_id: 'E2E7521', title: R[1].title, bid_category: R[1].bid_category, deadline_at: `${plus(7)}T17:00:00+09:00`, source_url: 'https://www.k-apt.go.kr/x' }],
    new Map([['E2E7521', { id: ID(1), source_external_id: 'E2E7521', classification: '중장기 영업리드', fit_business: '하이링크', title: R[1].title, bid_category: R[1].bid_category }]]), new Date());
  assert.equal(plan.invalid, 0); assert.equal(plan.updates.length + plan.unchangedIds.length, 1);
  assert.ok(!plan.updates.some((u) => u.patch.classification === '즉시 검토'), JSON.stringify(plan.updates));
});

test("입찰 목록: 공사 공고에 '면허 업체 협력 필요' 배지 · 규칙이 붙인 즉시 검토는 검토(중장기)로 보임 · 나머지는 그대로(빠지지 않음)", async () => {
  const items = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all')).items;
  const by = Object.fromEntries(items.filter((x) => String(x.noticeNo ?? '').startsWith('E2E752')).map((x) => [x.noticeNo.slice(-1), x]));
  assert.deepEqual(Object.keys(by).sort(), ['1', '2', '3', '4', '5'], '하나도 빠지지 않음');
  assert.deepEqual(['1', '2', '3', '4', '5'].map((n) => [n, by[n].partner, by[n].classification]),
    [['1', '면허 업체 협력 필요', '중장기 영업리드'], ['2', null, '즉시 검토'], ['3', null, '즉시 검토'], ['4', null, '즉시 검토'], ['5', '면허 업체 협력 필요', '중장기 영업리드']]);
});

test("당일 메일: 면허 업체 협력 필요 공고는 ★즉시 검토가 아니라 검토 구역 + 배지 · 메일 글에도 · 공고 조회에 partner", async () => {
  const d = await ctx.owner.ok('GET', '/api/sales/digest');
  const by = Object.fromEntries(d.items.filter((x) => String(x.noticeNo ?? '').startsWith('E2E752')).map((x) => [x.noticeNo.slice(-1), x]));
  assert.deepEqual(['1', '2', '5'].map((n) => [n, by[n]?.section, by[n]?.badges.includes('면허 업체 협력 필요')]), [['1', 'review', true], ['2', 'now', false], ['5', 'review', true]], JSON.stringify(d.items.map((x) => [x.noticeNo, x.section])));
  const html = (await ctx.owner.req('GET', '/api/sales/digest?preview=html')).body;
  assert.ok(html.includes('면허 업체 협력 필요'));
  const it = (await ctx.owner.ok('GET', '/api/platform/sales-notices?no=E2E7521')).items[0];
  assert.equal(it.partner, '면허 업체 협력 필요');
});
