// 영업 S2 2차(감사 1-13·1-14·1-15·1-16): 리드 폼 13칸·비슷한 거래처 경고·삭제(사유·감사)·상담 다음 연락일 → 업무 마감·업무 탭·타임라인·CSV 가져오기 / 제안·계약 칸 보강·영업비용·ROI·KPI / 목록 최근 활동·등록일
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const P = {};
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffB.id, spaces: ['sales'] });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });
const openTask = (id) => sql`select id, title, status, due_date::text as due, assignee_id, sales_ref from tasks where lead_id = ${id} and deleted_at is null order by created_at`;

describe('S2 2차 리드 폼·상세', () => {
  test('새 리드 13칸(규모·이메일·홈페이지·예상매출·담당 지정) → 목록 칸(최근 활동·등록일·이메일) → 수정(PATCH 칸 보강)·담당 변경 감사', async () => {
    const r = await ctx.owner.ok('POST', '/api/sales/leads', { name: '판교 레이크 커뮤니티', status: '신규리드', priority: 'high', facilityType: '아파트', region: '경기', scale: '1,200세대', expectedRevenue: 36000000,
      contactName: '김소장', phone: '031-123-4567', email: 'lake@example.com', homepage: 'https://lake.example.com', nextContactDate: addDays(today, 2), memo: '첫 미팅 예정', ownerId: ctx.staffA.id });
    assert.ok(r.id && !r.similar); P.lead = r.id;
    const list = await ctx.owner.ok('GET', '/api/sales/src?view=leads');
    const l = list.leads.find((x) => x.id === r.id);
    assert.deepEqual([l.scale, l.email, l.homepage, l.priorityCode, l.owner, l.next, l.created], ['1,200세대', 'lake@example.com', 'https://lake.example.com', 'high', '이직원', addDays(today, 2), today]);
    assert.equal(l.lastActivity, today, '최근 활동 = 활동 없으면 수정일'); assert.equal(list.me, ctx.ownerId, '내 담당 칩용 me');
    const [t] = await openTask(r.id); assert.deepEqual([t.assignee_id, t.due], [ctx.staffA.id, addDays(today, 2)], '첫 연락 업무는 지정한 담당에게');
    await ctx.owner.ok('PATCH', `/api/sales/leads/${r.id}`, { scale: '1,300세대', email: null, expectedRevenue: 40000000, ownerId: ctx.staffB.id });
    const d = await ctx.owner.ok('GET', `/api/sales/src?view=lead&id=${r.id}`);
    assert.deepEqual([d.lead.scale, d.lead.email, Number(d.lead.revenue), d.lead.owner, d.canDelete, d.me], ['1,300세대', null, 40000000, '박직원', true, ctx.ownerId]);
    assert.equal((await sql`select count(*)::int n from audit_logs where action = 'sales.lead_owner' and target_id = ${r.id}`)[0].n, 1, '담당 변경 감사');
  });
  test('비슷한 거래처: 미리 보기 GET + 만들기 때 similar 응답(만들지 않음) → force 로 그래도 만들기', async () => {
    const s = await ctx.owner.ok('GET', '/api/sales/leads/similar?name=판교 레이크');
    assert.ok(s.similar.some((x) => x.id === P.lead));
    const r = await ctx.owner.ok('POST', '/api/sales/leads', { name: '판교레이크 커뮤니티(2차)' });
    assert.ok(!r.id && r.similar?.some((x) => x.id === P.lead), '비슷하면 만들지 않고 알려 줌');
    const r2 = await ctx.owner.ok('POST', '/api/sales/leads', { name: '판교레이크 커뮤니티(2차)', force: true });
    assert.ok(r2.id); P.lead2 = r2.id;
    assert.equal((await ctx.owner.ok('GET', '/api/sales/leads/similar?name=전혀다른이름')).similar.length, 0);
  });
  test('상담 입력 보강: 다음 연락 예정일·다음 액션·고객 요청 → 리드 다음 연락일·영업 업무 마감이 같이 바뀜, 타임라인 통합(최신순)', async () => {
    await ctx.owner.ok('POST', `/api/sales/leads/${P.lead}/activities`, { type: '방문', content: '현장 방문, 소장 면담', nextDate: addDays(today, 7), nextAction: '제안서 발송', request: '운영비 절감안 요청' });
    const d = await ctx.owner.ok('GET', `/api/sales/src?view=lead&id=${P.lead}`);
    assert.equal(d.lead.next, addDays(today, 7));
    assert.deepEqual([d.activities[0].next_contact_date, d.activities[0].next_action, d.activities[0].customer_request], [addDays(today, 7), '제안서 발송', '운영비 절감안 요청']);
    const tasks = await openTask(P.lead); assert.equal(tasks.filter((t) => t.status !== 'done')[0].due, addDays(today, 7), '업무 마감 따라감');
    assert.ok(d.timeline.length >= 2 && d.timeline.some((x) => x.kind === 'act') && d.timeline.some((x) => x.kind === 'task'));
    for (let i = 1; i < d.timeline.length; i++) assert.ok(String(d.timeline[i - 1].at) >= String(d.timeline[i].at), '최신순');
    assert.equal(d.lead.lastActivity, today, '최근 활동 = 상담일');
  });
  test('업무 탭: 리드 업무 추가(space sales·lead_id·수동 표시) → wTasks 에 보임, 자동 업무 동기화는 수동 업무를 건드리지 않음', async () => {
    const r = await ctx.owner.ok('POST', `/api/sales/leads/${P.lead}/tasks`, { title: '제안서 초안 쓰기', dueDate: addDays(today, 3) });
    const d = await ctx.owner.ok('GET', `/api/sales/src?view=lead&id=${P.lead}`);
    const w = d.wTasks.find((x) => x.id === r.id);
    assert.ok(w && w.sales_ref.manual === true && w.due_date === addDays(today, 3) && w.assignee === '박직원', '리드 담당이 기본 담당');
    await ctx.owner.ok('PATCH', `/api/sales/leads/${P.lead}`, { status: '보류', reason: '예산 확정 전' });
    const [[auto], [manual]] = [await sql`select status from tasks where lead_id = ${P.lead} and coalesce(sales_ref->>'manual', '') <> 'true' and deleted_at is null order by created_at desc limit 1`, await sql`select status from tasks where id = ${r.id}`];
    assert.deepEqual([auto.status, manual.status], ['on_hold', 'todo'], '자동 업무만 보류');
    await ctx.owner.ok('PATCH', `/api/sales/leads/${P.lead}`, { status: '미팅예정' });
    assert.equal((await ctx.staffA.client.req('POST', `/api/sales/leads/${P.lead}/tasks`, { title: 'x' })).status, 200, '공간 멤버는 업무 추가 가능');
  });
  test('영업 재편 5) 진행 한 화면: 리드 일정 추가(회사 캘린더·lead_id·참석 = 담당) → 상세 events·타임라인 event, 단계 이동 기록 → 단계별 보기 전환율(funnel)', async () => {
    const ev = await ctx.owner.ok('POST', `/api/sales/leads/${P.lead}/events`, { title: '현장 미팅', date: addDays(today, 2), time: '14:00', durationMin: 90 });
    const [row] = await sql`select e.title, e.lead_id, e.all_day, c.type, (select count(*)::int from event_attendees a where a.event_id = e.id) as att from events e join calendars c on c.id = e.calendar_id where e.id = ${ev.id}`;
    assert.deepEqual([row.lead_id, row.all_day, row.type, row.att], [P.lead, false, 'company', 1]); assert.match(row.title, /^\[영업\] 현장 미팅 · /);
    const allDay = await ctx.owner.ok('POST', `/api/sales/leads/${P.lead}/events`, { title: '개찰', date: addDays(today, 9) });
    const d = await ctx.owner.ok('GET', `/api/sales/src?view=lead&id=${P.lead}`);
    assert.equal(d.events.length, 2); assert.ok(d.events.some((x) => x.id === allDay.id && x.all_day === true));
    assert.ok(d.timeline.some((x) => x.kind === 'event' && x.id === ev.id && x.href === `/calendar?event=${ev.id}`), '타임라인에 일정');
    assert.equal((await ctx.staffB.client.req('POST', `/api/sales/leads/${P.lead}/events`, { title: 'x', date: today })).status, 403, '담당 아닌 직원은 못 만듦');
    assert.equal((await ctx.owner.req('POST', `/api/sales/leads/${P.lead}/events`, { title: 'x', date: '2026-13-01' })).status, 400);
    // 단계 이동(상세 '진행' 띠 = PATCH status) → 전환율: 거쳐 간 단계 수 ≥ 지금 수, 계약완료 전환율
    await ctx.owner.ok('PATCH', `/api/sales/leads/${P.lead}`, { status: '제안서발송완료' });
    await ctx.owner.ok('PATCH', `/api/sales/leads/${P.lead}`, { status: '계약완료' });
    const pl = await ctx.owner.ok('GET', '/api/sales/src?view=pipeline');
    assert.ok(Array.isArray(pl.stages) && pl.funnel && pl.funnel.total >= 1);
    const st = Object.fromEntries(pl.funnel.stages.map((f) => [f.status, f]));
    assert.ok(!('보류' in st) && !('실패' in st), '닫힌 단계는 깔때기에서 뺌');
    assert.ok(st['제안서발송완료'].reached >= 1 && st['계약완료'].reached >= 1 && st['계약완료'].now >= 1, JSON.stringify(st['계약완료']));
    assert.ok(st['미팅예정'].reached >= 1, '지나간 단계도 거쳐 간 수에 포함(상태 기록)');
    assert.equal(pl.funnel.won >= 1, true); assert.equal(pl.funnel.conversion, Math.round((pl.funnel.won / pl.funnel.total) * 1000) / 10);
    await ctx.owner.ok('PATCH', `/api/sales/leads/${P.lead}`, { status: '미팅예정' });
  });
  test('삭제: 사유 필수, 담당 아닌 직원 403, 관리자 삭제 → 목록·상세에서 사라짐(404)·열린 영업 업무 완료·감사', async () => {
    assert.equal((await ctx.owner.req('DELETE', `/api/sales/leads/${P.lead2}`, {})).status, 400, '사유 필수');
    assert.equal((await ctx.staffA.client.req('DELETE', `/api/sales/leads/${P.lead2}`, { reason: '중복' })).status, 403, '담당 아닌 직원');
    await ctx.owner.ok('DELETE', `/api/sales/leads/${P.lead2}`, { reason: '중복 등록' });
    assert.equal((await ctx.owner.req('GET', `/api/sales/src?view=lead&id=${P.lead2}`)).status, 404);
    assert.ok(!(await ctx.owner.ok('GET', '/api/sales/src?view=leads')).leads.some((l) => l.id === P.lead2));
    assert.equal((await ctx.owner.req('PATCH', `/api/sales/leads/${P.lead2}`, { memo: 'x' })).status, 404, '지운 리드는 수정 불가');
    assert.ok((await sql`select status from tasks where lead_id = ${P.lead2} and deleted_at is null`).every((t) => t.status === 'done'), '열린 영업 업무 완료');
    const [a] = await sql`select detail from audit_logs where action = 'sales.lead_delete' and target_id = ${P.lead2}`;
    assert.equal(a.detail.reason, '중복 등록');
    assert.equal((await ctx.owner.ok('GET', '/api/sales/leads/similar?name=판교레이크 커뮤니티(2차)')).similar.some((x) => x.id === P.lead2), false, '지운 리드는 비슷한 거래처에서 빠짐');
  });
  test('CSV 가져오기(관리자): 같은 이름(공백·괄호 무시) 건너뜀, 직원 403, 들어온 리드는 첫 연락 업무', async () => {
    const r = await ctx.owner.ok('POST', '/api/sales/leads/import', { rows: [{ name: '판교 레이크커뮤니티' }, { name: '광교 호수마을', region: '경기', phone: '031-555-0000', expectedRevenue: 12000000, nextContactDate: addDays(today, 1), status: '1차연락완료' }, { name: '광교호수마을' }] });
    assert.deepEqual([r.created, r.skipped], [1, ['판교 레이크커뮤니티', '광교호수마을']]);
    const l = (await ctx.owner.ok('GET', '/api/sales/src?view=leads')).leads.find((x) => x.name === '광교 호수마을');
    assert.deepEqual([l.status, l.region, l.next], ['1차연락완료', '경기', addDays(today, 1)]);
    assert.equal((await openTask(l.id)).length, 1);
    assert.equal((await ctx.staffA.client.req('POST', '/api/sales/leads/import', { rows: [{ name: 'x' }] })).status, 403);
  });
});

describe('S2 2차 제안·계약·ROI', () => {
  test('제안 칸 보강(버전·최종금액·월 운영비·계약 예상일·사업)·계약(시작·종료·PM·재계약 단계) → deals 표·KPI(종료일)·ROI(계약금액·비용·전환율·출처별)', async () => {
    await ctx.owner.ok('POST', `/api/sales/leads/${P.lead}/records`, { kind: 'proposals', title: '커뮤니티 운영 제안 v2', amount: 30000000, version: 'v2', finalAmount: 28000000, monthlyFee: 2500000, expectedContractDate: addDays(today, 20), business: '커뮤니티 운영', status: '검토중' });
    await ctx.owner.ok('POST', `/api/sales/leads/${P.lead}/records`, { kind: 'contracts', title: '커뮤니티 운영 계약', amount: 28000000, date: today, startDate: today, endDate: addDays(today, 80), pm: '박직원', renewStage: '영업 전', business: '커뮤니티 운영' });
    assert.equal((await ctx.staffA.client.req('POST', '/api/sales/costs', { month: today.slice(0, 7), item: '광고', amount: 1000000 })).status, 403, '비용은 관리자만');
    const c1 = await ctx.owner.ok('POST', '/api/sales/costs', { month: today.slice(0, 7), business: '커뮤니티 운영', item: '네이버 광고', amount: 2000000 });
    await ctx.owner.ok('POST', '/api/sales/costs', { month: '2020-01', item: '옛 비용', amount: 9999999 }); // 기간 밖
    const d = await ctx.owner.ok('GET', '/api/sales/src?view=deals&status=6');
    const p = d.proposals.find((x) => x.title === '커뮤니티 운영 제안 v2');
    assert.deepEqual([p.version, Number(p.final_amount), Number(p.monthly_fee), p.expected_contract_date, p.status, p.business, p.lead_name], ['v2', 28000000, 2500000, addDays(today, 20), '검토중', '커뮤니티 운영', '판교 레이크 커뮤니티']);
    const c = d.contracts.find((x) => x.title === '커뮤니티 운영 계약');
    assert.deepEqual([c.start_date, c.end_date, c.pm, c.renew_stage], [today, addDays(today, 80), '박직원', '영업 전']);
    assert.deepEqual([d.kpi.d90, d.kpi.d180, d.kpi.d365, d.kpi.past], [1, 1, 1, 0]);
    assert.deepEqual([d.roi.months, d.roi.contractAmount, d.roi.cost, d.roi.roi, d.roi.wonLeads], [6, 28000000, 2000000, 1300, 1]);
    assert.ok(d.roi.newLeads >= 2 && d.roi.conversion > 0 && d.roi.bySource['직접'].won === 1, JSON.stringify(d.roi.bySource));
    assert.ok(d.roi.costs.some((x) => x.__id === c1.id && x.item === '네이버 광고'));
    const d3 = await ctx.owner.ok('GET', '/api/sales/src?view=deals&status=3'); assert.equal(d3.roi.months, 3);
    await ctx.owner.ok('DELETE', `/api/sales/records/${c1.id}`);
    assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=deals')).roi.cost, 0, '비용 삭제');
    assert.equal((await ctx.owner.req('DELETE', `/api/sales/records/${c1.id}`)).status, 404);
    const lead = await ctx.owner.ok('GET', `/api/sales/src?view=lead&id=${P.lead}`);
    assert.ok(lead.timeline.some((x) => x.kind === 'proposal') && lead.timeline.some((x) => x.kind === 'contract'), '타임라인에 제안·계약');
  });
});

// #610 ⓑⓒ·#614(대표 10/25 ⑥·⑩): 보류·실패·되돌림 리드는 기본 목록 대신 보관함(목록 응답 archive = 사유·누가·언제·이전 단계) → [되돌리기] · [영업 진행으로] = 1차연락완료 + 담당·다음 연락일
describe('#610·#614 리드 보관함·[영업 진행으로]', () => {
  test('실패(사유) → archive(사유·누가·언제·이전 단계) → 되돌리기(이전 단계) · 신규리드 → 1차연락완료(담당·다음 연락일)', async () => {
    const r = await ctx.owner.ok('POST', '/api/sales/leads', { name: '보관함 시험 거래처', status: '신규리드', force: true });
    assert.ok(r.id);
    await ctx.owner.ok('PATCH', `/api/sales/leads/${r.id}`, { status: '실패', reason: '예산 없음' });
    const [{ name }] = await sql`select name from users where id = ${ctx.ownerId}`;
    let l = (await ctx.owner.ok('GET', '/api/sales/src?view=leads')).leads.find((x) => x.id === r.id);
    assert.deepEqual([l.status, l.archive.reason, l.archive.by, l.archive.prev, !!l.archive.at], ['실패', '예산 없음', name, '신규리드', true]);
    assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=leads')).leads.find((x) => x.id === P.lead).archive, null, '진행 중 리드는 archive 없음');
    await ctx.owner.ok('PATCH', `/api/sales/leads/${r.id}`, { status: '신규리드', reason: '보관함에서 되돌림' });
    l = (await ctx.owner.ok('GET', '/api/sales/src?view=leads')).leads.find((x) => x.id === r.id);
    assert.deepEqual([l.status, l.archive], ['신규리드', null]);
    assert.equal((await sql`select reason from sales_status_log where lead_id = ${r.id} order by changed_at desc limit 1`)[0].reason, '보관함에서 되돌림', '되돌림도 단계 기록');
    await ctx.owner.ok('PATCH', `/api/sales/leads/${r.id}`, { status: '1차연락완료', ownerId: ctx.staffA.id, nextContactDate: addDays(today, 3) });
    l = (await ctx.owner.ok('GET', '/api/sales/src?view=leads')).leads.find((x) => x.id === r.id);
    assert.deepEqual([l.status, l.ownerId, l.next, l.archive], ['1차연락완료', ctx.staffA.id, addDays(today, 3), null]);
    assert.ok((await openTask(r.id)).some((t) => t.status !== 'done'), '담당자에게 열린 영업 업무');
  });
});
