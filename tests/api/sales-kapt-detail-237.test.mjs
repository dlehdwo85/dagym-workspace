// 237차(로컬 10/28 17:25 고척아이파크MD·금액 빈칸): K-apt 참여업체 표의 현장설명 참석·입찰구비서류 적정 칸은 잠긴 고르기(select disabled) — 글자로는 'Y N' 이 다 보여
// 선택된 값을 읽음 · 선택 표시가 없으면 모름 · 응찰금액이 '*' 로 가려졌거나 칸이 없으면(다른 입찰 사이트 건) 비공개 · 낙찰 분석: 우리 서류 N 이면 '평가 제외' 표시 · 서류 N 업체는 점수 순위에서 뺌
// (구조 시험 — 가짜 K-apt 화면. 실제 K-apt 화면 읽기는 운영에서 확인)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { fakeKapt } from '../fakeKapt.mjs';

const PORT = 3263;
const plus = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
const tbl = (title, heads, rows) => `<table class="contTbl txtC"><thead><tr><th colspan="${heads.length}">${title}</th></tr><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
// 잠긴 고르기 칸 — v 가 없으면 선택 표시 없음
const sel = (v) => `<select disabled="disabled" title="선택"><option value="Y"${v === 'Y' ? ' selected="selected"' : ''}>Y</option><option value="N"${v === 'N' ? ' selected="selected"' : ''}>N</option></select>`;
const HEADS = ['순번', '응찰회사', '사업자등록번호', '대표자', '전화', '응찰일시', '현장설명<br>참석여부', '입찰구비서류<br>적정여부', '응찰금액', '평가점수', '낙찰<br>여부', '낙찰<br>무효'];
const PRIVATE = ['홍시험', '010-1234-5678', '김시험', '02-000-0000'];
const DETAIL = {
  '20261028000011': tbl('참여업체 정보', HEADS, [
    ['1', '(주)우리시험', '123-45-67890', '홍시험', '010-1234-5678', '2026-10-27 10:00', sel('Y'), sel('N'), '**********', '0', 'N', ''],
    ['2', '가나관리(주)', '222-22-22222', '홍시험', '010-1234-5678', '2026-10-27 10:01', sel('Y'), sel('Y'), '280,000,000원', '93', 'Y', ''],
    ['3', '다라(주)', '3333333333', '홍시험', '010-1234-5678', '2026-10-27 10:02', sel(null), sel('Y'), '310,000,000원', '91.5', 'N', '']]),
  // 다른 입찰 사이트를 거친 건: 낙찰업체 정보 + 응찰금액·사업자번호 칸 없는 참여업체 표
  kg2b_900011: tbl('낙찰업체 정보', ['회사명', '사업자등록번호', '회사주소', '연락처', '대표명', '계약금액<br>(VAT 별도)', '계약선정방법'], [['마바서비스(주)', '4444444444', '서울 시험구 시험로 1', '02-000-0000', '김시험', '10,040,000원', '적격심사']])
    + tbl('참여업체 정보', ['순번', '응찰회사', '현장설명<br>참석여부', '입찰구비서류<br>적정여부', '낙찰<br>여부', '낙찰<br>무효', '평가<br>점수'], [
      ['1', '마바서비스(주)', 'Y', 'Y', 'Y', '', '99.7'], ['2', '사아(주)', 'Y', 'N', 'N', '', '98.0'], ['3', '자차(주)', 'Y', 'Y', 'N', '', '95.2'],
      ['4', '(주)우리시험', 'N', 'Y', 'N', '', '96.1'], ['5', '카타(주)', 'Y', 'Y', 'N', '', '95.7']]),
};
const kapt = fakeKapt({ detailHtml: (bid) => DETAIL[bid] ?? '' });
let srv, ctx, sql, fake;
const ROWS = [
  ['20261028000011', '[서울] 시험십일아파트 피트니스센터 위탁운영', { winner_name: '가나관리(주)', winner_amount: '280,000,000', award_date: plus(-1), current_status: '낙찰', deadline_at: `${plus(-2)}T10:00:00+09:00` }],
  ['kg2b_900011', '[서울] 시험십이아파트 헬스장 위탁운영 사업자 선정', { winner_name: '마바서비스(주)', award_date: plus(-2), current_status: '낙찰', deadline_at: `${plus(-3)}T10:00:00+09:00` }],
];
const rowOf = async (ext) => (await sql`select row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_external_id' = ${ext}`)[0].row;

before(async () => {
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const send = (code, text, type = 'text/html; charset=utf-8') => { res.statusCode = code; res.setHeader('content-type', type); res.end(text); };
    if (u.pathname === '/kapt/bid/bidResultList.do') return send(200, '<html><input name="_csrf" value="csrf-237"></html>');
    if (u.pathname === '/kapt/bid/bidResultListAjax.do') return send(200, '[]', 'application/json');
    if (kapt.handle(req, res, body)) return;
    send(404, 'nope');
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}` }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`insert into company_profiles (tenant, key, name, biz_no, is_default) values ('default', 'kapt237', '(주)우리시험', '123-45-67890', false)`;
  for (const [ext, title, o] of ROWS) {
    const id = randomUUID();
    await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${id}, ${sql.json({ id, source_type: 'kapt_bid', source_external_id: ext,
      source_url: `http://localhost:${PORT}/kapt/bid/bidDetail.do?bidNum=${ext}`, title, issuer: '시험 단지', related: true, fit_business: '다짐', notice_kind: 'new', first_seen_at: new Date(Date.now() - 6 * 864e5).toISOString(), ...o })}, 'workin')`;
  }
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('참여업체: 잠긴 고르기 칸은 선택된 값(서류 N·현장설명 Y) · 선택 표시 없으면 저장 안 함 · 가린 금액 = 비공개 · 금액 칸 없는 표도 비공개 · 대표자·전화 저장 안 함', async () => {
  await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_results/run', {});
  const a = await rowOf('20261028000011');
  assert.deepEqual(a.participants, [
    { name: '(주)우리시험', bizNo: '1234567890', amount: null, won: false, invalid: false, site: true, docs: false, hidden: true },
    { name: '가나관리(주)', bizNo: '2222222222', amount: 280000000, won: true, invalid: false, score: 93, site: true, docs: true },
    { name: '다라(주)', bizNo: '3333333333', amount: 310000000, won: false, invalid: false, score: 91.5, docs: true }], JSON.stringify(a.participants));
  assert.equal(a.kapt_detail_v, 3);
  const b = await rowOf('kg2b_900011');
  assert.deepEqual(b.participants.map((x) => [x.name, x.amount, x.site, x.docs, x.hidden, x.score ?? null, x.won]), [
    ['마바서비스(주)', null, true, true, true, 99.7, true], ['사아(주)', null, true, false, true, 98, false], ['자차(주)', null, true, true, true, 95.2, false],
    ['(주)우리시험', null, false, true, true, 96.1, false], ['카타(주)', null, true, true, true, 95.7, false]]);
  assert.deepEqual([b.winner_name, b.winner_biz_no, b.winner_amount, b.bidders], ['마바서비스(주)', '4444444444', 10040000, 5]);
  const all = JSON.stringify(await sql`select row from sales_src_rows where tbl = 'procurement_notices'`);
  for (const w of PRIVATE) assert.ok(!all.includes(w), `대표자·전화·연락처는 저장 안 함: ${w}`);
});

test('낙찰 분석 진 입찰: 우리 서류 N → 평가 제외(점수 줄 없음) · 우리 금액 비공개 · 서류 N 업체는 점수 순위에서 뺌(98점이어도)', async () => {
  const s = await ctx.owner.ok('GET', '/api/sales/award-stats?days=30');
  assert.deepEqual([s.participated, s.lostCount], [2, 2], JSON.stringify({ ...s, items: undefined }));
  const a = s.lost.find((x) => x.title.includes('시험십일'));
  assert.deepEqual([a.our, a.winner, a.winnerAmount, a.gap, a.bidders, a.score, a.docs, a.hidden], [null, '가나관리(주)', 280000000, null, 3, null, false, true]);
  const b = s.lost.find((x) => x.title.includes('시험십이'));
  assert.deepEqual([b.our, b.winner, b.winnerAmount, b.gap, b.bidders, b.docs, b.hidden], [null, '마바서비스(주)', 10040000, null, 5, true, true]);
  assert.deepEqual(b.score, { top: 99.7, our: 96.1, gap: 3.6, rank: 2, of: 4 }, '서류 N(98점) 업체를 빼면 우리 2위/4곳');
});
