// 대표 11/14 "서버 오류나 영업 DB 누락된 것들이 있다 확인해서 조치할 것" — KG2B 이어 읽기
// 정기 수집은 최근 5장(50줄, 06시대는 8장)만 읽는다. 11/11·11/12 평일 오후 실행 기록에서 4시간 사이 공고가 40~50줄 올라와
// 앞 수집과 겹친 줄이 1~2줄뿐이었다 — 공고가 더 몰리거나 원천이 몇 시간 안 열린 뒤에는 그 사이 공고가 조용히 빠질 수 있었다.
// 이제: 정해 둔 장수를 다 읽고도 이미 받아 둔 KG2B 공고가 하나도 안 보이면(앞 수집과 안 이어짐) 이어질 때까지 다음 장도 읽는다(최대 14장·시간 한도 안, 1.2초 간격 그대로).
//       앞 수집과 이어져 있으면 예전과 같은 장수만 읽는다.
// (구조 시험 — 가짜 KG2B 목록. 실제 KG2B 연결은 운영 실행 기록으로 확인)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const PORT = 3364;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date()); const ymd = today.replace(/-/g, '');
const kstHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date())) % 24;
const BASE_PAGES = kstHour < 10 ? 8 : 5; // 수집기 규칙: 06시대(10시 전)는 8장, 그 밖은 5장
const TOTAL = 100; // 목록 100줄(10장) — 1번이 가장 새 공고
const code = (i) => String(1114000 + i);
const row = (i) => `<tr> <td><label for="listno${i}">${900 - i}</label> <br> </td> <td class="info_index_ico left"> <img src="/resources/images/common/noti_kind02.gif" border="0" alt="전자"> <p class="notinum">${ymd}2${String(i).padStart(3, '0')}-00</p></td>
 <td class="table_left lnone"><a href="javascript:goAction('view','${code(i)}','','1');">경비용역 업체 선정 입찰공고 ${i} </a><p>시험1114빌딩 관리단 ${i}</p> </td> <td class="left">경비<h4>전국</h4></td> <td class="intiger">---<h5>${today.slice(2)} 09:00</h5></td> <td id="timer${i}">9일</td>
 <script type="text/javascript"> timerDown${i}("777600",""); </script> </tr>`;
const page = (n) => `<html><body><form theme="simple" name="theForm" method="post"><input type="hidden" name="__encrypted" value="T${n}"></form><div>공고수 : ${TOTAL}건 [${n}/10]</div><table class="list_t">${Array.from({ length: 10 }, (_, k) => (n - 1) * 10 + k + 1).filter((i) => i <= TOTAL).map(row).join('\n')}</table></body></html>`;
let pages = []; let gaps = [];
let srv, ctx, sql, fake;
const stored = async () => new Set((await sql`select row->>'source_external_id' as ext from sales_src_rows where tbl = 'procurement_notices' and scope = 'global' and row->>'source_external_id' like 'kg2b_1114%'`).map((r) => Number(r.ext.slice(5)) - 1114000));

before(async () => {
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const send = (st, text) => { res.statusCode = st; res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(text); };
    if (u.pathname === '/kg2b/user/bid_list/bidAll') {
      const n = req.method === 'POST' ? Number(new URLSearchParams(body).get('currentPage')) : 1;
      if (pages.length) gaps.push(Date.now() - pages.at(-1).at);
      pages.push({ n, at: Date.now() });
      return send(200, page(n));
    }
    send(404, 'nope');
  }).listen(PORT);
  await resetDb();
  srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}`, SALES_FILE_HOSTS: 'localhost', KR_RELAY: 'force' /* 운영처럼 서울 중계로 */ });
  sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  // 앞 수집에서 받아 둔 공고: 목록의 91~100번째 줄(10장째) — 그 사이 90줄이 새로 올라온 상황
  for (let i = 91; i <= TOTAL; i++) {
    const id = `00000000-0000-4000-8000-0000${String(11140000 + i)}`;
    await sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'procurement_notices', ${id},
      ${sql.json({ id, source_type: 'kg2b_bid', source_external_id: `kg2b_${code(i)}`, title: `경비용역 업체 선정 입찰공고 ${i}`, posted_date: today, related: false })})`;
  }
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('앞 수집과 안 이어졌으면 이어질 때까지 다음 장도 읽음 — 사이 공고가 빠지지 않음 · 요청 간격 1.2초 그대로', async () => {
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/kg2b_bid_notices/run', {});
  assert.notEqual(r.status, 'failed', r.summary);
  assert.deepEqual(pages.map((p) => p.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], `정해 둔 ${BASE_PAGES}장 뒤에도 10장(이미 받아 둔 공고가 보이는 장)까지: ${r.summary}`);
  assert.match(r.summary, /KG2B 목록 10장 100건/, r.summary);
  assert.match(r.summary, new RegExp(`앞 수집과 이어질 때까지 ${10 - BASE_PAGES}장 더 읽음`), r.summary);
  const have = await stored();
  assert.equal(have.size, TOTAL, '100줄 모두 저장');
  for (const i of [BASE_PAGES * 10 + 1, 85, 90]) assert.ok(have.has(i), `${i}번째 줄 — 예전 방식(${BASE_PAGES}장)이면 빠졌을 공고`);
  assert.ok(gaps.every((g) => g >= 1150), `요청 간격 1.2초: ${gaps.join(',')}`);
});

test('앞 수집과 이어져 있으면 예전과 같은 장수만 읽음', async () => {
  pages = []; gaps = [];
  const r = await ctx.owner.ok('POST', '/api/sales/collectors/kg2b_bid_notices/run', {});
  assert.notEqual(r.status, 'failed', r.summary);
  assert.equal(pages.length, BASE_PAGES, r.summary);
  assert.doesNotMatch(r.summary, /더 읽음/, r.summary);
  assert.match(r.summary, new RegExp(`${BASE_PAGES}장까지\\(최대\\)`), r.summary);
});
