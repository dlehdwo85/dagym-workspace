// 212차 #612(대표 결정 10/25 19:00 "매주 진행") 영업 '준공·입주 시설' 후속조사:
// 주 1회 묶음 업무(큰 단지부터 n곳 · 리드로 넘긴 곳 빼고 · 마감 7일 · 담당 = 영업 담당 규칙(시설)) · 카드 '미확인 · 조사 예정 날짜(담당)'
// · 업무 완료 창에서 적은 값 → 카드·계약만료·재입찰 탭 · 비운 곳 = 확인 못함(12주 안에 다시 안 묶음) · 다음 주는 남은 곳만 · 권한(영업 밖 404 · 묶음 만들기는 관리자)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); return (await r.json()).detail ?? {}; };
const put = (row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'operating_facility_prospects', ${row.id}, ${sql.json({ facility_type: '아파트', region: '경기', first_seen_at: today, ...row })})`;
const hub = async (c = ctx.owner) => Object.fromEntries((await c.ok('GET', '/api/sales/src?view=hub&tab=facilities')).items.map((x) => [x.id, x]));

before(async () => {
  await resetDb(); srv = await startServer({ SALES_RESEARCH_WEEKLY: 'any', SALES_RESEARCH_MAX: '3' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await put({ id: 'F1', name: '광교 큰단지', household_count: 1500 });                                                          // 전화·위탁사·계약만료 모두 빔
  await put({ id: 'F2', name: '동탄 중간단지', household_count: 1200, office_phone: '031-111-2222', current_operator: '좋은운영' }); // 계약만료만 빔
  await put({ id: 'F3', name: '수원 작은단지', household_count: 900, office_phone: '031-333-0000' });
  await put({ id: 'F4', name: '오산 단지', household_count: 800 });                                                              // 이번 주는 3곳까지라 다음 주
  await put({ id: 'F6', name: '평택 넘긴단지', household_count: 1800 });                                                         // 리드로 넘김 → 안 묶음
  await sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('default', 'operating_facility_prospects__progress', 'F6', ${sql.json({ id: 'F6', contact_status: '진행영업 전환', lead_id: '00000000-0000-0000-0000-0000000000f6', handoff_by: 'x' })})`;
  await sql`insert into assignee_rules (tenant, kind, ref, primary_user_id) values ('default', 'sales_source', 'facility', ${ctx.staffA.id})`;
  // #758: 광교 큰단지 관련 공고 1건(같은 공고 두 줄 — 원본 복사·워크인 수집 — 은 한 번) · 관련 아닌 공고는 안 셈
  for (const [id, rel] of [['N212A', true], ['N212B', true], ['N212C', false]]) await sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'procurement_notices', ${id},
    ${sql.json({ id, source_type: 'kapt_bid', source_external_id: id === 'N212C' ? 'R212C' : 'R212A', title: '[경기] 광교 큰단지 커뮤니티 위탁운영', facility_name: '광교 큰단지', related: rel })})`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('주간 후속조사 묶음', () => {
  let taskId;
  test('관리자만 [지금 만들기] · 큰 단지부터 3곳(리드로 넘긴 곳 빼고) → 업무 하나(담당 규칙·마감 7일) + 알림 · 같은 주 정기 실행은 다시 안 만듦', async () => {
    assert.equal((await ctx.staffA.client.req('POST', '/api/sales/research', {})).status, 403, '직원은 못 만듦');
    const r = await ctx.owner.ok('POST', '/api/sales/research', {});
    assert.equal(r.items, 3, JSON.stringify(r)); taskId = r.taskId;
    const [t] = await sql`select title, description, assignee_id, due_date::text as due, space, sales_ref, requested_by, status from tasks where id = ${taskId}`;
    assert.deepEqual([t.title, t.assignee_id, t.due, t.space, t.sales_ref.kind, t.requested_by, t.status], ['[후속조사] 시설 3곳 — 커뮤니티(주민공동시설) 운영 방식 확인(전화)', ctx.staffA.id, addDays(today, 7), 'sales', 'research', ctx.ownerId, 'todo']);
    // #758(대표 10/28 '어떤 계약인지? 커뮤니티 입찰이 올라온 곳이 맞는지?'): 무엇을(운영 방식 — 직영·위탁·미개관) · 고른 기준(입찰 공고가 아니라 큰 단지 순) · 관련 공고 수
    assert.match(t.description, /커뮤니티\(주민공동시설\) 운영 방식을\(를\) 전화로 확인해 주세요: 직영 · 위탁 · 미개관/);
    assert.match(t.description, /위탁이면 현 위탁사·계약 만료일, 미개관이면 첫 운영사 선정 예정 시기를 적습니다\. 입찰 공고가 난 곳이 아니라 준공·입주 시설 중 빈 값이 있는 큰 곳부터/);
    assert.match(t.description, /1\. 광교 큰단지 \(경기 · 1,500세대\) — 확인할 것: 운영 방식\(직영·위탁·미개관\)·현 위탁사 · 계약 만료일\(위탁이면\) · 관리사무소 번호 · 이 시설 관련 공고 1건/);
    assert.match(t.description, /2\. 동탄 중간단지 \(경기 · 1,200세대\) — 확인할 것: 계약 만료일\(위탁이면\) · 관리사무소 031-111-2222\n/);
    assert.match(t.description, /\/s\/sales\/hub\?tab=facilities&q=/);
    assert.ok(!t.description.includes('평택 넘긴단지') && !t.description.includes('오산 단지'));
    const rows = await sql`select src_id, missing, status from sales_research where task_id = ${taskId} order by src_id`;
    assert.deepEqual(rows.map((x) => [x.src_id, x.missing, x.status]), [['F1', ['operator', 'contract', 'phone'], 'open'], ['F2', ['contract'], 'open'], ['F3', ['operator', 'contract'], 'open']]);
    const [n] = await sql`select title, link from notifications where user_id = ${ctx.staffA.id} and type = 'sales_research_weekly'`;
    assert.deepEqual([n?.title, n?.link], ['이번 주 후속조사 시설 3곳', `/tasks/${taskId}`]);
    const d = await tick();
    assert.ok(d.salesResearch && !d.salesResearch.out?.default, JSON.stringify(d.salesResearch));
    assert.equal((await sql`select count(*)::int n from tasks t join users u on u.id = t.created_by where u.tenant = 'default' and t.sales_ref->>'kind' = 'research'`)[0].n, 1);
  });
  test('카드: 조사 예정 날짜·담당·업무 · 머리 줄(이번 주 3곳) · 업무 목록 칩은 "후속조사"', async () => {
    const h = await hub();
    assert.deepEqual([h.F1.research?.status, h.F1.research?.due, h.F1.research?.assignee, h.F1.research?.taskId], ['open', addDays(today, 7), '이직원', taskId]);
    assert.equal(h.F4.research, null); assert.equal(h.F6.research, null);
    const o = await ctx.owner.ok('GET', '/api/sales/research');
    assert.deepEqual([o.latest.thisWeek, o.latest.items, o.latest.assignee, o.latest.taskId, o.canRun, o.max, o.auto], [true, 3, '이직원', taskId, false, 3, true]);
    assert.equal((await ctx.staffB.client.req('GET', '/api/sales/research')).status, 404, '영업 공간 밖 직원은 숨김');
  });
  test('완료 창: 묶인 시설·지금 값 · 값 적기(전화 형식 검사) · 비우면 확인 못함 · 영업 밖 직원 404', async () => {
    const f = await ctx.staffA.client.ok('GET', `/api/sales/research?task=${taskId}`);
    assert.deepEqual(f.items.map((x) => [x.srcId, x.phone, x.operator]), [['F1', null, null], ['F2', '031-111-2222', '좋은운영'], ['F3', '031-333-0000', null]]);
    assert.deepEqual(f.terms, { operator: '현 위탁사', office: '관리사무소', opCheck: '커뮤니티(주민공동시설) 운영 방식', facility: '시설' });
    assert.deepEqual(f.items.map((x) => x.notices), [1, 0, 0], '#758 관련 공고 수');
    assert.equal((await ctx.staffB.client.req('GET', `/api/sales/research?task=${taskId}`)).status, 404);
    const id = Object.fromEntries(f.items.map((x) => [x.srcId, x.id]));
    assert.equal((await ctx.staffA.client.req('PATCH', `/api/sales/research/${id.F3}`, { phone: '전화 없음' })).status, 400, '전화번호는 숫자·-');
    assert.equal((await ctx.staffB.client.req('PATCH', `/api/sales/research/${id.F1}`, { operator: 'x' })).status, 404);
    const a = await ctx.staffA.client.ok('PATCH', `/api/sales/research/${id.F1}`, { mode: '위탁', operator: '바른운영', contractEnd: addDays(today, 200), phone: '031-444-5555', note: '내년 입찰 예정' });
    assert.equal((await ctx.staffA.client.req('PATCH', `/api/sales/research/${id.F2}`, { mode: '모름' })).status, 400, '운영 방식은 직영·위탁·미개관');
    const m = await ctx.staffA.client.ok('PATCH', `/api/sales/research/${id.F2}`, { mode: '미개관', firstPick: '2027년 상반기' });
    assert.deepEqual([m.status, m.result.mode, m.result.firstPick], ['done', '미개관', '2027년 상반기'], '#758 운영 방식만 골라도 조사함 · 미개관이면 첫 운영사 선정 예정 시기');
    assert.equal((await ctx.staffA.client.ok('PATCH', `/api/sales/research/${id.F2}`, { mode: '직영', firstPick: '무시' })).result.firstPick, null, '미개관이 아니면 선정 예정 시기는 안 남김');
    assert.deepEqual([a.status, a.progress], ['done', false], '전환 전에는 진행 기록에 못 씀 — 후속조사 기록만');
    assert.equal((await ctx.staffA.client.ok('PATCH', `/api/sales/research/${id.F2}`, { operator: '', contractEnd: '', phone: null })).status, 'none');
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${taskId}`, { status: 'done' });
  });
  test('적은 값 → 카드(현 위탁사·계약만료·전화) · 계약만료·재입찰 탭 · 값 안 적고 업무만 끝낸 곳 = 확인 못함', async () => {
    const h = await hub();
    assert.deepEqual([h.F1.operator, h.F1.contractEnd, h.F1.phone, h.F1.research.status, h.F1.research.note, h.F1.research.mode], ['바른운영', addDays(today, 200), '031-444-5555', 'done', '내년 입찰 예정', '위탁']);
    assert.deepEqual([h.F1.notices, h.F2.notices], [1, 0], '#758 카드 관련 공고 수');
    assert.deepEqual([h.F2.research.status, h.F3.research.status, h.F3.research.taskId], ['none', 'none', taskId], '업무 완료 = 남은 곳 확인 못함');
    assert.ok(h.F3.research.doneAt, '업무 완료 시각');
    const it = (await ctx.owner.ok('GET', '/api/sales/src?view=contracts')).items.find((x) => x.id === 'facility:F1');
    assert.deepEqual([it?.end, it?.winner], [addDays(today, 200), '바른운영'], '후속조사 계약만료일 → 계약만료·재입찰 탭');
  });
  test('다음 주 정기 실행: 남은 곳(오산 단지)만 — 조사한 곳(확인 못함 포함)은 12주 안에 다시 안 묶음', async () => {
    await sql`update sales_research_weekly set week = week - 7`; await sql`update sales_research set week = week - 7`;
    const d = await tick();
    const out = d.salesResearch?.out?.default;
    assert.equal(out.items, 1, JSON.stringify(out));
    assert.deepEqual((await sql`select src_id from sales_research where task_id = ${out.taskId}`).map((x) => x.src_id), ['F4']);
    const [t] = await sql`select title from tasks where id = ${out.taskId}`; assert.equal(t.title, '[후속조사] 시설 1곳 — 커뮤니티(주민공동시설) 운영 방식 확인(전화)');
    assert.ok(!(await tick()).salesResearch?.out?.default, '같은 주 두 번 안 만듦');
  });
});
