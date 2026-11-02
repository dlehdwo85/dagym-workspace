// 335차(대표 11/02 16:5x #918 "공고 → 업무로 넘어올 때 세대수·입찰 마감 일시·현장설명회 일시(필수 여부)를 업무 설명 위 고정 칸으로"):
// 아파트 공고(K-apt)는 세대수까지, 나라장터·누리장터는 마감·현설만 · 세대수를 모르면 '확인 필요' · 체크리스트 '세대수 확인'(아파트만)·'입찰 마감 확인'·'현장설명회 참석(일시)'/'현설 없음'/'여부 확인' ·
// 공고 정정 → 정기 실행이 칸·체크리스트 줄을 따라 바꾸고 활동 기록(bid_info_update) · 기존 열린 공고 업무는 첫 실행이 전수 채움(bid_info_fill_335) · 상태 버튼 자동 업무도 만들 때부터
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const put = (row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'procurement_notices', ${String(row.id)}, ${sql.json(row)})`;
const patch = (id, p) => sql`update sales_src_rows set row = row || ${sql.json(p)} where scope = 'global' and tbl = 'procurement_notices' and src_id = ${id}`;
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); return (await r.json()).detail ?? {}; };
const mk = (title) => ctx.owner.ok('POST', '/api/tasks', { title, assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, space: 'sales' });
const info = async (id) => (await sql`select sales_ref from tasks where id = ${id}`)[0].sales_ref.bidInfo ?? null;
const items = async (id) => (await sql`select text, done from task_checklist_items where task_id = ${id} order by sort`);
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const kd = (ymd, hm) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}(${DOW[new Date(`${ymd}T12:00:00+09:00`).getUTCDay()]})${hm ? ` ${hm}` : ''}`;

before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await put({ id: 'A1', source_type: 'kapt_bid', title: '커뮤니티시설 위탁운영 업체 선정', complex_name: '래미안 시험단지', issuer: '래미안시험단지 입주자대표회의', household_count: 1200, related: true, first_seen_at: today,
    deadline_at: `${addDays(today, 5)}T14:00`, site_briefing_kind: '필수', site_briefing_at: `${addDays(today, 3)}T10:00`, site_briefing_place: '관리사무소 회의실' });
  // 347차: A1 과 같은 제목·발주처의 앞선 공고(번호·마감 다름)가 취소됨 → A1 업무 고정 칸에 '재공고 · 이전 공고 취소됨' 한 줄 (A1 은 뒤 게시라 취소 표시 대상 아님)
  await put({ id: 'A1C', source_type: 'kapt_bid', title: '커뮤니티시설 위탁운영 업체 선정', complex_name: '래미안 시험단지', issuer: '래미안시험단지 입주자대표회의', household_count: 1200, related: true, posted_date: addDays(today, -3), first_seen_at: addDays(today, -3),
    deadline_at: `${addDays(today, 4)}T14:00`, current_status: '취소', notice_state: '취소', notice_kind: 'cancel', result_note: '계약기간 표시 오류' });
  await put({ id: 'A2', source_type: 'kapt_bid', title: '헬스장 위탁운영', complex_name: '모름 시험단지', issuer: '모름단지 입주자대표회의', related: true, first_seen_at: today, deadline_at: `${addDays(today, 4)}T17:00` });
  await put({ id: 'N1', source_type: 'g2b_bid', title: '체육시설 운영 용역', issuer: '성남시', related: true, first_seen_at: today, deadline_at: `${addDays(today, 9)}T10:00`, site_briefing_kind: '없음' });
  await put({ id: 'N2', source_type: 'nuri_bid', title: '수영장 위탁 용역', issuer: '평택시', related: true, first_seen_at: today, deadline_at: `${addDays(today, 6)}T18:00` });
  await put({ id: 'N3', source_type: 'g2b_bid', title: '문화센터 운영 용역', issuer: '용인시', related: true, first_seen_at: today, deadline_at: `${addDays(today, 8)}T11:00`, site_briefing_at: `${addDays(today, 2)}T15:00` });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('정기 실행 첫 채우기: 아파트 공고 = 세대수·마감·현설(필수·장소) · 모르는 세대수 = 확인 필요 · 나라장터·누리장터 = 마감·현설만(현설 없음/여부 확인) · 예전 현설 줄은 글만 바뀜 · 기록 bid_info_fill_335', async () => {
  const P = {};
  for (const [k, nid] of [['a1', 'A1'], ['a2', 'A2'], ['n1', 'N1'], ['n2', 'N2']]) {
    const t = await mk(`[입찰] ${nid} 시험 업무`);
    await sql`update tasks set sales_ref = ${sql.json({ kind: 'bid', id: nid, handoff: true })} where id = ${t.id}`;
    P[k] = t.id;
  }
  await sql`insert into task_checklist_items (task_id, text, sort) values (${P.a1}, '현장설명회 참석 · 옛 일시', 0)`;
  const plain = await mk('공고 아닌 업무');

  const t1 = await tick();
  assert.equal(t1.bidDueAlign.infoFilled, 4, JSON.stringify(t1.bidDueAlign)); assert.equal(t1.bidDueAlign.infoUpdated, 0);
  const a1 = await info(P.a1);
  assert.deepEqual([a1.apt, a1.households, a1.deadline, a1.deadlineLabel, a1.briefingNone], [true, 1200, `${addDays(today, 5)}T14:00`, kd(addDays(today, 5), '14:00'), false]);
  assert.deepEqual(a1.briefing, { kind: '필수', at: `${addDays(today, 3)}T10:00`, place: '관리사무소 회의실', required: true });
  const c1 = (await items(P.a1)).map((x) => x.text);
  assert.deepEqual(c1, [`현장설명회 참석(필수) · ${kd(addDays(today, 3), '10:00')} · 관리사무소 회의실`, '세대수 확인 · 1,200세대', `입찰 마감 확인 · ${kd(addDays(today, 5), '14:00')}`], '예전 현설 줄은 같은 줄의 글만 바뀌고(체크 유지) 세대수·마감 줄이 추가');
  assert.deepEqual(a1.prevCancel, { day: addDays(today, -3), reason: '계약기간 표시 오류', deadlineLabel: kd(addDays(today, 4), '14:00') }, '347차: 재공고 업무에 이전 취소 공고 한 줄');
  assert.equal((await sql`select sales_ref->'cancel' as c from tasks where id = ${P.a1}`)[0].c, null, '앞선 취소 공고로는 업무에 취소 표시를 하지 않음');
  const a2 = await info(P.a2);
  assert.deepEqual([a2.apt, a2.households, a2.briefing, a2.briefingNone], [true, null, null, false]); assert.equal(a2.prevCancel, null);
  assert.deepEqual((await items(P.a2)).map((x) => x.text), ['공고문·참가 자격 검토', '세대수 확인 · 확인 필요', `입찰 마감 확인 · ${kd(addDays(today, 4), '17:00')}`, '현장설명회 여부 확인']);
  const n1 = await info(P.n1);
  assert.deepEqual([n1.apt, n1.households, n1.briefing, n1.briefingNone], [false, null, null, true]);
  assert.deepEqual((await items(P.n1)).map((x) => x.text), ['공고문·참가 자격 검토', `입찰 마감 확인 · ${kd(addDays(today, 9), '10:00')}`, '현설 없음'], '나라장터는 세대수 줄 없음');
  assert.deepEqual((await items(P.n2)).map((x) => x.text), ['공고문·참가 자격 검토', `입찰 마감 확인 · ${kd(addDays(today, 6), '18:00')}`, '현장설명회 여부 확인']);
  assert.equal((await sql`select sales_ref from tasks where id = ${plain.id}`)[0].sales_ref, null, '공고 아닌 업무는 그대로');
  const [rec] = await sql`select value from app_settings where key = 'bid_info_fill_335'`; assert.equal(rec.value.filled, 4, '첫 실행 전수 채우기 기록');
  const acts = await sql`select changes from activities where entity_type = 'task' and entity_id = ${P.a1} and action = 'updated' and changes->>'reason' = 'bid_info_fill'`;
  assert.equal(acts.length, 1); assert.equal(acts[0].changes.bidInfo.to.households, 1200); assert.equal(acts[0].changes.bidInfo.from, null);
  // 상세·목록 응답에 고정 칸
  assert.equal((await ctx.owner.ok('GET', `/api/tasks/${P.a1}`)).task.sales_ref.bidInfo.households, 1200);
  const row = (await ctx.owner.ok('GET', '/api/tasks?status=open&limit=100')).tasks.find((x) => x.id === P.a1);
  assert.equal(row.sales_ref.bidInfo.briefing.at, `${addDays(today, 3)}T10:00`, '목록 줄 칩용');

  const t2 = await tick();
  assert.deepEqual([t2.bidDueAlign.infoFilled, t2.bidDueAlign.infoUpdated], [0, 0], '바뀐 게 없으면 0');
  // 공고 정정: 마감 · 현설 일시 → 칸·줄 따라감(줄 수 그대로) + 기록
  await patch('A1', { deadline_at: `${addDays(today, 7)}T11:00`, site_briefing_at: `${addDays(today, 4)}T15:00` });
  const t3 = await tick();
  assert.equal(t3.bidDueAlign.infoUpdated, 1, JSON.stringify(t3.bidDueAlign));
  const a1b = await info(P.a1);
  assert.equal(a1b.deadline, `${addDays(today, 7)}T11:00`); assert.equal(a1b.briefing.at, `${addDays(today, 4)}T15:00`); assert.equal(a1b.households, 1200);
  const c1b = await items(P.a1);
  assert.deepEqual(c1b.map((x) => x.text), [`현장설명회 참석(필수) · ${kd(addDays(today, 4), '15:00')} · 관리사무소 회의실`, '세대수 확인 · 1,200세대', `입찰 마감 확인 · ${kd(addDays(today, 7), '11:00')}`]);
  const upd = await sql`select changes from activities where entity_type = 'task' and entity_id = ${P.a1} and action = 'updated' and changes->>'reason' = 'bid_info_update'`;
  assert.equal(upd.length, 1); assert.equal(upd[0].changes.bidInfo.from.deadline, `${addDays(today, 5)}T14:00`); assert.equal(upd[0].changes.bidInfo.to.deadline, `${addDays(today, 7)}T11:00`);
  assert.equal(upd[0].changes.checklist.length, 2, '바뀐 줄 2개');
  const [rec2] = await sql`select value from app_settings where key = 'bid_info_fill_335'`; assert.equal(rec2.value.filled, 4, '기록은 첫 실행 것 그대로');
});

test('상태 버튼 자동 업무(검토중)도 만들 때부터 고정 칸·체크리스트 줄', async () => {
  await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'N3', status: '검토중', memo: '검토 시작' });
  const [t] = await sql`select id, title, sales_ref from tasks where sales_ref->>'kind' = 'bid' and sales_ref->>'id' = 'N3' and deleted_at is null`;
  assert.ok(t?.title.startsWith('[입찰] '), t?.title);
  assert.deepEqual([t.sales_ref.bidInfo.apt, t.sales_ref.bidInfo.deadline, t.sales_ref.bidInfo.briefing.at, t.sales_ref.bidInfo.briefing.required], [false, `${addDays(today, 8)}T11:00`, `${addDays(today, 2)}T15:00`, false]);
  assert.deepEqual((await items(t.id)).map((x) => x.text), ['공고문·참가 자격 검토', `입찰 마감 확인 · ${kd(addDays(today, 8), '11:00')}`, `현장설명회 참석 · ${kd(addDays(today, 2), '15:00')}`]);
  const fill = await sql`select 1 from activities where entity_type = 'task' and entity_id = ${t.id} and changes->>'reason' = 'bid_info_fill'`;
  assert.equal(fill.length, 1);
});
