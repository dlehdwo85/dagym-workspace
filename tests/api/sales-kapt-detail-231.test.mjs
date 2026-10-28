// 231차(로컬 10/28 11:45 '참여업체 정보' 제안 · 13:55 '낙찰 분석 낙찰률·참가 수가 대부분 빔'): K-apt 입찰 상세 → 참여업체(이름·사업자번호·응찰금액·낙찰 여부·무효)·참가 수 ·
// 낙찰업체 사업자번호 · 사유(유찰이면 상태 '유찰') · 대표자·전화·연락처·주소 칸은 저장 안 함 · 안 읽은 것부터, 결과 미상은 3일 뒤 다시 · 낙찰 분석 '우리 회사 참여·진 입찰·1위와 금액 차'
// (구조 시험 — 가짜 K-apt 화면은 10/28 실제 상세 화면의 표 머리·순서를 따름. 실제 K-apt 연동은 운영에서 확인)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { fakeKapt } from '../fakeKapt.mjs';

const PORT = 3262;
const plus = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
const tbl = (title, heads, rows) => `<table class="contTbl txtC"><thead><tr><th colspan="${heads.length}">${title}</th></tr><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const reason = (t) => `<table class="contTbl txtC"><tbody><tr><th>낙찰/유찰/취소 사유</th></tr><tr><td>${t}</td></tr></tbody></table>`;
const HEADS = ['순번', '응찰회사', '사업자등록번호', '대표자', '전화', '응찰일시', '현장설명<br>참석여부', '입찰구비서류<br>적정여부', '응찰금액', '낙찰<br>여부', '낙찰<br>무효'];
// 234차(로컬 10/28 16:20 힐스테이트관악센트씨엘): 적격심사 입찰은 응찰금액 다음에 '평가점수' 칸
const HEADS_SCORE = ['순번', '응찰회사', '사업자등록번호', '대표자', '전화', '응찰일시', '현장설명<br>참석여부', '입찰구비서류<br>적정여부', '응찰금액', '평가점수', '낙찰<br>여부', '낙찰<br>무효'];
const PRIVATE = ['홍시험', '010-1234-5678', '김시험', '02-000-0000', '시험구 시험로 1'];
const DETAIL = {
  '20261028000001': tbl('참여업체 정보', HEADS_SCORE, [
    ['1', '(주)우리시험', '123-45-67890', '홍시험', '010-1234-5678', '2026-10-27 10:00', 'Y', 'Y', '300,000,000원', '95.04', 'N', ''],
    ['2', '가나관리(주)', '222-22-22222', '홍시험', '010-1234-5678', '2026-10-27 10:01', 'Y', 'Y', '280,000,000원', '97.71', 'Y', ''],
    ['3', '다라(주)', '3333333333', '홍시험', '010-1234-5678', '2026-10-27 10:02', 'Y', 'N', '310,000,000원', '99.5', 'N', 'Y']]) + reason('적격심사 낙찰'),
  kg2b_900001: tbl('낙찰업체 정보', ['회사명', '사업자등록번호', '회사주소', '연락처', '대표명', '계약금액<br>(VAT 별도)', '계약선정방법'],
    [['마바서비스(주)', '4444444444', '서울 시험구 시험로 1', '02-000-0000', '김시험', '10,040,000원', '경쟁입찰']]) + reason('최고가 낙찰&nbsp;'),
  '20261028000003': reason('유찰 - 응찰업체 부족(1개 업체)'),
  '20261028000004': '', // 아직 결과 없음
};
const kapt = fakeKapt({ detailHtml: (bid) => DETAIL[bid] ?? '' });
let srv, ctx, sql, fake;
const ROWS = [
  ['20261028000001', '[경기] 시험일아파트 헬스장 위탁운영 사업자 선정', { winner_name: '가나관리(주)', winner_amount: '280,000,000', award_date: plus(-1), current_status: '낙찰', deadline_at: `${plus(-2)}T10:00:00+09:00` }],
  ['kg2b_900001', '[서울] 시험이아파트 커뮤니티 시설 위탁운영 선정', { winner_name: '마바서비스(주)', award_date: plus(-1), current_status: '낙찰', deadline_at: `${plus(-3)}T10:00:00+09:00` }],
  ['20261028000003', '[인천] 시험삼아파트 피트니스센터 위탁운영', { current_status: '마감', deadline_at: `${plus(-5)}T10:00:00+09:00` }],
  ['20261028000004', '[부산] 시험사아파트 골프연습장 위탁운영', { current_status: '마감', deadline_at: `${plus(-2)}T10:00:00+09:00` }],
  ['20261028000005', '[대구] 시험오아파트 승강기 교체 공사', { current_status: '마감', deadline_at: `${plus(-2)}T10:00:00+09:00`, related: false, fit_business: null }],
];
const rowOf = async (ext) => (await sql`select row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_external_id' = ${ext}`)[0].row;
const detailCalls = (ext) => kapt.calls.filter((c) => c.path === '/kapt/bid/bidDetail.do' && (!ext || c.q.bidNum === ext)).length;

before(async () => {
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const send = (code, text, type = 'text/html; charset=utf-8') => { res.statusCode = code; res.setHeader('content-type', type); res.end(text); };
    if (u.pathname === '/kapt/bid/bidResultList.do') return send(200, '<html><input name="_csrf" value="csrf-231"></html>');
    if (u.pathname === '/kapt/bid/bidResultListAjax.do') return send(200, '[]', 'application/json');
    if (kapt.handle(req, res, body)) return;
    send(404, 'nope');
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}` }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`insert into company_profiles (tenant, key, name, biz_no, is_default) values ('default', 'kapt231', '(주)우리시험', '123-45-67890', false)`;
  for (const [ext, title, o] of ROWS) {
    const id = randomUUID();
    await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${id}, ${sql.json({ id, source_type: 'kapt_bid', source_external_id: ext,
      source_url: `http://localhost:${PORT}/kapt/bid/bidDetail.do?bidNum=${ext}`, title, issuer: '시험 단지', related: true, fit_business: '다짐', notice_kind: 'new', first_seen_at: new Date(Date.now() - 6 * 864e5).toISOString(), ...o })}, 'workin')`;
  }
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('상세 읽기: 참여업체(대표자·전화 빼고)·참가 수·낙찰업체 사업자번호 · 다른 사이트 건은 낙찰업체 정보 · 유찰 사유 → 유찰 · 결과 없으면 그대로 · 관련 아닌 공고는 안 읽음', async () => {
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_results/run', {});
  assert.match(r.summary, /상세 4건\(참여업체 표 1 · 유찰 1 · 고침 4\)/, r.summary);
  const a = await rowOf('20261028000001');
  assert.deepEqual(a.participants, [
    { name: '(주)우리시험', bizNo: '1234567890', amount: 300000000, won: false, invalid: false, score: 95.04, site: true, docs: true },
    { name: '가나관리(주)', bizNo: '2222222222', amount: 280000000, won: true, invalid: false, score: 97.71, site: true, docs: true },
    { name: '다라(주)', bizNo: '3333333333', amount: 310000000, won: false, invalid: true, score: 99.5, site: true, docs: false }], '237차: 현장설명 참석·서류 적정도');
  assert.deepEqual([a.bidders, a.winner_biz_no, a.winner_amount, a.result_note, a.current_status], [3, '2222222222', 280000000, '적격심사 낙찰', '낙찰']);
  const b = await rowOf('kg2b_900001');
  assert.deepEqual([b.winner_name, b.winner_biz_no, b.winner_amount, b.result_note, b.participants ?? null], ['마바서비스(주)', '4444444444', 10040000, '최고가 낙찰', null]);
  const c = await rowOf('20261028000003');
  assert.deepEqual([c.current_status, c.result_note, !!c.result_at], ['유찰', '유찰 - 응찰업체 부족(1개 업체)', true], '유찰 사유 → 상태 유찰 · 결과를 처음 안 때');
  const d = await rowOf('20261028000004');
  assert.deepEqual([d.current_status, d.result_note ?? null, !!d.kapt_detail_at], ['마감', null, true], '결과가 아직 없으면 상태 그대로(진행중으로 바뀌지 않음)');
  assert.equal((await rowOf('20261028000005')).kapt_detail_at ?? null, null, '관련 아닌 공고는 안 읽음');
  const all = JSON.stringify(await sql`select row from sales_src_rows where tbl = 'procurement_notices'`);
  for (const w of PRIVATE) assert.ok(!all.includes(w), `대표자·전화·연락처·주소는 저장 안 함: ${w}`);
});

test('다시 돌리면 읽은 것은 안 읽음 · 결과 없는 공고는 3일 뒤 다시', async () => {
  const before0 = detailCalls();
  await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_results/run', {});
  assert.equal(detailCalls(), before0, '낙찰·유찰·방금 읽은 공고는 다시 안 읽음');
  const d = await sql`select src_id, row from sales_src_rows where row->>'source_external_id' = '20261028000004'`;
  await sql`update sales_src_rows set row = ${sql.json({ ...d[0].row, kapt_detail_at: new Date(Date.now() - 4 * 864e5).toISOString() })} where src_id = ${d[0].src_id}`;
  await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_results/run', {});
  assert.deepEqual([detailCalls() - before0, detailCalls('20261028000004') >= 2], [1, true], '결과 미상 공고만 다시');
  // 234차: 231차 판(점수 칸 안 읽음)으로 참여업체 표를 읽은 줄은 한 번 더 — 점수가 채워짐 · 그 뒤로는 다시 안 읽음
  const a0 = await rowOf('20261028000001');
  const old = { ...a0, participants: a0.participants.map(({ score: _s, ...x }) => x) }; delete old.kapt_detail_v;
  await sql`update sales_src_rows set row = ${sql.json(old)} where row->>'source_external_id' = '20261028000001'`;
  const before1 = detailCalls('20261028000001');
  await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_results/run', {});
  const a1 = await rowOf('20261028000001');
  assert.deepEqual([detailCalls('20261028000001') - before1, a1.kapt_detail_v, a1.participants.map((x) => x.score)], [1, 3, [95.04, 97.71, 99.5]], '237차부터 판 3');
  await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_results/run', {});
  assert.equal(detailCalls('20261028000001') - before1, 1, '새 판으로 읽은 뒤에는 다시 안 읽음');
});

test('낙찰 분석: 우리 회사 참여 · 진 입찰(1위·금액 차·참가 수) · 유찰 셈 · 참가 수 평균', async () => {
  const s = await ctx.owner.ok('GET', '/api/sales/award-stats?days=30');
  assert.deepEqual([s.participated, s.lostCount], [1, 1], JSON.stringify({ ...s, items: undefined }));
  assert.deepEqual([s.lost[0].title, s.lost[0].our, s.lost[0].winner, s.lost[0].winnerAmount, s.lost[0].gap, s.lost[0].bidders], ['[경기] 시험일아파트 헬스장 위탁운영 사업자 선정', 300000000, '가나관리(주)', 280000000, 20000000, 3]);
  assert.deepEqual(s.lost[0].score, { top: 97.71, our: 95.04, gap: 2.67, rank: 2, of: 2 }, '234차 적격심사 점수 — 1위(낙찰) 97.71 · 우리 95.04 · 2.67점 · 무효 업체(99.5)는 순위에서 뺌');
  assert.ok(s.failed >= 1, '유찰 1건');
  assert.equal(s.items.find((x) => x.name === '가나관리(주)')?.bidders, 3);
});
