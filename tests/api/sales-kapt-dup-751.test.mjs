// #751 후속(로컬 10/28 18:22 광명자이더샵포레나 kg2b_142624 — 239차 뒤에도 '진행중 · 즉시 검토'): 같은 K-apt 공고가 두 줄(원본 영업관리 복사 + 워크인 수집)이면
// 예전엔 수집이 아무 한 줄만 '취소'로 고쳤고, 목록 카드는 아직 '진행중'인 다른 줄 상태를 보였다 → 두 줄 모두 같은 계산으로 고침 · 한 줄만 취소여도 카드는 취소 ·
// 원본 매일 복사가 되돌려도(취소 표시 없음) 카드는 취소 (구조 시험 — 가짜 K-apt 화면은 10/28 실제 상세 화면의 표 모양)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { fakeKapt } from '../fakeKapt.mjs';

const PORT = 3276;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date());
const plus = (n) => kst(new Date(Date.parse(`${today}T12:00:00+09:00`) + n * 864e5));
const tr = (id, cells) => `<tr>${cells.map((c, i) => (i === 3 ? `<td><a href="javascript:goView('${id}')">${c}</a></td>` : `<td>${c}</td>`)).join('')}</tr>`;
const BID = 'kg2b_751001'; const TITLE = '[경기] 시험칠오일아파트 주민공동시설(커뮤니티센터)위탁운영 업체 선정 입찰공고 (긴급)'; const WHY = '계약기간 표시 오류로 인해 취소 하고 수정 후 재공고 하고자 합니다.';
// 실제 화면(다른 입찰 사이트 건): 현장설명 표 + '낙찰업체 정보' 표에 '취소된 계약 입니다.' 한 칸 + 구분 칸 없는 '낙찰/유찰/취소 사유' 표 + 참여업체 '응찰 정보가 없습니다.'
const DETAIL = `<table class="contTbl"><tbody><tr> <th scope="col">입찰번호</th> <td colspan="3"> ${BID} </td> </tr>
<tr> <th scope="col">입찰분류</th> <td> 사업자 - 용역 - 주민운동시설의 위탁 </td> <th scope="col">신용평가등급확인서<br>제출여부</th> <td> 제출 </td> </tr>
<tr> <th scope="col">현장설명</th> <td> 현장설명회없음 </td> <th scope="col">관리(공사용역)<br>실적증명서 제출여부</th> <td> 제출 </td> </tr>
<tr> <th scope="col">서류제출마감일</th> <td>${plus(8)} 17:00:00</td> <th scope="col">입찰보증금</th> <td> 입찰가격의[5]% 이상 제출 </td> </tr></tbody></table>
<table class="contTbl txtC"> <thead> <tr> <th scope="colgroup" colspan="7">낙찰업체 정보</th> </tr> <tr> <th scope="col">회사명</th> <th scope="col">사업자등록번호</th> <th scope="col">회사주소</th> <th scope="col">연락처</th> <th scope="col">대표명</th> <th scope="col">계약금액<br>(VAT 별도)</th> <th scope="col">계약선정방법</th> </tr> </thead>
<tbody> <tr> <td colspan="7"> 취소된 계약 입니다. </td> </tr> </tbody> </table>
<table class="contTbl txtC"> <tbody> <tr> <th scope="col">낙찰/유찰/취소 사유</th> </tr> <tr> <td> ${WHY}&nbsp; </td> </tr> </tbody> </table>
<table class="contTbl txtC"> <thead> <tr> <th scope="colgroup" colspan="11">참여업체 정보</th> </tr> </thead> <tbody> <tr> <td colspan="11"> 응찰 정보가 없습니다. </td> </tr> </tbody> </table>`;
let srv, ctx, sql, fake; const W = randomUUID(), S = 'SRC751001';
const base = { source_type: 'kapt_bid', source_external_id: BID, source_url: `https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=${BID}`, title: TITLE, issuer: '시험칠오일아파트', facility_name: '시험칠오일아파트',
  related: true, fit_business: '다짐', matched_keywords: ['주민공동', '위탁운영'], classification: '즉시 검토', current_status: '진행중', notice_state: '신규공고', notice_kind: 'urgent', posted_date: today, deadline_at: `${plus(8)}T17:00:00+09:00` };
const rowsOf = async () => Object.fromEntries((await sql`select src_id, row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_external_id' = ${BID}`).map((x) => [x.src_id === W ? 'W' : x.src_id === S ? 'S' : x.src_id, x.row]));
const card = async (tab) => (await ctx.owner.ok('GET', `/api/sales/src?view=bids&tab=${tab}`)).items.filter((x) => x.noticeNo === BID);

before(async () => {
  const kapt = fakeKapt({ detailHtml: (bid) => (bid === BID ? DETAIL : '') });
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const send = (code, text, type = 'text/html; charset=utf-8') => { res.statusCode = code; res.setHeader('content-type', type); res.end(text); };
    if (u.pathname === '/kapt/bid/bidList.do') return send(200, `<html><table>${u.searchParams.get('pageNo') === '1' ? tr(BID, ['1', 'KG2B', '최저낙찰', TITLE, `${plus(8)} 17:00`, '신규공고', '시험칠오일아파트', `${today} 09:10`]) : ''}</table></html>`);
    if (u.pathname === '/kaptbidapi/getPblAncDeSearchV3') return send(200, JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' }, body: { items: [], numOfRows: 100, pageNo: 1, totalCount: 0 } } }), 'application/json');
    if (kapt.handle(req, res, body)) return;
    send(404, 'nope');
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}` }); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  // 운영처럼 이미 두 줄: 워크인 수집 줄(먼저 봄) + 원본 영업관리 복사 줄(나중에 봄 → 예전 카드의 '가장 나중 게시')
  const t0 = new Date(Date.now() - 6 * 36e5).toISOString(), t1 = new Date(Date.now() - 2 * 36e5).toISOString();
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${W}, ${sql.json({ ...base, id: W, first_seen_at: t0, updated_at: t0 })}, 'workin')`;
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${S}, ${sql.json({ ...base, id: S, first_seen_at: t1, updated_at: t1 })}, 'src')`;
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('수집: 같은 공고 두 줄(워크인 수집 + 원본 복사)을 모두 취소·사유·취소를 안 때로 고침 · 새 줄은 안 생김 · 다시 수집해도 안 때는 그대로', async () => {
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  assert.equal(r.inserted, 0, JSON.stringify(r));
  const a = await rowsOf();
  assert.deepEqual(Object.keys(a).sort(), ['S', 'W']);
  for (const k of ['W', 'S']) assert.deepEqual([a[k].current_status, a[k].notice_state, a[k].notice_kind, a[k].result_note, !!a[k].kapt_cancel_at, !!a[k].terms_read_at], ['취소', '취소', 'cancel', WHY, true, true], k);
  await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  const b = await rowsOf();
  assert.deepEqual([b.W.kapt_cancel_at, b.S.kapt_cancel_at, b.W.updated_at], [a.W.kapt_cancel_at, a.S.kapt_cancel_at, a.W.updated_at], '다시 수집해도 취소를 안 때·updated_at 그대로(메일 변경에 다시 안 오름)');
});

test('목록: 카드 한 장 · 취소(사유) · 진행 중 탭에서 빠짐 — 원본 매일 복사가 한 줄을 진행중으로 되돌려도 카드는 취소', async () => {
  let all = await card('all');
  assert.equal(all.length, 1, '같은 공고 한 장');
  assert.equal(all[0].status, '취소'); assert.equal(all[0].cancelReason, WHY);
  assert.equal((await card('open')).length, 0, '진행 중 탭에서 빠짐');
  // 원본 복사 줄만 예전 값으로(취소 표시 없음) — 이 줄이 '가장 나중 게시'여도 같은 번호 줄이 취소면 카드는 취소
  await sql`update sales_src_rows set row = row - 'kapt_cancel_at' - 'result_note' || ${sql.json({ current_status: '진행중', notice_state: '신규공고', notice_kind: 'urgent' })}::jsonb where src_id = ${S}`;
  all = await card('all');
  assert.deepEqual([all.length, all[0]?.status], [1, '취소']);
  assert.equal((await card('open')).length, 0);
});
