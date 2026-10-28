// 239차(#743 1단계·#744 — 로컬 10/28 19:30·19:45, 대표 결정 15-38): K-apt 입찰공고 상세의 참가 조건·현장설명 칸을 읽어 저장(파일 안 열고) →
// 입찰 목록 줄(현장설명 필수 D-n · 자격·조건 한 줄 · 펼치기)·상세 8칸·공고 조회·당일 메일(배지·일정 줄·마감 임박)·넘긴 입찰 업무 일정('현장설명회(필수)')
// (구조 시험 — 가짜 K-apt 화면은 10/28 실제 상세 화면(20261027135716462 · A20261027150017752)의 표 모양 그대로. 실제 K-apt 읽기는 운영에서 확인)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { fakeKapt } from '../fakeKapt.mjs';

const PORT = 3264;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date());
const plus = (n) => kst(new Date(Date.parse(`${today}T12:00:00+09:00`) + n * 864e5));
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const mdw = (d) => { const [y, m, dd] = d.split('-').map(Number); return `${m}/${dd}(${WD[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]})`; };
const tr = (id, cells) => `<tr>${cells.map((c, i) => (i === 3 ? `<td><a href="javascript:goView('${id}')">${c}</a></td>` : `<td>${c}</td>`)).join('')}</tr>`;
const RED = (w) => `<br/> <p class="font_red"><i class="fas fa-asterisk"></i> ${w}</p>`;
// 실제 화면: 고른 칸만 checked='checked' — 현장설명의 안 고른 칸은 속성 없음, 긴급입찰의 안 고른 칸은 checked=""
const radio = (id, on) => `<input type="radio" class="form-check-input" name="isFiledDes" id="${id}" value="${id.slice(-1)}" ${on ? "checked='checked' " : ''}disabled="disabled"/>`;
const briefingCell = (k) => (k === 'ref' ? ` 공고문 참조 ${RED('현장설명이 있을 시, 불참업체는 낙찰 선정에 불이익을 받으실 수 있습니다.')} `
  : ` 현장설명회있음( <span> ${radio('isFiledDesP', k === 'P')} <label class="form-check-label" for="isFiledDesP">필수</label> </span> <span> ${radio('isFiledDesY', k === 'Y')} <label class="form-check-label" for="isFiledDesY">임의</label> </span> ) <span> ${radio('isFiledDesN', k === 'N')} <label class="form-check-label" for="isFiledDesN">없음</label> </span> ${RED('현장설명이 있을 시, 불참업체는 낙찰 선정에 불이익을 받으실 수 있습니다.')} `);
const detail = (o) => `<table class="contTbl txtC"><tbody><tr> <th scope="col">주택관리업자</th> <th scope="col">단지명 </th> <th scope="col">관리사무소 주소</th> <th scope="col">전화번호</th> <th scope="col">팩스번호</th> <th scope="col">동수</th> <th scope="col">세대수</th> </tr>
<tr> <td> 시험관리(주) </td> <td> ${o.complex} </td> <td> 서울 시험구 시험로 1 <td> 0200000000 </td> <td> 0200000001 </td> <td> 12 </td> <td> 1200 </td> </tr></tbody></table>
<table class="contTbl"><tbody>
<tr> <th scope="col">입찰번호</th> <td colspan="3"> ${o.bid} </td> </tr>
<tr> <th scope="col">입찰방법</th> <td>전자입찰</td> <th scope="col"> 입찰서 제출 마감일 </th> <td>${o.deadline}:00</td> </tr>
<tr> <th scope="col">입찰제목</th> <td>${o.title}</td> <th scope="col">긴급입찰여부</th> <td> <div class="form-check"> <span> <label class="form-check-label" for="emrgBidY">긴급</label> <input class="form-check-input" type="radio" id="emrgBidY" name="emrgBidYn" value="Y" disabled="disabled" checked="" > </span> <span> <label class="form-check-label" for="emrgBidN">일반</label> <input class="form-check-input" type="radio" id="emrgBidN" name="emrgBidYn" value="N" disabled="disabled" checked='checked'> </span> </div> </td> </tr>
<tr> <th scope="col">입찰종류</th> <td>제한경쟁</td> <th scope="col">낙찰방법</th> <td> ${o.award} </td> </tr>
<tr> <th scope="col">입찰분류</th> <td> 사업자 - 용역 - 기타 용역 </td> <th scope="col">신용평가등급확인서<br>제출여부</th> <td> ${o.credit} </td> </tr>
<tr> <th scope="col">현장설명</th> <td>${briefingCell(o.kind)}</td> <th scope="col">관리(공사용역)<br>실적증명서 제출여부</th> <td> ${o.perf} </td> </tr>
<tr> <th scope="col">현장설명일시</th> <td> ${o.at ? `${o.at}:00` : ''} </td> <th scope="col">현장설명장소</th> <td> ${o.place ?? ''} </td> </tr>
<tr id="trReqDocs" style="display:none"> <th scope="col">입찰구비서류</th> <td colspan="3"> <span> <input type="radio" id="bidReqDocsY" class="form-check-input" disabled="disabled"/> <label for="bidReqDocsY" class="form-check-label" >있음</label> </span> <span> <input type="radio" id="bidReqDocsN" class="form-check-input" checked='checked' disabled="disabled"/> <label for="bidReqDocsN" class="form-check-label" >없음</label> </span> &nbsp;&nbsp; 공고문 참조 ${RED('입찰구비서류 부적정 업체는 낙찰 선정에 불이익을 받으실 수 있습니다.')} </td> </tr>
<tr> <th scope="col">서류제출마감일</th> <td>${o.deadline}:00</td> <th scope="col">입찰보증금</th> <td> ${o.bond} </td> </tr>
<tr> <th scope="col">지급조건</th> <td colspan="3">${o.pay ?? ''}</td> </tr>
<tr> <th scope="col">내용</th> <td colspan="3"> <div style="max-height:200px; overflow:auto;"> <pre>첨부 공고문 참조</pre> </div> </td> </tr>
</tbody></table>${o.cancel ? CANCELED(o.cancel) : ''}`;
// #751 실제 화면(kg2b_142624, 10/28): 마감 전 취소 — '낙찰업체 정보' 표에 '취소된 계약 입니다.' 한 칸 + '낙찰/유찰/취소 사유' 표
const CANCELED = (why) => `<table class="contTbl txtC"><thead> <tr> <th scope="colgroup" colspan="7">낙찰업체 정보</th> </tr> <tr> <th scope="col">회사명</th> <th scope="col">사업자등록번호</th> <th scope="col">회사주소</th> <th scope="col">연락처</th> <th scope="col">대표명</th> <th scope="col">계약금액<br>(VAT 별도)</th> <th scope="col">계약선정방법</th> </tr> </thead> <tbody> <tr> <td colspan="7"> 취소된 계약 입니다. </td> </tr> </tbody> </table> <table class="contTbl txtC"> <tbody> <tr> <th scope="col">낙찰/유찰/취소 사유</th> </tr> <tr> <td> ${why}&nbsp; </td> </tr> </tbody> </table>`;
// A = 필수(잠실 같은 공고) · B = '공고문 참조'(광명 같은 다른 사이트 공고) · C = 없음
const N = {
  A: { bid: '20261028239001', title: '[서울송파] 시험일아파트 커뮤니티 피트니스센터 위탁운영 사업자 선정', complex: '시험일아파트', award: '적격심사', deadline: `${plus(9)} 17:00`, kind: 'P', at: `${plus(2)} 10:00`,
    place: '생활지원센터 회의실 (담당: 홍시험 02-555-1234)', credit: '제출', perf: '제출', bond: '입찰가격의[5]% 이상 제출', pay: '당단지 지급조건에 따름' },
  B: { bid: 'A20261028239002', title: '[경기광명] 시험이아파트 헬스장 위탁운영 사업자 선정', complex: '시험이아파트', award: '최저가', deadline: `${plus(10)} 17:00`, kind: 'ref', at: `${plus(5)} 14:00`,
    place: '입주자대표회의실', credit: '공고문 참조', perf: '공고문 참조', bond: '공고문 참조' },
  C: { bid: '20261028239003', title: '[부산] 시험삼아파트 피트니스 위탁운영 업체 선정', complex: '시험삼아파트', award: '적격심사', deadline: `${plus(12)} 10:00`, kind: 'N', credit: '미제출', perf: '제출', bond: '입찰가격의[10]% 이상 제출' },
  // #751: 목록은 '신규공고'인데 상세는 취소 · 같은 단지·제목(긴급 표시 뺌)으로 재공고
  D: { bid: 'kg2b_239004', title: '[경기] 시험사아파트 주민공동시설(커뮤니티센터)위탁운영 업체 선정 입찰공고 (긴급)', complex: '시험사아파트', award: '최저가', deadline: `${plus(8)} 17:00`, kind: 'N', credit: '제출', perf: '제출', bond: '입찰가격의[5]% 이상 제출',
    state: '신규공고', cancel: '계약기간 표시 오류로 인해 취소 하고 수정 후 재공고 하고자 합니다.' },
  E: { bid: '20261028239006', title: '[경기] 시험사아파트 주민공동시설(커뮤니티센터)위탁운영 업체 선정 입찰공고', complex: '시험사아파트', award: '최저가', deadline: `${plus(15)} 17:00`, kind: 'N', credit: '제출', perf: '제출', bond: '입찰가격의[5]% 이상 제출' },
};
const PRIVATE = ['홍시험', '02-555-1234', '불참업체', '부적정'];
const T = ['site_briefing_kind', 'site_briefing_at', 'site_briefing_place', 'credit_rating_cert', 'performance_cert', 'bid_bond', 'docs_deadline_at', 'bid_method', 'urgent_bid', 'payment_terms', 'bid_docs'];
const pickT = (r) => Object.fromEntries(T.map((k) => [k, r?.[k] ?? null]));
let srv, ctx, sql, fake; const detailOf = {};
const rowOf = async (ext) => (await sql`select src_id, row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_external_id' = ${ext}`)[0];
const run = () => ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
const patch = (id, p) => sql`update sales_src_rows set row = row || ${sql.json(p)} where scope = 'global' and tbl = 'procurement_notices' and src_id = ${id}`;
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); };
const bidEvents = async (id) => { const [w] = await sql`select data from sales_work_records where tenant = 'default' and src_tbl = 'opportunity_work' and ref_id = ${id} order by updated_at desc limit 1`;
  const ids = Object.values(w?.data?.bid_events ?? {}); return ids.length ? (await sql`select title from events where id = any(${ids}::uuid[]) and deleted_at is null order by start_at`).map((e) => e.title.split(' · ')[0]) : []; };

before(async () => {
  const kapt = fakeKapt({ detailHtml: (bid) => detailOf[bid] ?? '' });
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const send = (code, text, type = 'text/html; charset=utf-8') => { res.statusCode = code; res.setHeader('content-type', type); res.end(text); };
    if (u.pathname === '/kapt/bid/bidList.do') return send(200, `<html><table>${u.searchParams.get('pageNo') === '1' ? Object.values(N).map((o, i) => tr(o.bid, [String(i + 1), 'K-APT', o.award, o.title, o.deadline, o.state ?? '공고중', o.complex, `${today} 09:${String(10 + i)}`])).join('') : ''}</table></html>`);
    if (u.pathname === '/kaptbidapi/getPblAncDeSearchV3') return send(200, JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' }, body: { items: [], numOfRows: 100, pageNo: 1, totalCount: 0 } } }), 'application/json');
    if (kapt.handle(req, res, body)) return;
    send(404, 'nope');
  }).listen(PORT);
  for (const o of Object.values(N)) detailOf[o.bid] = detail(o);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}` }); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  // 지난 메일 = 어제 08:00 → 그 전에 본 공고는 '진행 중(D-3 안)' 몫
  await sql`insert into sales_digests (tenant, day, items, counts, mailed, notified, created_at) values ('default', ${plus(-1)}, '[]', '{}', 1, 1, ${new Date(`${plus(-1)}T08:00:00+09:00`)})`;
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('상세 칸 저장: 현장설명 필수·공고문 참조·없음 · 일시·장소 · 신용평가·실적증명·보증금 · 숨긴 줄(입찰구비서류)·빨간 안내 문장·장소 칸의 담당자·전화는 저장 안 함', async () => {
  await run();
  const a = (await rowOf(N.A.bid)).row, b = (await rowOf(N.B.bid)).row, c = (await rowOf(N.C.bid)).row;
  assert.deepEqual(pickT(a), { site_briefing_kind: '필수', site_briefing_at: `${plus(2)}T10:00:00+09:00`, site_briefing_place: '생활지원센터 회의실', credit_rating_cert: '제출', performance_cert: '제출',
    bid_bond: '입찰가격의 5% 이상 제출', docs_deadline_at: `${plus(9)}T17:00:00+09:00`, bid_method: '전자입찰', urgent_bid: false, payment_terms: '당단지 지급조건에 따름', bid_docs: null });
  assert.deepEqual(pickT(b), { site_briefing_kind: '공고문 참조', site_briefing_at: `${plus(5)}T14:00:00+09:00`, site_briefing_place: '입주자대표회의실', credit_rating_cert: '공고문 참조', performance_cert: '공고문 참조',
    bid_bond: '공고문 참조', docs_deadline_at: `${plus(10)}T17:00:00+09:00`, bid_method: '전자입찰', urgent_bid: false, payment_terms: null, bid_docs: null });
  assert.deepEqual(pickT(c), { site_briefing_kind: '없음', site_briefing_at: null, site_briefing_place: null, credit_rating_cert: '미제출', performance_cert: '제출',
    bid_bond: '입찰가격의 10% 이상 제출', docs_deadline_at: `${plus(12)}T10:00:00+09:00`, bid_method: '전자입찰', urgent_bid: false, payment_terms: null, bid_docs: null });
  for (const r of [a, b, c]) assert.ok(r.terms_read_at && !Number.isNaN(Date.parse(r.terms_read_at)), '읽은 때');
  assert.equal(a.contract_method, '제한경쟁'); assert.equal(a.award_method, '적격심사');
  const all = JSON.stringify(await sql`select row from sales_src_rows where tbl = 'procurement_notices'`);
  for (const w of PRIVATE) assert.ok(!all.includes(w), `담당자·전화·안내 문장은 저장 안 함: ${w}`);
});

test('다시 수집해도 같은 조건이면 고침으로 안 셈(읽은 때·updated_at 그대로) · 현장설명이 바뀌면 칸·읽은 때만 고치고 updated_at 은 그대로(메일 변경 구역에 다시 안 오름)', async () => {
  const a0 = (await rowOf(N.A.bid)).row;
  await run();
  const a1 = (await rowOf(N.A.bid)).row;
  assert.deepEqual([a1.terms_read_at, a1.updated_at], [a0.terms_read_at, a0.updated_at], '같은 조건 — 그대로');
  N.A.at = `${plus(3)} 14:00`; detailOf[N.A.bid] = detail(N.A); // 현장설명 일시 정정
  await run();
  const a2 = (await rowOf(N.A.bid)).row;
  assert.equal(a2.site_briefing_at, `${plus(3)}T14:00:00+09:00`);
  assert.ok(Date.parse(a2.terms_read_at) > Date.parse(a1.terms_read_at), '조건이 바뀌면 읽은 때도');
  assert.equal(a2.updated_at, a1.updated_at, '조건 칸만 바뀐 것은 updated_at 그대로');
});

test('입찰 목록: 현장설명(종류·일시·장소·필수) · 자격·조건 한 줄 · 펼치기 표 · 상세 8칸 · 마감 임박 탭에 필수 현장설명 3일 안', async () => {
  const items = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all')).items;
  const card = (o) => items.find((x) => x.noticeNo === o.bid);
  const a = card(N.A), b = card(N.B), c = card(N.C);
  assert.deepEqual(a.briefing, { kind: '필수', at: `${plus(3)}T14:00:00+09:00`, place: '생활지원센터 회의실', required: true });
  assert.equal(a.terms, '적격심사 · 제한경쟁 · 신용평가 제출 · 실적증명 제출 · 보증금 5%');
  assert.deepEqual(a.termRows, [['낙찰 방법', '적격심사'], ['입찰 종류', '제한경쟁'], ['입찰 방법', '전자입찰'], ['신용평가등급확인서', '제출'], ['실적증명서', '제출'], ['입찰 보증금', '입찰가격의 5% 이상 제출'],
    ['현장설명', `필수 ${mdw(plus(3))} 14:00 · 생활지원센터 회의실`], ['지급 조건', '당단지 지급조건에 따름']], '서류 제출 마감이 입찰 마감과 같으면 뺌');
  assert.deepEqual([a.detail.qualification, a.detail.performance, a.detail.briefing, a.detail.tasks ?? null], // 252차: 참가 자격 = 공고문 '참가자격' 절(입찰 방식 줄이 아님 — 아직 안 읽었으면 빔)
    [null, '실적증명서 제출', `현장설명 필수 ${mdw(plus(3))} 14:00 · 생활지원센터 회의실`, null], "'첨부 공고문 참조' 는 과업 칸에 안 넣음");
  assert.deepEqual(b.briefing, { kind: '공고문 참조', at: `${plus(5)}T14:00:00+09:00`, place: '입주자대표회의실', required: false });
  assert.equal(b.terms, '최저가 · 제한경쟁 · 공고문 참조: 신용평가·실적증명·보증금');
  assert.equal(b.detail.briefing, `현장설명 ${mdw(plus(5))} 14:00 · 입주자대표회의실 · 필수 여부 공고문 참조`);
  assert.equal(c.briefing, null, '현장설명 없음');
  assert.equal(c.terms, '적격심사 · 제한경쟁 · 실적증명 제출 · 보증금 10%');
  assert.ok(c.termRows.some(([k, v]) => k === '신용평가등급확인서' && v === '미제출') && !c.termRows.some(([k]) => k === '현장설명'));
  const soon = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=soon')).items.map((x) => x.noticeNo);
  assert.deepEqual(soon, [N.A.bid], '필수 현장설명 3일 안(입찰 마감 9일 뒤)만 마감 임박 — 공고문 참조·없음은 아님');
});

test('#751 마감 전 취소: 상세의 취소된 계약·사유 → 상태 취소·공고구분 cancel·사유 · 다음 수집이 상세를 못 읽어도(목록은 신규공고) 되돌리지 않음 · 진행 중 탭에서 빠짐 · 재공고와 서로 이음', async () => {
  const d = (await rowOf(N.D.bid)).row;
  assert.deepEqual([d.current_status, d.notice_kind, d.notice_state, d.result_note], ['취소', 'cancel', '취소', '계약기간 표시 오류로 인해 취소 하고 수정 후 재공고 하고자 합니다.']);
  detailOf[N.D.bid] = ''; await run(); // 상세를 못 읽은 수집 — 목록 상태는 여전히 '신규공고'
  const d2 = (await rowOf(N.D.bid)).row;
  assert.deepEqual([d2.current_status, d2.notice_kind, d2.notice_state], ['취소', 'cancel', '취소'], '취소는 되돌리지 않음');
  detailOf[N.D.bid] = detail(N.D);
  const all = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all')).items;
  const cd = all.find((x) => x.noticeNo === N.D.bid), ce = all.find((x) => x.noticeNo === N.E.bid);
  assert.equal(cd.cancelReason, '계약기간 표시 오류로 인해 취소 하고 수정 후 재공고 하고자 합니다.');
  assert.deepEqual(cd.renotice, { title: N.E.title, close: plus(15) });
  assert.deepEqual([ce.prevCancel?.reason, ce.cancelReason], ['계약기간 표시 오류로 인해 취소 하고 수정 후 재공고 하고자 합니다.', null]);
  const open = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=open')).items.map((x) => x.noticeNo);
  assert.ok(!open.includes(N.D.bid) && open.includes(N.E.bid), '취소는 진행 중에서 빠지고 재공고는 남음');
});

test('공고 조회: 현장설명·조건 한 줄·읽은 때', async () => {
  const it = (await ctx.owner.ok('GET', `/api/platform/sales-notices?no=${N.A.bid}`)).items[0];
  assert.deepEqual([it.briefing?.kind, it.briefing?.at, it.briefing?.required, it.terms], ['필수', `${plus(3)}T14:00:00+09:00`, true, '적격심사 · 제한경쟁 · 신용평가 제출 · 실적증명 제출 · 보증금 5%']);
  assert.ok(it.termsReadAt);
});

test("당일 메일: 필수 현장설명 3일 안 = '진행 중(D-3 안)'(입찰 마감이 멀어도) · 배지 '현장설명 필수' · 일정 줄 '현장설명(필수) 일시 장소'", async () => {
  const old = new Date(Date.now() - 72 * 36e5).toISOString();
  await patch((await rowOf(N.A.bid)).src_id, { first_seen_at: old, updated_at: old }); // 지난 메일 전에 받은 공고
  const d = await ctx.owner.ok('GET', '/api/sales/digest');
  const a = d.items.find((x) => x.noticeNo === N.A.bid), b = d.items.find((x) => x.noticeNo === N.B.bid), c = d.items.find((x) => x.noticeNo === N.C.bid);
  assert.equal(a?.section, 'soon', JSON.stringify(d.items.map((x) => [x.noticeNo, x.section])));
  assert.ok(a.badges.includes('현장설명 필수') && !a.badges.includes('현장설명'));
  assert.deepEqual([a.briefingKind, a.briefingPlace, a.briefingAt], ['필수', '생활지원센터 회의실', `${plus(3)} 14:00`]);
  assert.ok(b.badges.includes('현장설명') && !b.badges.includes('현장설명 필수'));
  assert.ok(!c.badges.some((x) => x.startsWith('현장설명')));
  const text = (await ctx.owner.req('GET', '/api/sales/digest?preview=text')).body;
  assert.ok(text.includes(`현장설명(필수) ${mdw(plus(3))} 14:00 생활지원센터 회의실`), text);
  assert.ok(text.includes(`현장설명 ${mdw(plus(5))} 14:00 입주자대표회의실`));
  const html = (await ctx.owner.req('GET', '/api/sales/digest?preview=html')).body;
  assert.ok(html.includes('마감·필수 현장설명 D-3 이내') && html.includes('현장설명 필수'));
  const cx = d.items.find((x) => x.noticeNo === N.D.bid); // #751 취소 공고 = 즉시 검토가 아니라 정정·취소 구역에 사유와 함께
  assert.deepEqual([cx?.section, cx?.kind, cx?.result], ['change', 'cancel', '취소 사유: 계약기간 표시 오류로 인해 취소 하고 수정 후 재공고 하고자 합니다.']);
  assert.ok(text.includes('취소 사유: 계약기간 표시 오류로 인해 취소'));
});

test("입찰 업무로 넘기기: 필수 현장설명 = 일정 '현장설명회(필수)' · 없음이면 일정 없음 · 넘긴 뒤에 알게 된 현장설명은 정기 점검이 한 번 만듦", async () => {
  const A = (await rowOf(N.A.bid)).src_id, C = (await rowOf(N.C.bid)).src_id;
  const ra = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: A, assigneeIds: [ctx.ownerId] });
  assert.deepEqual(ra.dates.map((x) => x.label), ['현장설명회(필수)', '입찰 마감']);
  assert.deepEqual(await bidEvents(A), ['[입찰] 현장설명회(필수)', '[입찰] 입찰 마감']);
  await patch(C, { site_briefing_at: `${plus(4)}T10:00:00+09:00` }); // 일시가 있어도 '없음'이면 일정 아님
  const rc = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: C, assigneeIds: [ctx.ownerId] });
  assert.deepEqual(rc.dates.map((x) => x.label), ['입찰 마감']);
  // 넘길 때는 현장설명을 몰랐던 공고(배포 전에 넘긴 K-apt 공고) → 상세를 읽어 필수 현장설명이 생김 → 정기 점검이 일정 1건
  const E = randomUUID();
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${E}, ${sql.json({ id: E, source_type: 'kapt_bid', source_external_id: '20261028239005',
    source_url: `http://localhost:${PORT}/kapt/bid/bidDetail.do?bidNum=20261028239005`, title: '[인천] 시험오아파트 헬스장 위탁운영', related: true, fit_business: '다짐', notice_kind: 'new', deadline_at: `${plus(11)}T17:00:00+09:00`, first_seen_at: new Date().toISOString() })}, 'workin')`;
  const re = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: E, assigneeIds: [ctx.ownerId] });
  assert.deepEqual(re.dates.map((x) => x.label), ['입찰 마감']);
  await patch(E, { site_briefing_kind: '필수', site_briefing_at: `${plus(4)}T10:00:00+09:00`, site_briefing_place: '관리사무소' });
  await tick();
  assert.deepEqual(await bidEvents(E), ['[입찰] 현장설명회(필수)', '[입찰] 입찰 마감']);
  await tick();
  assert.equal((await sql`select count(*)::int n from events where title like '[입찰] 현장설명회(필수) · %시험오아파트%' and deleted_at is null`)[0].n, 1, '다시 점검해도 한 건');
});
