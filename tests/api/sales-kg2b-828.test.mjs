// 279차 #828(대표 10/31 "입찰 공고문 KG2B에 있고 KAPT에는 공유만 되서 공고문을 못 갖고옴") — K-apt 'kg2b_번호' 공고는 K-apt 상세에 첨부가 없음 →
// KG2B 상세(KaptBidView?bidcode=, 로그인 없이 열림 — 10/31 kg2b_142686 클라우드 확인)에서 공고번호·입찰 개시·개찰(일시·장소)·참가 제한 지역·현장설명·공고문(goLoad)을 읽어 공고 줄에 채움
// · 담당자 칸(직함·이름)은 저장 안 함 · 한 번 읽고 공고문이 있으면 다시 안 읽음 · 목록 카드 첨부에 보임
// (구조 시험 — 가짜 KG2B 화면은 10/31 실제 KaptBidView 표·goLoad 모양 그대로. 실제 KG2B 연결은 운영 확인 몫)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { fakeKapt } from '../fakeKapt.mjs';

const PORT = 3282;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date());
const plus = (n) => kst(new Date(Date.parse(`${today}T12:00:00+09:00`) + n * 864e5));
const tr = (id, cells) => `<tr>${cells.map((c, i) => (i === 3 ? `<td><a href="javascript:goView('${id}')">${c}</a></td>` : `<td>${c}</td>`)).join('')}</tr>`;
const BID = 'kg2b_828001', CODE = '828001'; const TITLE = '[충남천안] 시험팔이팔푸르지오 주민공동시설 위탁운영 사업자 선정 입찰공고';
const KG2B = `<html><head><title>KG2B 전자입찰시스템</title><script>function goLoad(path,file,type,name){ location.href='/common/util/download?file='+file; }</script></head><body>
<table class="table_view"><colgroup><col width="15%"><col width="*"></colgroup>
			<tr>
				<th>공고번호</th>
				<td>202610281060-00</td>
				<th>공고일시</th>
				<td><span class="blue3">
					${plus(-3)} 18:46
					</span> </td>
			</tr>
			<tr><th>공고구분</th>
				<td>
용역
</td><th>낙찰방법</th><td>APT적격심사(수동)</td></tr>
			<tr><th>업종</th><td>위탁(식당/어린이집/자판기/검침)등/</td><th>참가제한지역</th><td>전국</td></tr>
			<tr><th>발주처</th><td>시험팔이팔푸르지오아파트</td><th>담당자</th><td>관리소장 홍길동</td></tr>
			<tr><th>연락처</th><td>041-000-0000</td><th>기타사항</th><td></td></tr>
			<tr>
				<th>현장설명회실시유무</th>
				<td>
					
						없음
						
				</td>
				<th>현설일시</th>
				<td><span class="red2">
					

					</span></td>
			</tr>
			<tr><th>입찰개시일시</th><td>${plus(-3)} 17:00</td><th>입찰마감일시</th><td>${plus(9)} 09:00</td></tr>
			<tr><th>개찰일시</th><td>${plus(9)} 10:00</td><th>개찰장소</th><td>입찰 담당자PC</td></tr>
			<tr>
							<th>공고서</th>
							<td>
								<dl class="view_formdown">
									<dt></dt>
									<dd><img src="/resources/images/bid_list/icoFile.gif" width="14" height="13" style="vertical-align:middle">
<a href="javascript:goLoad('20261028/','646BD8D2-5523-1646-0CDF-D497D8968AAD.hwp','bid','주민공동시설 입찰공고문.hwp');" class="bidView">주민공동시설 입찰공고문.hwp
</a><br>
<!-- <a href="#">201410241998_1.hwp(26624byte) <img src="/resources/images/sub/ico_filedown.gif" alt="첨부파일 다운받기"></a> --></dd>
								</dl></td></tr>
</table></body></html>`;
let srv, ctx, sql, fake, kapt; const kg2bHits = [];
const get = async () => (await sql`select row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_external_id' = ${BID}`)[0]?.row;

before(async () => {
  kapt = fakeKapt({ detailHtml: (bid) => `<table class="contTbl"><tbody><tr> <th scope="col">입찰번호</th> <td colspan="3"> ${bid} </td> </tr>
<tr> <th scope="col">입찰분류</th> <td> 사업자 - 용역 - 주민운동시설의 위탁 </td> <th scope="col">신용평가등급확인서<br>제출여부</th> <td> 제출 </td> </tr>
<tr> <th scope="col">현장설명</th> <td> 공고문 참조 </td> <th scope="col">관리(공사용역)<br>실적증명서 제출여부</th> <td> 제출 </td> </tr></tbody></table>` });
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const send = (code, text, type = 'text/html; charset=utf-8') => { res.statusCode = code; res.setHeader('content-type', type); res.end(text); };
    if (u.pathname === '/kapt/bid/bidList.do') return send(200, `<html><table>${u.searchParams.get('pageNo') === '1' ? tr(BID, ['1', 'KG2B', 'APT적격심사', TITLE, `${plus(9)} 09:00`, '신규공고', '시험팔이팔푸르지오', `${plus(-3)} 18:46`]) : ''}</table></html>`);
    if (u.pathname === '/kaptbidapi/getPblAncDeSearchV3') return send(200, JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' }, body: { items: [], numOfRows: 100, pageNo: 1, totalCount: 0 } } }), 'application/json');
    if (u.pathname === '/kg2b/common/util/download') return send(200, Buffer.from('HWP Document File 5.0 시험 공고문'), 'application/octet-stream');
    if (u.pathname === '/kg2b/user/bid_list/KaptBidView') { kg2bHits.push(u.searchParams.get('bidcode')); return u.searchParams.get('bidcode') === CODE ? send(200, KG2B) : send(404, 'no'); }
    if (kapt.handle(req, res, body)) return;
    send(404, 'nope');
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}`, SALES_FILE_HOSTS: 'localhost' }); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('kg2b_ 공고: KG2B 상세에서 공고번호·입찰 개시·개찰(일시·장소)·참가 제한 지역·현장설명 없음·공고문 → 공고 줄 · 담당자 칸 저장 안 함 · 다시 안 읽음 · 카드 첨부', async () => {
  // 이미 넘긴 업무(첨부 0) — 첫 수집으로 공고 줄을 만든 뒤 업무를 걸고, 같은 공고 줄을 '아직 안 읽음'으로 되돌려 다시 수집
  const r0 = await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  assert.match(r0.summary, /KG2B 상세 1건\(공고문 1\)/, r0.summary);
  const [row0] = await sql`select src_id from sales_src_rows where tbl = 'procurement_notices' and row->>'source_external_id' = ${BID}`;
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: `[입찰] ${TITLE}`, assigneeId: ctx.staffA.id, approvalRequired: false });
  await sql`update tasks set sales_ref = ${sql.json({ kind: 'bid', id: row0.src_id, name: TITLE, bid: true })}, space = 'sales' where id = ${t.id}`;
  await sql`update sales_src_rows set row = row - 'kg2b_read_at' - 'kg2b_v' - 'attachment_urls' - 'notice_file_url' where src_id = ${row0.src_id}`; kg2bHits.length = 0;
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  assert.match(r.summary, /KG2B 상세 1건\(공고문 1, 넘긴 업무 1건에 붙임\)/, r.summary);
  const att = await sql`select file_name, source from attachments where task_id = ${t.id} and deleted_at is null`;
  assert.deepEqual(att.map((a) => [a.file_name, a.source]), [['주민공동시설 입찰공고문.hwp', 'sales_auto']], '이미 넘긴 업무에도 공고문');
  assert.deepEqual(kg2bHits, [CODE]);
  const x = await get();
  assert.ok(x, '공고 줄'); assert.equal(x.related, true, x.fit_business);
  assert.deepEqual([x.kg2b_notice_no, x.bid_start_at, x.opening_at, x.opening_place, x.region_restriction, x.site_briefing_kind, x.kg2b_briefing_kind],
    ['202610281060-00', `${plus(-3)}T17:00:00+09:00`, `${plus(9)}T10:00:00+09:00`, '입찰 담당자PC', '전국', '공고문 참조', '없음']);
  assert.equal(x.kg2b_url, `http://localhost:${PORT}/kg2b/user/bid_list/KaptBidView?bidcode=${CODE}`);
  assert.equal(x.attachment_urls.length, 1); const f = x.attachment_urls[0];
  assert.equal(f.name, '주민공동시설 입찰공고문.hwp');
  assert.equal(f.url, `http://localhost:${PORT}/kg2b/common/util/download?file=646BD8D2-5523-1646-0CDF-D497D8968AAD.hwp&filepath=20261028%2F&type=bid&name=${encodeURIComponent('주민공동시설 입찰공고문.hwp')}`);
  assert.equal(x.notice_file_url, f.url);
  const raw = JSON.stringify(x); assert.ok(!raw.includes('홍길동') && !raw.includes('관리소장'), '담당자 칸은 저장 안 함');
  // 다시 수집: 공고문이 있으니 KG2B 를 다시 묻지 않음 · K-apt 상세(첨부 0)가 공고문을 지우지 않음
  await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', { full: true });
  assert.deepEqual(kg2bHits, [CODE], '다시 안 읽음');
  assert.equal((await get()).attachment_urls.length, 1, 'K-apt 재수집이 공고문을 지우지 않음');
  // 목록 카드: 첨부(공고문) · 현장설명 없음
  const card = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all')).items.find((n) => n.noticeNo === BID);
  assert.ok(card, '카드'); assert.ok(card.attachments.some((a) => /입찰공고문/.test(a.name ?? '')), JSON.stringify(card.attachments));
  assert.equal(card.briefing, null, "K-apt '공고문 참조'보다 KG2B '현장설명회 없음' — 현설 없음");
});
