// 373차 #996(대표 11/05 "KG2B 에서도 긁어 오고 있는가? 산업단지는 KG2B 에 올라오는 경우가 간혹 있음") — KG2B 자체 입찰 목록 미리 보기:
// 목록 한 장(GET /user/bid_list/bidAll) → 다음 장은 같은 화면 theForm 의 __encrypted 와 쿠키로 POST(method=bidAlllist·currentPage) → '이미 있음 / 새로 / 관련 / 건물 종류' 세기만, 저장 안 함
// (구조 시험 — 가짜 KG2B 화면은 11/05 실제 bidAll 목록 줄 모양 그대로: notinum·goAction('view','코드')·<p>발주처·<h4>지역·<h5>개찰일. 실제 KG2B 연결은 운영 확인 몫)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

const PORT = 3296;
const today = seoulToday(); const ymd = (d) => d.replace(/-/g, ''); const short = (d) => d.slice(2);
const row = (no, code, title, issuer, ind, region, posted) => `<tr> <td><label for="listno">${no}</label></td> <td class="info_index_ico left"> <img src="/i/k02.gif" alt="전자"> <img src="/i/k03.gif" alt="현설">
 <p class="notinum">${ymd(posted)}1036-00</p></td> <td class="table_left lnone"><a href="javascript:goAction('view','${code}','','1');">${title} </a><p>${issuer}</p> </td>
 <td class="left">${ind}<h4>${region}</h4></td> <td class="intiger">${short(addDays(posted, 6))} 14:00<h5>${short(addDays(posted, 12))} 10:00</h5></td> <td id="timer1">3일</td>
 <script type="text/javascript"> function timerDown1(){ document.write('<td>x</td>'); } </script> </tr>`;
const page = (rows, enc) => `<html><body><form theme="simple" id="incHead" name="thisHeadForm" method="post"><input type="hidden" name="__encrypted" value="HEADTOKEN"></form>
 <form theme="simple" name="theForm" method="post"><input type="hidden" name="currentPage" id="currentPage" value="1"/><input type="hidden" name="__encrypted" value="${enc}"></form>
 <div>공고수 : 736건 [1/74]</div><table class="list_t">${rows.join('\n')}</table></body></html>`;
const P1 = page([
  row(736, '996001', '경비용역 업체 선정 입찰공고', '시험996두산아파트', '경비', '서울', today),
  row(735, '996002', '피트니스센터 위탁운영 업체 선정 입찰공고', '시험996지식산업센터 관리단', '용역', '경기', today),
  row(734, '996003', '주차관제시스템 교체공사 입찰공고', '시험996빌딩 관리단', '정보통신공사', '전국', addDays(today, -1)),
], 'TOKEN1');
const P2 = page([row(700, '996004', '오래된 청소용역 입찰공고', '시험996오래된아파트', '청소', '서울', addDays(today, -20))], 'TOKEN2');
let srv, ctx, sql, fake; const seen = [];
before(async () => {
  fake = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body, cookie: req.headers.cookie ?? '' });
      if (!req.url.startsWith('/kg2b/user/bid_list/bidAll')) { res.writeHead(404); return res.end('no'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': 'JSESSIONID=sess996; Path=/' });
      const f = new URLSearchParams(body);
      // 열쇠·쿠키가 맞아야 2장 — 틀리면 1장을 다시 줌(실제 KG2B 처럼 새 줄 없음)
      res.end(req.method === 'POST' && f.get('method') === 'bidAlllist' && f.get('currentPage') === '2' && f.get('__encrypted') === 'TOKEN1' && /JSESSIONID=sess996/.test(req.headers.cookie ?? '') ? P2 : P1);
    });
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}` }); sql = testDb(); ctx = await bootstrap();
  await sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'procurement_notices', '00000000-0000-4000-8000-000000996001',
    ${sql.json({ id: '00000000-0000-4000-8000-000000996001', source_type: 'kapt_bid', source_external_id: 'kg2b_996001', title: '경비용역 업체 선정 입찰공고', posted_date: today })})`;
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('KG2B 목록 미리 보기: 2장(열쇠·쿠키)·14일 안만·이미 있음/새로/관련·건물 종류 · 저장 안 함', async () => {
  const before = (await sql`select count(*)::int as n from sales_src_rows where tbl = 'procurement_notices'`)[0].n;
  const { kg2bList: k } = await ctx.owner.ok('GET', '/api/platform/sales-notices?kg2b=listpreview&pages=5&days=14');
  assert.equal(k.pagesRead, 2, JSON.stringify(k));
  assert.match(k.stop, /2장이 모두 14일 전/);
  assert.equal(k.total, 736);
  assert.equal(k.rows, 3, '20일 전 줄은 뺌');
  assert.equal(k.already, 1); assert.equal(k.notInDb, 2);
  assert.equal(k.alreadyExamples[0].code, '996001');
  const ex = Object.fromEntries(k.examples.map((x) => [x.code, x]));
  assert.equal(ex['996002'].kind, '산업단지·지식산업센터'); assert.equal(ex['996002'].issuer, '시험996지식산업센터 관리단');
  assert.equal(ex['996002'].noticeNo, `${ymd(today)}1036-00`); assert.equal(ex['996002'].posted, today); assert.equal(ex['996002'].region, '경기');
  assert.equal(ex['996002'].openingAt, `${addDays(today, 12)}T10:00:00+09:00`);
  assert.equal(ex['996003'].kind, '집합건물·상가·오피스텔');
  assert.ok(k.byKind['공동주택(추정)'].n === 1 && k.byKind['공동주택(추정)'].notInDb === 0);
  assert.equal(k.byDay[today], 2); assert.equal(k.saved, 0);
  const post = seen.find((s) => s.method === 'POST');
  assert.ok(post && /__encrypted=TOKEN1/.test(post.body) && /JSESSIONID=sess996/.test(post.cookie), '다음 장은 화면 열쇠·쿠키로');
  assert.equal((await sql`select count(*)::int as n from sales_src_rows where tbl = 'procurement_notices'`)[0].n, before, '저장 안 함');
});

test('374차 KG2B 연결 점검(이름 찾기·연결·첫 화면·목록) · 서울 지역 주소도 같은 결과 · 플랫폼 운영자만', async () => {
  for (const path of ['/api/platform/sales-notices?kg2b=probe', '/api/platform/kg2b?do=probe']) {
    const { kg2bProbe: p } = await ctx.owner.ok('GET', path);
    assert.ok(p.dns.ok && p.tcp.ok, JSON.stringify(p)); assert.equal(p.port, PORT);
    assert.equal(p.main.ok, true); assert.equal(p.main.status, 404, '가짜 KG2B 는 첫 화면 404');
    assert.equal(p.list.ok, true); assert.equal(p.list.rows, 3);
  }
  const { kg2bList } = await ctx.owner.ok('GET', '/api/platform/kg2b?do=listpreview&pages=2&days=14');
  assert.equal(kg2bList.rows, 3); assert.ok('region' in kg2bList);
  const r = await ctx.staffA.client.req('GET', '/api/platform/kg2b?do=probe'); assert.equal(r.status, 404, '운영자 아니면 숨김');
});
