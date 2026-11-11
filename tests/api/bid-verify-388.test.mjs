// 388차(대표 11/10 "아직도 그 공고가 일정에 맞게 스케줄링되어 있지 않다 · 스케줄에는 공고에서 올라오는 현장설명회와 입찰 마감일자가 표기될 수 있도록 ·
// 담당자 체크된 모든 인원에게"): 수집기 시각(06·10·14·18시)을 기다리지 않고 정기 실행마다 넘긴 공고의 원천 상세(KG2B·K-apt)를 다시 읽어
// 입찰 마감·현장설명회를 바로잡음 → 업무 마감·입찰 마감 일정 옮김 · 현장설명회 일정 새로 만듦 · 일정 참석자 = 업무 담당자 전원(넘긴 뒤 더한 함께 담당 포함, 빠진 사람은 뺌)
// (구조 시험 — 가짜 KG2B·K-apt 상세는 실제 화면 칸 이름 그대로. 운영 원천에서 실제로 바뀌는지는 노트북 확인 몫)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { fakeKapt } from '../fakeKapt.mjs';

const PORT = 3388;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date());
const plus = (n) => kst(new Date(Date.parse(`${today}T12:00:00+09:00`) + n * 864e5));
const D = plus(2), B = plus(1), CODE = '388001', EXT = `kg2b_${CODE}`;
const KG2B = `<html><body><table class="tbl">
<tr><th>공고번호</th><td>202611100388-00</td><th>입찰방법</th><td>전자입찰</td></tr>
<tr><th>현장설명회실시유무</th><td> 필수 </td><th>현설일시</th><td><span class="red2"> ${B} 14:00 </span></td></tr>
<tr><th>입찰개시일시</th><td>${plus(-5)} 16:00</td><th>입찰마감일시</th><td>${D} 17:00</td></tr>
<tr><th>개찰일시</th><td>${D} 18:00</td><th>개찰장소</th><td>입찰 담당자PC</td></tr></table></body></html>`;
let srv, ctx, sql, fake, kapt; const kg2bHits = [];
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); return (await r.json()).detail ?? {}; };
const evOf = async (id) => (await sql`select title, description, to_char(start_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') s, (select array_agg(user_id::text order by user_id) from event_attendees a where a.event_id = e.id) att from events e where id = ${id}`)[0];
const work = async () => (await sql`select data from sales_work_records where tenant = 'default' and src_tbl = 'opportunity_work' and ref_id = 'src388'`)[0]?.data;
const sorted = (a) => [...a].sort();

before(async () => {
  kapt = fakeKapt({ detailHtml: (bid) => `<table class="contTbl"><tbody><tr> <th scope="col">입찰번호</th> <td colspan="3"> ${bid} </td> </tr>
<tr> <th scope="col">입찰분류</th> <td> 사업자 - 용역 - 주민운동시설의 위탁 </td> <th scope="col">입찰서제출마감일</th> <td> ${D} 17:00:00 </td> </tr>
<tr> <th scope="col">현장설명</th> <td> 공고문 참조 </td> <th scope="col">신용평가등급확인서<br>제출여부</th> <td> 제출 </td> </tr></tbody></table>` });
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const send = (code, text, type = 'text/html; charset=utf-8') => { res.statusCode = code; res.setHeader('content-type', type); res.end(text); };
    if (u.pathname === '/kg2b/user/bid_list/KaptBidView') { kg2bHits.push(u.searchParams.get('bidcode')); return u.searchParams.get('bidcode') === CODE ? send(200, KG2B) : send(404, 'no'); }
    if (u.pathname === '/kapt/bid/bidList.do') return send(200, '<html><table></table></html>');
    if (kapt.handle(req, res, body)) return;
    send(404, 'nope');
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}` }); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  for (const s of [ctx.staffA, ctx.staffB]) await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: s.id, spaces: ['sales'] });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  // 운영 사례처럼 마감이 9시간 당겨져 저장된 줄 · 현장설명 칸 없음
  const row = { id: 'src388', source_type: 'kapt_bid', source_external_id: EXT, source_url: `https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=${EXT}`, title: '[경기] 주민공동시설(커뮤니티) 위탁운영 사업자 선정 입찰 공고',
    complex_name: '시험388단지', issuer: '시험388단지', facility_name: '시험388단지', related: true, fit_business: '다짐', classification: '즉시 검토', current_status: '진행중', notice_state: '신규공고',
    posted_date: plus(-5), deadline_at: `${D}T08:00:00+09:00`, bid_system: 'KG2B전자입찰', first_seen_at: new Date(Date.now() - 5 * 864e5).toISOString(), updated_at: new Date(Date.now() - 864e5).toISOString() };
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', 'src388', ${sql.json(row)}, 'workin')`;
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('정기 실행: 원천 상세로 마감 17:00·현장설명회(필수) 바로잡음 → 업무 마감·입찰 마감 일정 이동 · 현장설명회 일정 새로 · 참석자 = 담당자 전원 · 빠진 담당은 일정에서도 빠짐', async () => {
  const h = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'src388', assigneeIds: [ctx.staffA.id, ctx.ownerId] });
  assert.deepEqual([h.dueTime, h.eventIds.length], ['08:00', 1], '재현: 잘못된 마감 · 현장설명회 일정 없음');
  const closeId = h.eventIds[0];
  // 넘긴 뒤 함께 담당 추가(박직원)
  await sql`insert into task_assignees (task_id, user_id, added_by) values (${h.taskId}, ${ctx.staffB.id}, ${ctx.ownerId})`;
  const t1 = await tick();
  assert.ok(kg2bHits.includes(CODE), `KG2B 상세 읽음 ${JSON.stringify(t1.bidDatesVerify)}`);
  assert.ok(kapt.calls.some((c) => c.path === '/kapt/bid/bidDetail.do' && c.q.bidNum === EXT), 'K-apt 상세 읽음');
  const [{ row }] = await sql`select row from sales_src_rows where src_id = 'src388'`;
  assert.deepEqual([row.deadline_at, row.deadline_fixed?.by, row.kg2b_briefing_kind, row.kg2b_briefing_at], [`${D}T17:00:00+09:00`, 'KG2B', '필수', `${B}T14:00:00+09:00`]);
  const all = sorted([ctx.staffA.id, ctx.ownerId, ctx.staffB.id]);
  const close = await evOf(closeId);
  assert.equal(close.s, `${D} 17:00`, '입찰 마감 일정 17:00');
  assert.deepEqual(close.att, all, '참석자 = 담당자 전원(넘긴 뒤 더한 박직원 포함)');
  assert.match(close.description, /^입찰 일정 — 담당 이직원·김대표·박직원/);
  const w = await work();
  assert.deepEqual(sorted(w.assignees), all);
  const brief = await evOf(w.bid_events.briefing);
  assert.ok(brief, `현장설명회 일정 ${JSON.stringify(w.bid_events)}`);
  assert.deepEqual([brief.title.split(' · ')[0], brief.s, brief.att], ['[입찰] 현장설명회(필수)', `${B} 14:00`, all]);
  const [tk] = await sql`select due_date::text d, to_char(due_time, 'HH24:MI') t from tasks where id = ${h.taskId}`;
  assert.deepEqual([tk.d, tk.t], [D, '17:00'], '업무 마감 = 입찰 마감 17:00');
  assert.ok((await sql`select 1 from notifications where user_id = ${ctx.staffB.id} and entity_id = ${closeId} and title like '일정 초대:%'`).length, '새로 들어간 담당에게 알림');
  // 함께 담당에서 박직원을 빼면 두 일정 참석자에서도 빠짐
  await sql`delete from task_assignees where task_id = ${h.taskId} and user_id = ${ctx.staffB.id}`;
  await tick();
  const two = sorted([ctx.staffA.id, ctx.ownerId]);
  assert.deepEqual([(await evOf(closeId)).att, (await evOf(w.bid_events.briefing)).att], [two, two]);
  // 3시간 안에는 원천을 다시 읽지 않음
  const n = kg2bHits.length; await tick(); assert.equal(kg2bHits.length, n);
});
