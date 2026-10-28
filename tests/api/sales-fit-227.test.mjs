// 227차(로컬 10/28 판정 빈 곳 3건 · 191차 규칙 보강): ①② '국회도서관 정보기기·보안관제 위탁운영' — 시설 낱말이 약한 '도서관'뿐이고 아파트·주민 맥락이 없음 → 다짐 아님
// ③ '파크골프장시설물조성(세굴방지공)' — 제목에 '공사'가 없는 공사(업무 구분 공사·'조성') → 다짐 아님 · 다시 판정이 저장된 다짐을 내림 · 진짜 운영 공고(작은도서관·파크골프장 위탁운영)는 그대로
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const plus = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
const ago = (d) => new Date(Date.now() - d * 864e5).toISOString();
let srv, ctx, sql;
const R = {};
const put = async (ext, title, o = {}) => {
  const id = randomUUID();
  const row = { id, source_type: 'g2b_bid', source_external_id: ext, source_url: `https://www.g2b.go.kr/link/${ext}`, title, issuer: '시험 기관', bid_category: '용역', current_status: '진행중', notice_kind: 'new',
    posted_date: plus(-2), deadline_at: `${plus(5)}T17:00:00+09:00`, first_seen_at: ago(2), related: true, fit_business: '다짐', matched_keywords: [], classification: '즉시 검토', ...o };
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${id}, ${sql.json(row)}, 'workin')`; return id;
};
const rowOf = async (id) => (await sql`select row from sales_src_rows where src_id = ${id}`)[0].row;
before(async () => {
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: 'http://127.0.0.1:9' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  // 운영 당일 메일(10/28 08:11)에 다짐으로 나온 3건 — 저장된 판정 '다짐'
  R.lib = await put('R26BK01791097-000', '2027~2028년도 국회도서관 정보기기 위탁운영 사업', { matched_keywords: ['도서관', '위탁운영'] });
  R.sec = await put('R26BD00288066', '2027~2028년도 국회도서관 보안관제 위탁운영 사업', { source_type: 'g2b_prespec', notice_type: '사전규격', matched_keywords: ['도서관', '위탁운영'], classification: '검토' });
  R.golf = await put('R26BK01792413-000', '의성위천파크골프장시설물조성(세굴방지공)', { bid_category: '공사', notice_type: '공사', contract_method: '수의계약', matched_keywords: ['골프장'], classification: '검토' });
  // 그대로 남아야 하는 진짜 운영 공고
  R.small = await put('20261028100000001', '[경기] 시험아파트 작은도서관 위탁운영 업체 선정', { source_type: 'kapt_bid', bid_category: '사업자 - 용역 - 기타', matched_keywords: ['작은도서관', '위탁운영'] });
  R.park = await put('R26BK09999999-000', '시험군 파크골프장 위탁운영 사업자 모집', { matched_keywords: ['골프장', '위탁운영'] });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('지금 규칙(플랫폼 조회): 국회도서관 2건·파크골프장 조성 = 관련 아님(다짐 뺀 까닭) · 작은도서관·파크골프장 위탁운영 = 다짐', async () => {
  const now = async (no) => (await ctx.owner.ok('GET', `/api/platform/sales-notices?no=${no}`)).items[0].nowRule;
  for (const no of ['R26BK01791097-000', 'R26BD00288066']) {
    const r = await now(no);
    assert.equal(r.fit, null, no); assert.equal(r.dropped[0].business, '다짐'); assert.match(r.dropped[0].why, /시설 낱말이 '도서관'뿐이고 아파트·주민 맥락이 없음/);
  }
  const g = await now('R26BK01792413-000');
  assert.equal(g.fit, null); assert.match(g.dropped[0].why, /제목에 '조성' — 다짐은 운영·위탁만/);
  assert.equal((await now('20261028100000001')).fit, '다짐', '아파트 작은도서관 위탁운영은 그대로');
  assert.equal((await now('R26BK09999999-000')).fit, '다짐', '파크골프장 위탁운영은 그대로');
});

test('다시 판정: 저장된 다짐 3건을 관련 아님으로 내림(까닭 기록) · 운영 공고는 그대로 · 두 번 돌려도 그대로', async () => {
  const rf = await ctx.owner.ok('POST', '/api/platform/sales-notices', { refit: true });
  assert.deepEqual([rf.lowered, rf.changed, rf.raised], [3, 0, 0], JSON.stringify(rf));
  for (const [id, why] of [[R.lib, /도서관'뿐/], [R.sec, /도서관'뿐/], [R.golf, /'조성'/]]) {
    const r = await rowOf(id);
    assert.deepEqual([r.related, r.fit_business, r.classification], [false, null, '참고(비관련)'], r.title);
    assert.match(r.refit_lowered_why, why);
  }
  for (const id of [R.small, R.park]) { const r = await rowOf(id); assert.deepEqual([r.related, r.fit_business], [true, '다짐'], r.title); }
  const titles = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all')).items.map((i) => i.title);
  assert.ok(!titles.some((t) => /국회도서관|파크골프장시설물조성/.test(t)), JSON.stringify(titles));
  assert.ok(titles.includes('시험군 파크골프장 위탁운영 사업자 모집'));
  const again = await ctx.owner.ok('POST', '/api/platform/sales-notices', { refit: true });
  assert.deepEqual([again.lowered, again.changed, again.raised], [0, 0, 0]);
});
