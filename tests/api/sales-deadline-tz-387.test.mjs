// 387차(대표 11/10 "왜 스케줄 생성이 일정에 맞게 생성되지를 않는지?" — 더샵일산퍼스트월드1단지 공고(K-apt·KG2B 모두 입찰 마감 11/11 17:00)의
// 입찰 업무 마감·캘린더 일정이 08:00): 공고 시각 정리(ts)가 시간대('+00:00'·'Z')를 버리고 숫자만 한국 시각으로 읽어 9시간 당겨졌고, 일정 계산(when)도
// DB 글자 시간대 '+00'(두 자리)을 못 알아봤다. K-apt 다시 확인(241차)은 저장된(잘못된) 마감을 목록보다 먼저 써서 다음 수집에서도 그대로였다.
// → 시간대가 붙은 시각은 그 순간 그대로 한국 시각으로 · K-apt 상세의 '입찰서제출마감일'로 바로잡음 · 마감 이틀 안 공고는 매번 다시 확인 ·
//   바로잡히면 정기 점검이 입찰 업무 마감과 회사 캘린더 일정을 17:00 으로 옮김 (구조 시험 — 가짜 K-apt 상세는 11/10 실제 화면의 '입찰서제출마감일' 칸 모양)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { fakeKapt } from '../fakeKapt.mjs';

const PORT = 3387;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date());
const plus = (n) => kst(new Date(Date.parse(`${today}T12:00:00+09:00`) + n * 864e5));
const tr = (id, cells) => `<tr>${cells.map((c, i) => (i === 3 ? `<td><a href="javascript:goView('${id}')">${c}</a></td>` : `<td>${c}</td>`)).join('')}</tr>`;
const N = { A: 'kg2b_387001', B: 'kg2b_387002', D: 'kg2b_387004' };
const DUE = { A: plus(2), B: plus(2), D: plus(3) };
let srv, ctx, sql, fake, kapt;
const row = (k, deadline) => ({ id: `src387${k}`, source_type: 'kapt_bid', source_external_id: N[k], source_url: `https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=${N[k]}`,
  title: `[경기] 주민공동시설(커뮤니티) 위탁운영 사업자 선정 입찰 공고 ${k}`, complex_name: `시험387${k}단지`, issuer: `시험387${k}단지`, facility_name: `시험387${k}단지`, related: true, fit_business: '다짐',
  matched_keywords: ['주민공동', '위탁운영'], classification: '즉시 검토', current_status: '진행중', notice_state: '신규공고', notice_kind: 'new', posted_date: plus(-15), deadline_at: deadline,
  bid_system: 'KG2B전자입찰', award_method: '적격심사', first_seen_at: new Date(Date.now() - 15 * 864e5).toISOString(), updated_at: new Date(Date.now() - 864e5).toISOString(),
  detail_seen_at: new Date(Date.now() - 3600e3).toISOString() });
const get = async (k) => (await sql`select row from sales_src_rows where tbl = 'procurement_notices' and src_id = ${`src387${k}`}`)[0]?.row;
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); return (await r.json()).detail ?? {}; };
const evOf = async (id) => (await sql`select to_char(start_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') s, to_char(end_at at time zone 'Asia/Seoul', 'HH24:MI') e from events where id = ${id}`)[0];
const taskOf = async (id) => (await sql`select due_date::text d, to_char(due_time, 'HH24:MI') t from tasks where id = ${id}`)[0];

before(async () => {
  // 상세 화면: 입찰서제출마감일(실제 K-apt 11/10 kg2b_142551 '2026-11-11 17:00:00')
  kapt = fakeKapt({ detailHtml: (bid) => `<table class="contTbl"><tbody><tr> <th scope="col">입찰번호</th> <td colspan="3"> ${bid} </td> </tr>
<tr> <th scope="col">입찰분류</th> <td> 사업자 - 용역 - 주민운동시설의 위탁 </td> <th scope="col">입찰서제출마감일</th> <td> ${DUE[Object.keys(N).find((k) => N[k] === bid)] ?? plus(9)} 17:00:00 </td> </tr>
<tr> <th scope="col">현장설명</th> <td> 현장설명회없음 </td> <th scope="col">신용평가등급확인서<br>제출여부</th> <td> 제출 </td> </tr></tbody></table>` });
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const send = (code, text, type = 'text/html; charset=utf-8') => { res.statusCode = code; res.setHeader('content-type', type); res.end(text); };
    // 목록(최신)에는 관련 없는 공고 1건만 — A·B·D 는 목록 밖(마감 전 관련 공고 다시 확인 대상)
    if (u.pathname === '/kapt/bid/bidList.do') return send(200, `<html><table>${u.searchParams.get('pageNo') === '1' ? tr('kg2b_387009', ['1', 'KG2B', '최저낙찰', '[서울] 시험387새아파트 승강기 교체공사', `${plus(9)} 17:00`, '신규공고', '시험387새아파트', `${today} 09:10`]) : ''}</table></html>`);
    if (u.pathname === '/kaptbidapi/getPblAncDeSearchV3') return send(200, JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' }, body: { items: [], numOfRows: 100, pageNo: 1, totalCount: 0 } } }), 'application/json');
    if (kapt.handle(req, res, body)) return;
    send(404, 'nope');
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}` }); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  const put = (r) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${r.id}, ${sql.json(r)}, 'workin')`;
  await put(row('A', `${DUE.A}T08:00:00+00:00`)); // 원본 복사 꼴(세계 표준시) = 한국 17:00
  await put(row('B', `${DUE.B}T08:00:00+09:00`)); // 이미 9시간 당겨져 저장된 줄(운영 사례)
  await put(row('D', `${DUE.D} 08:00:00+00`)); // DB 글자 꼴 시간대 두 자리
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('공고 시각 정리: 시간대가 붙은 시각은 그 순간 그대로 한국 시각 · 시간대 없는 시각·날짜만은 예전처럼', async () => {
  const P = await import('../../src/lib/sales/collectors/procurement.ts'); // 순수 함수 — Node 22 형식 제거로 .ts 직접
  assert.equal(P.ts('2026-11-11T08:00:00+00:00'), '2026-11-11T17:00:00+09:00');
  assert.equal(P.ts('2026-11-11T08:00:00.000Z'), '2026-11-11T17:00:00+09:00');
  assert.equal(P.ts('2026-11-11 08:00:00+00'), '2026-11-11T17:00:00+09:00');
  assert.equal(P.ts('2026-11-11T20:30:00+0000'), '2026-11-12T05:30:00+09:00', '날짜가 넘어가는 시각');
  assert.equal(P.ts('2026-11-11T17:00:00+09:00'), '2026-11-11T17:00:00+09:00', '한국 시각은 그대로');
  assert.equal(P.ts('2026-11-11 17:00:00'), '2026-11-11T17:00:00+09:00', '시간대 없는 원천 시각 = 한국');
  assert.equal(P.ts('20261111 1700'), '2026-11-11T17:00:00+09:00');
  assert.equal(P.ts('2026-11-11'), '2026-11-11T23:59:00+09:00', '날짜만(끝의 -11 을 시간대로 읽지 않음)');
  assert.equal(P.zonedKst('2026-11-11'), null);
});

test('넘기기: 시간대 두 자리(+00) 마감도 17:00 업무·일정 · K-apt 다시 확인이 9시간 당겨진 마감을 상세로 바로잡고 정기 점검이 업무·일정을 옮김', async () => {
  // D: 저장 꼴 '… 08:00:00+00' → 넘기기 일정·업무 마감 17:00(예전엔 08:00)
  const d = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'src387D', assigneeIds: [ctx.staffA.id] });
  assert.deepEqual([d.due, d.dueTime], [DUE.D, '17:00']);
  assert.equal((await evOf(d.eventIds[0])).s, `${DUE.D} 17:00`);
  // B: 운영 사례 — 이미 08:00(+09:00)으로 저장된 줄로 넘긴 업무·일정은 08:00
  const b = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'src387B', assigneeIds: [ctx.staffA.id, ctx.ownerId] });
  assert.deepEqual([b.dueTime, (await evOf(b.eventIds[0])).s], ['08:00', `${DUE.B} 08:00`], '재현: 잘못된 마감 그대로');
  // K-apt 수집 — 목록에 없는 마감 전 관련 공고를 다시 확인(마감 이틀 안 먼저) → 상세 '입찰서제출마감일' 17:00 으로
  await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  const asked = kapt.calls.filter((c) => c.path === '/kapt/bid/bidDetail.do').map((c) => c.q.bidNum);
  for (const k of ['A', 'B', 'D']) assert.ok(asked.includes(N[k]), `${k} 상세 다시 읽음`);
  assert.equal((await get('A')).deadline_at, `${DUE.A}T17:00:00+09:00`, 'A: 세계 표준시 08:00 = 한국 17:00(예전엔 08:00+09:00 으로 바뀜)');
  assert.equal((await get('B')).deadline_at, `${DUE.B}T17:00:00+09:00`, 'B: 상세 값으로 바로잡음');
  assert.equal((await get('D')).deadline_at, `${DUE.D}T17:00:00+09:00`);
  // 정기 점검: 공고 마감이 바뀌었으니 업무 마감·일정을 옮김
  await tick();
  assert.deepEqual(await taskOf(b.taskId), { d: DUE.B, t: '17:00' });
  assert.deepEqual(await evOf(b.eventIds[0]), { s: `${DUE.B} 17:00`, e: '18:00' });
  assert.deepEqual(await taskOf(d.taskId), { d: DUE.D, t: '17:00' }, 'D 는 그대로 17:00');
  // 다시 수집해도 17:00 그대로(저장 값을 다시 읽어도 바뀌지 않음)
  await ctx.owner.ok('POST', '/api/sales/collectors/kapt_bid_notices/run', {});
  for (const k of ['A', 'B', 'D']) assert.equal((await get(k)).deadline_at, `${DUE[k]}T17:00:00+09:00`, `${k} 다시 수집 뒤에도 17:00`);
});
