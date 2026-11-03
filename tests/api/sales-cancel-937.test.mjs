// 350차(대표 11/04 #937 "래미안 세레니티 주민운동시설 위탁운영 공고가 2건, 한 건은 취소된 것 같은데" — K-apt 10/26 공고 6fabd5ac 가 '진행중'으로 남음):
// K-apt 자체 공고(kg2b_ 아님)의 취소는 상세에 '취소된 계약 입니다' 글자가 없고 머리 표의 '공고 취소 등록일' 칸 + '낙찰/유찰/취소 사유' 표로만 보인다 →
// 그 칸도 취소로 읽어 상태 '취소'·사유·취소 등록일(cancel_date) 저장 · 취소 탭 카드 · 같은 이름의 뒤 공고 업무 고정 칸에는 '이전 공고는 <취소 등록일> 취소됨 — 사유'(347차, 게시일이 아니라 취소 등록일)
// (구조 시험 — 가짜 K-apt 화면은 11/04 로컬이 읽은 실제 상세의 칸 이름 그대로. 실제 K-apt 연결은 운영에서)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { fakeKapt } from '../fakeKapt.mjs';

const PORT = 3285;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date());
const plus = (n) => kst(new Date(Date.parse(`${today}T12:00:00+09:00`) + n * 864e5));
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const kd = (ymd, hm) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}(${DOW[new Date(`${ymd}T12:00:00+09:00`).getUTCDay()]})${hm ? ` ${hm}` : ''}`;
const tr = (id, cells) => `<tr>${cells.map((c, i) => (i === 3 ? `<td><a href="javascript:goView('${id}')">${c}</a></td>` : `<td>${c}</td>`)).join('')}</tr>`;
const BID = '20261026174359937', BID2 = '20261027170423937'; const COMPLEX = '시험래미안세레니티';
const TITLE = '[경기] 시험래미안세레니티 주민운동시설 위탁운영 업체 선정 입찰공고'; const WHY = '위탁운영비 산출내역서 미비';
const CANCEL_DAY = plus(-2); // 게시(-3일)보다 하루 뒤에 취소 등록 — 고정 칸 한 줄은 이 날이어야 함
// 실제 화면(K-apt 자체 공고): 머리 표에 '공고 취소 등록일' 칸, '낙찰업체 정보' 표에는 '취소된 계약' 글자 없음, 구분 칸 없는 '낙찰/유찰/취소 사유' 표
const DETAIL = `<table class="contTbl"><tbody><tr> <th scope="col">입찰번호</th> <td colspan="3"> ${BID} </td> </tr>
<tr> <th scope="col">입찰분류</th> <td> 사업자 - 용역 - 주민운동시설의 위탁 </td> <th scope="col">공고 취소 등록일</th> <td> ${CANCEL_DAY} 10:16:17 </td> </tr>
<tr> <th scope="col">현장설명</th> <td> 현장설명회없음 </td> <th scope="col">관리(공사용역)<br>실적증명서 제출여부</th> <td> 제출 </td> </tr>
<tr> <th scope="col">서류제출마감일</th> <td>${plus(2)} 17:00:00</td> <th scope="col">입찰보증금</th> <td> 입찰가격의[5]% 이상 제출 </td> </tr></tbody></table>
<table class="contTbl txtC"> <thead> <tr> <th scope="colgroup" colspan="7">낙찰업체 정보</th> </tr> <tr> <th scope="col">회사명</th> <th scope="col">사업자등록번호</th> <th scope="col">회사주소</th> <th scope="col">연락처</th> <th scope="col">계약금액</th> <th scope="col">계약선정방법</th> <th scope="col">비고</th> </tr> </thead>
<tbody> <tr> <td colspan="7"> 낙찰 정보가 없습니다. </td> </tr> </tbody> </table>
<table class="contTbl txtC"> <tbody> <tr> <th scope="col">낙찰/유찰/취소 사유</th> </tr> <tr> <td> ${WHY}&nbsp; </td> </tr> </tbody> </table>
<table class="contTbl txtC"> <thead> <tr> <th scope="colgroup" colspan="11">참여업체 정보</th> </tr> </thead> <tbody> <tr> <td colspan="11"> 응찰 정보가 없습니다. </td> </tr> </tbody> </table>`;
let srv, ctx, sql, fake; const W = randomUUID(), R = randomUUID();
const base = { source_type: 'kapt_bid', source_external_id: BID, source_url: `https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=${BID}`, title: TITLE, issuer: COMPLEX, facility_name: COMPLEX,
  related: true, fit_business: '다짐', matched_keywords: ['주민운동', '위탁운영'], classification: '즉시 검토', current_status: '진행중', notice_state: '신규공고', notice_kind: 'new', posted_date: plus(-3), deadline_at: `${plus(2)}T17:00:00+09:00`, origin: 'workin' };
const rowOf = async (id) => (await sql`select row from sales_src_rows where tbl = 'procurement_notices' and src_id = ${id}`)[0].row;
const card = async (tab) => (await ctx.owner.ok('GET', `/api/sales/src?view=bids&tab=${tab}`)).items.filter((x) => x.noticeNo === BID);
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); return (await r.json()).detail ?? {}; };

before(async () => {
  const kapt = fakeKapt({ detailHtml: (bid) => (bid === BID ? DETAIL : '') });
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const send = (code, text, type = 'text/html; charset=utf-8') => { res.statusCode = code; res.setHeader('content-type', type); res.end(text); };
    if (u.pathname === '/kapt/bid/bidList.do') return send(200, `<html><table>${u.searchParams.get('pageNo') === '1' ? tr(BID, ['1', 'K-apt', '적격심사', TITLE, `${plus(2)} 17:00`, '신규공고', COMPLEX, `${plus(-3)} 17:43`]) : ''}</table></html>`);
    if (u.pathname === '/kaptbidapi/getPblAncDeSearchV3') return send(200, JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' }, body: { items: [], numOfRows: 100, pageNo: 1, totalCount: 0 } } }), 'application/json');
    if (kapt.handle(req, res, body)) return;
    send(404, 'nope');
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}` }); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  const t0 = new Date(Date.now() - 6 * 36e5).toISOString();
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${W}, ${sql.json({ ...base, id: W, first_seen_at: t0, updated_at: t0 })}, 'workin')`;
  // 10/27 재공고(번호·마감 다름, 같은 제목·발주처) — 취소 표시 대상이 아니고(뒤 게시) 업무 고정 칸에 '이전 공고 취소됨' 한 줄
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${R}, ${sql.json({ ...base, id: R, source_external_id: BID2, source_url: `https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=${BID2}`,
    posted_date: today, first_seen_at: new Date().toISOString(), updated_at: new Date().toISOString(), deadline_at: `${plus(5)}T17:00:00+09:00`, household_count: 1500 })}, 'workin')`;
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('수집: 상세의 공고 취소 등록일 칸 → 상태 취소 · 사유 · 취소 등록일(cancel_date) · 취소를 안 때 · 다시 수집해도 그대로', async () => {
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  assert.equal(r.inserted, 0, JSON.stringify(r));
  const a = await rowOf(W);
  assert.deepEqual([a.current_status, a.notice_state, a.notice_kind, a.result_note, a.cancel_date, !!a.kapt_cancel_at, !!a.terms_read_at], ['취소', '취소', 'cancel', WHY, CANCEL_DAY, true, true]);
  assert.match(String(a.cancel_at), new RegExp(`^${CANCEL_DAY}T10:16:17\\+09:00$`), '취소 등록일시(한국 시각)');
  await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  const b = await rowOf(W);
  assert.deepEqual([b.kapt_cancel_at, b.cancel_date, b.current_status], [a.kapt_cancel_at, CANCEL_DAY, '취소']);
  const r2 = await rowOf(R); assert.equal(r2.current_status, '진행중', '재공고는 그대로');
});

test('목록: 취소된 공고 탭 카드(사유) · 전체·진행 중 탭에서 빠짐', async () => {
  assert.equal((await card('all')).length, 0);
  const c = await card('canceled');
  assert.deepEqual([c.length, c[0]?.status, c[0]?.cancelReason], [1, '취소', WHY]);
});

test('재공고 업무 고정 칸: 이전 공고는 <취소 등록일> 취소됨 — 사유(게시일 아님) · 업무에 취소 띠는 없음', async () => {
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: `[입찰] ${COMPLEX} 재공고`, assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, space: 'sales' });
  await sql`update tasks set sales_ref = ${sql.json({ kind: 'bid', id: R, handoff: true })} where id = ${t.id}`;
  const d = await tick();
  assert.ok(d.bidDueAlign?.infoFilled >= 1, JSON.stringify(d.bidDueAlign));
  const [row] = await sql`select sales_ref from tasks where id = ${t.id}`;
  assert.deepEqual(row.sales_ref.bidInfo.prevCancel, { day: CANCEL_DAY, reason: WHY, deadlineLabel: kd(plus(2), '17:00') });
  assert.equal(row.sales_ref.cancel ?? null, null, '뒤 게시 업무에는 취소 표시 없음');
});
