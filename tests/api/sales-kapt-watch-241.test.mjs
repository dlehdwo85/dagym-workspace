// 241차 #751 후속(로컬 10/28 19:20 — 240차 뒤에도 kg2b_142624 '진행중'): 빠른 수집은 K-apt 목록 최신 500건만 보고 그 상세만 읽어서,
// 목록 밖으로 밀린 마감 전 관련 공고는 취소돼도 몰랐다 → 이번에 상세를 못 읽은 마감 전 관련 공고를 DB 에서 다시 읽음(상세를 오래전에 읽은 순 · 한 번에 40건)
// · 취소면 취소·사유 · 목록 칸(제목·마감·게시일)은 그대로 · 끝난(낙찰·취소)·관련 아님·마감 지난 공고는 안 읽음 · 플랫폼 공고 조회 probe=1 은 저장 없이 응답 코드·길이·취소 여부
// (구조 시험 — 가짜 K-apt 화면은 10/28 실제 상세 화면의 표 모양. 실제 K-apt 에서 kg2b_142624 가 취소로 바뀌는지는 운영 확인 몫)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { fakeKapt } from '../fakeKapt.mjs';

const PORT = 3278;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date());
const plus = (n) => kst(new Date(Date.parse(`${today}T12:00:00+09:00`) + n * 864e5));
const tr = (id, cells) => `<tr>${cells.map((c, i) => (i === 3 ? `<td><a href="javascript:goView('${id}')">${c}</a></td>` : `<td>${c}</td>`)).join('')}</tr>`;
const WHY = '계약기간 표시 오류로 인해 취소 하고 수정 후 재공고 예정';
const head = (bid) => `<table class="contTbl"><tbody><tr> <th scope="col">입찰번호</th> <td colspan="3"> ${bid} </td> </tr>
<tr> <th scope="col">입찰분류</th> <td> 사업자 - 용역 - 주민운동시설의 위탁 </td> <th scope="col">신용평가등급확인서<br>제출여부</th> <td> 제출 </td> </tr>
<tr> <th scope="col">현장설명</th> <td> 현장설명회없음 </td> <th scope="col">관리(공사용역)<br>실적증명서 제출여부</th> <td> 제출 </td> </tr></tbody></table>`;
const CANCEL = `<table class="contTbl txtC"> <thead> <tr> <th scope="colgroup" colspan="7">낙찰업체 정보</th> </tr> </thead>
<tbody> <tr> <td colspan="7"> 취소된 계약 입니다. </td> </tr> </tbody> </table>
<table class="contTbl txtC"> <tbody> <tr> <th scope="col">낙찰/유찰/취소 사유</th> </tr> <tr> <td> ${WHY}&nbsp; </td> </tr> </tbody> </table>`;
// 목록(최신)에 있는 공고 1건 + DB 에만 있는 공고: 취소된 것(C) · 아직 진행(L) · 이미 낙찰(D) · 관련 아님(U) · 마감 지남(P)
const N = { C: 'kg2b_241001', L: 'kg2b_241002', D: 'kg2b_241003', U: 'kg2b_241004', P: 'kg2b_241005', NEW: 'kg2b_241009' };
let srv, ctx, sql, fake, kapt;
const row = (k, extra = {}) => ({ id: randomUUID(), source_type: 'kapt_bid', source_external_id: N[k], source_url: `https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=${N[k]}`,
  title: `[경기] 시험이사일${k}아파트 주민공동시설(커뮤니티센터)위탁운영 업체 선정 입찰공고`, issuer: `시험이사일${k}아파트`, facility_name: `시험이사일${k}아파트`, related: true, fit_business: '다짐',
  matched_keywords: ['주민공동', '위탁운영'], classification: '즉시 검토', current_status: '진행중', notice_state: '신규공고', notice_kind: 'new', posted_date: plus(-20), deadline_at: `${plus(6)}T17:00:00+09:00`, bid_system: 'KG2B', award_method: '적격심사', region: '경기',
  first_seen_at: new Date(Date.now() - 20 * 864e5).toISOString(), updated_at: new Date(Date.now() - 864e5).toISOString(), ...extra });
const get = async (k) => (await sql`select row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_external_id' = ${N[k]}`)[0]?.row;
const detailCalls = () => kapt.calls.filter((c) => c.path === '/kapt/bid/bidDetail.do').map((c) => c.q.bidNum);

before(async () => {
  kapt = fakeKapt({ detailHtml: (bid) => head(bid) + (bid === N.C ? CANCEL : '') });
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const send = (code, text, type = 'text/html; charset=utf-8') => { res.statusCode = code; res.setHeader('content-type', type); res.end(text); };
    if (u.pathname === '/kapt/bid/bidList.do') return send(200, `<html><table>${u.searchParams.get('pageNo') === '1' ? tr(N.NEW, ['1', 'KG2B', '최저낙찰', '[서울] 시험이사일새아파트 승강기 교체공사', `${plus(9)} 17:00`, '신규공고', '시험이사일새아파트', `${today} 09:10`]) : ''}</table></html>`);
    if (u.pathname === '/kaptbidapi/getPblAncDeSearchV3') return send(200, JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' }, body: { items: [], numOfRows: 100, pageNo: 1, totalCount: 0 } } }), 'application/json');
    if (kapt.handle(req, res, body)) return;
    send(404, 'nope');
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}` }); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const put = (r) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${r.id}, ${sql.json(r)}, 'workin')`;
  await put(row('C')); await put(row('L', { detail_seen_at: new Date(Date.now() - 3 * 864e5).toISOString(), notice_state: '정정공고', notice_kind: 'amend' }));
  await put(row('D', { current_status: '낙찰', notice_state: '낙찰' })); await put(row('U', { related: false, fit_business: null, classification: null }));
  await put(row('P', { deadline_at: `${plus(-1)}T17:00:00+09:00` }));
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('목록 밖 마감 전 관련 공고 상세를 다시 읽어 취소를 잡음 · 목록 칸은 그대로 · 끝난·관련 아님·마감 지난 공고는 안 읽음', async () => {
  const before = { C: await get('C'), L: await get('L') };
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  assert.match(r.summary ?? r.run?.summary ?? JSON.stringify(r), /목록 밖 마감 전 공고 다시 확인 2건\(취소 1\)/);
  const asked = detailCalls();
  for (const k of ['C', 'L']) assert.ok(asked.includes(N[k]), `${k} 상세 다시 읽음`);
  for (const k of ['D', 'U', 'P']) assert.ok(!asked.includes(N[k]), `${k} 는 안 읽음`);
  const c = await get('C'), l = await get('L');
  assert.deepEqual([c.current_status, c.notice_state, c.notice_kind, c.result_note, !!c.kapt_cancel_at, !!c.detail_seen_at], ['취소', '취소', 'cancel', WHY, true, true]);
  for (const f of ['title', 'deadline_at', 'posted_date', 'issuer', 'facility_name']) assert.equal(c[f], before.C[f], `C ${f} 그대로`);
  assert.equal(l.current_status, '진행중'); assert.ok(Date.parse(l.detail_seen_at) > Date.parse(before.L.detail_seen_at), 'L 상세를 읽은 때 갱신');
  for (const f of ['title', 'deadline_at', 'posted_date', 'notice_state', 'notice_kind', 'bid_system', 'award_method', 'region', 'source_url']) assert.equal(l[f], before.L[f], `L ${f} 그대로(정정공고 종류 포함)`);
  // 목록 카드: C 는 취소(진행 중 탭에서 빠짐)
  const open = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=open')).items.map((x) => x.noticeNo);
  assert.ok(!open.includes(N.C), JSON.stringify(open));
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=canceled')).items.find((x) => x.noticeNo === N.C)?.status, '취소'); // 278차 #830: '취소된 공고' 탭
  // 다시 수집: 취소된 C 는 더 안 읽고(끝난 공고), L 은 다시 읽음(마감 전)
  kapt.calls.length = 0;
  await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  assert.deepEqual([detailCalls().includes(N.C), detailCalls().includes(N.L)], [false, true]);
  // 같은 상세를 다시 읽기만 한 줄은 updated_at 그대로(메일 '변경'에 매번 다시 오르지 않음) · 읽은 때만 새로
  const l2 = await get('L');
  assert.equal(l2.updated_at, l.updated_at, 'L updated_at 그대로');
  assert.ok(Date.parse(l2.detail_seen_at) > Date.parse(l.detail_seen_at));
});

test('플랫폼 공고 조회 probe=1: 지금 상세를 받아 응답 코드·길이·취소 여부(저장 안 함) · 이상한 번호는 probe 없음', async () => {
  const before = await get('L');
  const r = await ctx.owner.ok('GET', `/api/platform/sales-notices?no=${N.C}&probe=1`);
  assert.equal(r.probe.status, 200); assert.ok(r.probe.length > 500);
  assert.deepEqual([r.probe.canceledText, r.probe.canceled, r.probe.reason, r.probe.termsFound], [true, true, WHY, true]);
  assert.match(r.probe.url, /bidDetail\.do\?bidNum=kg2b_241001/);
  const l = await ctx.owner.ok('GET', `/api/platform/sales-notices?no=${N.L}&probe=1`);
  assert.deepEqual([l.probe.canceledText, l.probe.canceled], [false, false]);
  assert.deepEqual(await get('L'), before, 'probe 는 저장 안 함');
  assert.equal((await ctx.owner.ok('GET', `/api/platform/sales-notices?no=${encodeURIComponent('../x')}&probe=1`)).probe, undefined);
  assert.equal((await ctx.staffA.client.req('GET', `/api/platform/sales-notices?no=${N.C}&probe=1`)).status, 404, '플랫폼 운영자만');
});

test('258차(로컬 10/29 09:20 ⓒ): 마감일 칸이 빈 관련 K-apt 줄이 목록에 14일 넘게 안 보이면 사라짐 표시(이유와 함께) · 최근 본 줄·마감 있는 줄은 그대로', async () => {
  const old = new Date(Date.now() - 20 * 864e5).toISOString(), recent = new Date(Date.now() - 3 * 864e5).toISOString();
  const S = row('C', { id: randomUUID(), source_external_id: 'kg2b_241011', deadline_at: null, last_seen_at: old });
  const R = row('C', { id: randomUUID(), source_external_id: 'kg2b_241012', deadline_at: null, last_seen_at: recent });
  const D = row('C', { id: randomUUID(), source_external_id: 'kg2b_241013', last_seen_at: old }); // 마감 있는 줄(결과 추적이 씀)
  for (const r of [S, R, D]) await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${r.id}, ${sql.json(r)}, 'workin')`;
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  assert.match(r.summary ?? '', /마감일 없이 14일 넘게 안 보인 줄 1건 사라짐 표시/, r.summary);
  const g = async (x) => (await sql`select gone, row from sales_src_rows where src_id = ${x.id}`)[0];
  assert.deepEqual([(await g(S)).gone, (await g(S)).row.gone_reason, (await g(R)).gone, (await g(D)).gone], [true, 'K-apt 목록에 14일 넘게 안 보임(마감일 칸 없음)', false, false]);
  const it = (await ctx.owner.ok('GET', '/api/platform/sales-notices?no=kg2b_241011')).items[0];
  assert.ok(it.reasons.includes('사라짐 표시 — K-apt 목록에 14일 넘게 안 보임(마감일 칸 없음)'), JSON.stringify(it.reasons));
  assert.equal(it.eligibility.skip, '사라짐·합쳐짐 줄');
});
