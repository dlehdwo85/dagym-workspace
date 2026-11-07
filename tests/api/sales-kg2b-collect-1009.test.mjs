// 383차 #1009·#1007·#1018(대표 11/07 "KG2B 수집 켜고 고객사도 확인할 수 있게" · "kg2b 원문 링크 말고 공고 관련 파일들도 다운받을 수 있도록"):
// KG2B 진행 공고 목록(로그인 없이 열림)을 정기 수집 — K-apt 에 없는 공고만 'kg2b_bid' 로 적재(K-apt 가 공유한 공고는 K-apt 줄이 맡음) ·
// 목록 줄의 남은 시간 타이머로 입찰 마감 · 관련 공고는 상세(현장설명·개찰·공고서)까지 · 공고서는 [첨부 받기](서울 중계)로 파일 그대로 ·
// 나중에 K-apt 가 같은 번호를 올리면 그 줄을 K-apt 줄로 이어 씀(같은 공고 한 줄) · 고객사 화면에도 보임
// (구조 시험 — 가짜 KG2B 화면은 11/07 실제 bidAll 목록 줄(notinum·goAction·<h4>참가 제한 지역·<h5>개찰·timerDownN("초"))과 KaptBidView 표 모양 그대로. 실제 KG2B 연결은 운영 확인 몫)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BASE, Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { fakeKapt, HWP5 } from '../fakeKapt.mjs';

const PORT = 3302;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date());
const plus = (n) => kst(new Date(Date.parse(`${today}T12:00:00+09:00`) + n * 864e5));
const ymd = (d) => d.replace(/-/g, ''); const short = (d) => d.slice(2);
const CLOSE = `${plus(9)}T17:00:00+09:00`;
// 목록 한 줄 — 실제처럼 줄 안에 남은 시간 타이머 스크립트(받는 순간의 남은 초)
const row = (n, code, title, issuer, ind, region, kinds = ['전자']) => `<tr> <td><label for="listno${n}">${800 - n}</label> <br> </td> <td class="info_index_ico left"> ${kinds.map((k) => `<img src="/resources/images/common/noti_kind02.gif" border="0" alt="${k}">`).join(' ')} <p class="notinum">${ymd(today)}10${n}0-00</p></td>
 <td class="table_left lnone"><a href="javascript:goAction('view','${code}','','1');">${title} </a><p>${issuer}</p> </td> <td class="left">${ind}<h4>${region}</h4></td> <td class="intiger">---<h5>${short(plus(10))} 09:00</h5></td> <td id="timer${n}">15일 12시간</td>
 <script type="text/javascript"> function timerDown${n}(cntdown,msg){ clearTimeout('timerDown${n}'); setTimeout('timerDown${n}('+(cntdown-1)+',\\''+msg+'\\')',999); } timerDown${n}("${Math.round((Date.parse(CLOSE) - Date.now()) / 1000)}",""); </script> </tr>`;
const ROWS = () => [
  row(1, '1009001', '피트니스센터 위탁운영 업체 선정 입찰공고', '시험1009지식산업센터 관리단', '위탁(식당/어린이집/자판기/검침)등', '경기', ['전자', '현설']),
  row(2, '1009002', '경비용역 업체 선정 입찰공고', '시험1009빌딩 관리단', '경비', '전국'),
  row(3, '1009003', '주민공동시설 위탁운영 사업자 선정 입찰공고', '시험1009푸르지오아파트', '위탁(식당/어린이집/자판기/검침)등', '충남'),
  row(4, '1009004', '커뮤니티센터 위탁운영 입찰공고', '시험1009케이앱트아파트', '위탁(식당/어린이집/자판기/검침)등', '서울'),
  row(5, '1009005', '청소용역 업체 선정 입찰공고', '시험1009상가 관리단', '위생(청소/소독/물탱크/세탁/병원폐기물)', '전국', ['전자', '취소']),
];
const page = () => `<html><body><form theme="simple" name="theForm" method="post"><input type="hidden" name="__encrypted" value="T1"></form><div>공고수 : 5건 [1/1]</div><table class="list_t">${ROWS().join('\n')}</table></body></html>`;
const detail = (code) => `<html><body><table class="table_view">
<tr><th>공고번호</th><td>${ymd(today)}1010-00</td><th>공고일시</th><td>${today} 09:10</td></tr>
<tr><th>공고구분</th><td>용역</td><th>낙찰방법</th><td>APT적격심사(수동)</td></tr>
<tr><th>업종</th><td>위탁(식당/어린이집/자판기/검침)등/</td><th>참가제한지역</th><td>전국</td></tr>
<tr><th>발주처</th><td>시험발주처${code}</td><th>담당자</th><td>관리소장 김시험</td></tr>
<tr><th>현장설명회실시유무</th><td> 필수 </td><th>현설일시</th><td>${plus(3)} 14:00</td></tr>
<tr><th>입찰개시일시</th><td>${today} 09:00</td><th>입찰마감일시</th><td>${plus(9)} 17:00</td></tr>
<tr><th>개찰일시</th><td>${plus(10)} 09:00</td><th>개찰장소</th><td>입찰 담당자PC</td></tr>
<tr><th>공고서</th><td><a href="javascript:goLoad('${ymd(today)}/','F${code}.hwp','bid','${code} 입찰공고문.hwp');">${code} 입찰공고문.hwp</a></td></tr></table></body></html>`;
const tr = (id, cells) => `<tr>${cells.map((c, i) => (i === 3 ? `<td><a href="javascript:goView('${id}')">${c}</a></td>` : `<td>${c}</td>`)).join('')}</tr>`;
let kaptList = []; const hits = { list: 0, detail: [], file: [] };
let srv, ctx, sql, fake, kapt;
const rowOf = async (code) => (await sql`select src_id, gone, row from sales_src_rows where tbl = 'procurement_notices' and row->>'source_external_id' = ${`kg2b_${code}`} order by gone, synced_at desc`);

before(async () => {
  kapt = fakeKapt({ detailHtml: () => '<table class="contTbl"><tbody><tr><th scope="col">입찰분류</th><td> 사업자 - 용역 - 주민운동시설의 위탁 </td></tr></tbody></table>' });
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const send = (code, text, type = 'text/html; charset=utf-8') => { res.statusCode = code; res.setHeader('content-type', type); res.end(text); };
    if (u.pathname === '/kg2b/user/bid_list/bidAll') { hits.list++; return send(200, page()); }
    if (u.pathname === '/kg2b/user/bid_list/KaptBidView') { hits.detail.push(u.searchParams.get('bidcode')); return send(200, detail(u.searchParams.get('bidcode'))); }
    if (u.pathname === '/kg2b/common/util/download') { hits.file.push(u.searchParams.get('file')); res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(u.searchParams.get('name') ?? 'x.hwp')}` }); return res.end(HWP5); }
    if (u.pathname === '/kapt/bid/bidList.do') return send(200, `<html><table>${u.searchParams.get('pageNo') === '1' ? kaptList.join('') : ''}</table></html>`);
    if (u.pathname === '/kaptbidapi/getPblAncDeSearchV3') return send(200, JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' }, body: { items: [], numOfRows: 100, pageNo: 1, totalCount: 0 } } }), 'application/json');
    if (kapt.handle(req, res, body)) return;
    send(404, 'nope');
  }).listen(PORT);
  await resetDb();
  srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}`, SALES_FILE_HOSTS: 'localhost', KR_RELAY: 'force' /* 운영(싱가포르)처럼 KG2B 목록·상세·공고서를 서울 중계로 */, PUBLIC_SIGNUP: '1', MAIL_DEV: '1' });
  sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  // K-apt 가 이미 'kg2b_1009004'로 공유한 공고
  await sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'procurement_notices', '00000000-0000-4000-8000-000001009004',
    ${sql.json({ id: '00000000-0000-4000-8000-000001009004', source_type: 'kapt_bid', source_external_id: 'kg2b_1009004', title: '커뮤니티센터 위탁운영 입찰공고', posted_date: today, related: true, fit_business: '다짐' })})`;
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('정기 수집: K-apt 에 없는 공고만 kg2b_bid · 목록 타이머로 입찰 마감 · 관련 공고는 상세(현설·개찰·공고서) · 취소 그림은 취소 · 담당자 칸 저장 안 함', async () => {
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/kg2b_bid_notices/run', {});
  assert.notEqual(r.status, 'failed', r.summary);
  assert.match(r.summary, /KG2B 목록 \d장 5건/, r.summary);
  assert.match(r.summary, /K-apt 에 이미 있음 1 · K-apt 에 없는 공고 4건\(새로 4: .*공동주택\(추정\) 1 · 관련 2\)/, r.summary);
  assert.match(r.summary, /KG2B 상세 2건\(공고서 2\)/, r.summary);
  assert.match(r.summary, /적재 신규 4/, r.summary);
  assert.deepEqual([...hits.detail].sort(), ['1009001', '1009003'], '관련 공고만 상세');
  const [a] = await rowOf('1009001'); const x = a.row;
  assert.deepEqual([x.source_type, x.related, x.fit_business, x.deadline_at, x.bid_system, x.region_restriction, x.issuer], ['kg2b_bid', true, '다짐', CLOSE, 'KG2B전자입찰', '경기', '시험1009지식산업센터 관리단']);
  assert.equal(x.source_url, `http://localhost:${PORT}/kg2b/user/bid_list/KaptBidView?bidcode=1009001`);
  assert.deepEqual([x.site_briefing_kind, x.kg2b_briefing_kind, x.kg2b_briefing_at, x.opening_at, x.opening_place, x.kg2b_notice_no], ['필수', '필수', `${plus(3)}T14:00:00+09:00`, `${plus(10)}T09:00:00+09:00`, '입찰 담당자PC', `${ymd(today)}1010-00`]);
  assert.equal(x.attachment_urls.length, 1); assert.equal(x.attachment_urls[0].name, '1009001 입찰공고문.hwp');
  assert.ok(!JSON.stringify(x).includes('김시험'), '담당자 칸 저장 안 함');
  const [b] = await rowOf('1009002'); assert.equal(b.row.related, false, '경비용역은 관련 아님'); assert.equal(b.row.deadline_at, CLOSE, '관련 아니어도 목록 타이머로 마감');
  const [c] = await rowOf('1009003'); assert.equal(c.row.fit_business, '다짐', '아파트 발주 = 공동주택 맥락');
  const [e] = await rowOf('1009005'); assert.equal(e.row.current_status, '취소'); assert.equal(e.row.notice_kind, 'cancel');
  assert.equal((await rowOf('1009004')).length, 1, 'K-apt 가 공유한 공고는 새 줄 없음');
  // 다시 수집: 같은 공고는 그대로(새 줄 없음) · 상세는 공고서가 있으니 다시 안 읽음
  hits.detail.length = 0;
  const r2 = await ctx.owner.ok('POST', '/api/sales/collectors/kg2b_bid_notices/run', {});
  assert.match(r2.summary, /새로 0/, r2.summary); assert.match(r2.summary, /적재 신규 0/, r2.summary);
  assert.deepEqual(hits.detail, []);
});

test('#1018 공고서 내려받기: 입찰 카드 첨부 → [첨부 받기](서울 중계) 가 KG2B 파일 그대로 · 원천 이름 KG2B', async () => {
  const card = (await ctx.owner.ok('GET', `/api/sales/src?view=bids&tab=all&q=${encodeURIComponent('피트니스센터 위탁운영')}`)).items.find((n) => n.noticeNo === 'kg2b_1009001');
  assert.ok(card, '입찰 목록 카드'); assert.equal(card.source, 'kg2b_bid');
  const f = card.attachments.find((a) => /입찰공고문/.test(a.name ?? '')); assert.ok(f, JSON.stringify(card.attachments));
  const res = await fetch(`${BASE}/api/bids/file?u=${encodeURIComponent(f.url)}&n=${encodeURIComponent(f.name)}`, { headers: { cookie: ctx.owner.cookie, origin: BASE } });
  assert.equal(res.status, 200);
  const buf = Buffer.from(await res.arrayBuffer()); assert.equal(buf.subarray(0, 8).toString('hex'), 'd0cf11e0a1b11ae1', 'HWP 파일 그대로');
  assert.match(decodeURIComponent(res.headers.get('content-disposition') ?? ''), /1009001 입찰공고문\.hwp/);
  assert.ok(hits.file.includes('F1009001.hwp'));
});

test('나중에 K-apt 가 같은 kg2b 번호를 올리면 KG2B 줄을 K-apt 줄로 이어 씀(같은 공고 한 줄 · 줄 번호 그대로)', async () => {
  const [before0] = await rowOf('1009003');
  kaptList = [tr('kg2b_1009003', ['1', 'KG2B', 'APT적격심사', '[충남천안] 주민공동시설 위탁운영 사업자 선정 입찰공고', `${plus(9)} 17:00`, '신규공고', '시험1009푸르지오아파트', `${today} 09:10`])];
  await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  const rows = (await rowOf('1009003')).filter((x) => !x.gone);
  assert.equal(rows.length, 1, JSON.stringify(rows.map((x) => [x.src_id, x.row.source_type])));
  assert.equal(rows[0].src_id, before0.src_id, '줄 번호 그대로(진행 기록·업무 연결 유지)');
  assert.equal(rows[0].row.source_type, 'kapt_bid'); assert.ok(rows[0].row.kg2b_adopted_at);
  assert.equal(rows[0].row.attachment_urls.length, 1, 'KG2B 공고서 그대로');
  // 그다음 KG2B 수집은 이 공고를 'K-apt 에 이미 있음'으로 셈
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/kg2b_bid_notices/run', {});
  assert.match(r.summary, /K-apt 에 이미 있음 2 · K-apt 에 없는 공고 3건/, r.summary);
});

test('고객사도 KG2B 공고를 봄(수집기 목록 연결됨 · 입찰 목록)', async () => {
  const cust = new Client('cust-1009');
  const form = { password: 'signup-pass-1234', agree: { terms: true, age14: true, privacy: true, ai: true, marketing: false }, email: 'boss@kg2b-1009.test', name: '공고대표', mode: 'team', company: '공고회사' };
  const s = await cust.ok('POST', '/api/auth/signup', form);
  await cust.ok('POST', '/api/auth/verify', { token: s.devLink.split('/').pop() });
  await cust.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const c = (await cust.ok('GET', '/api/sales/collectors')).collectors.find((x) => x.slug === 'kg2b_bid_notices');
  assert.ok(c, '고객사 수집기 목록에 KG2B'); assert.equal(c.state, 'connected'); assert.equal(c.source, null, '원천 주소는 고객에게 안 보임');
  const items = (await cust.ok('GET', `/api/sales/src?view=bids&tab=all&q=${encodeURIComponent('시험1009')}`)).items;
  assert.ok(items.some((n) => n.noticeNo === 'kg2b_1009001'), JSON.stringify(items.map((n) => n.noticeNo)));
  assert.equal(items.find((n) => n.noticeNo === 'kg2b_1009001').source, 'kg2b_bid');
});
