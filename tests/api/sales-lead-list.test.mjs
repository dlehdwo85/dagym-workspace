// 197차 #461 영업 진행 목록 개편 1단계 · #460 업무 완료 때 다음 행동(설계 docs/handoff/SALES_LEADS_REVAMP_2026-10-23.md)
// 목록 칸(다음 할 일·단계 머문 날·마지막 접촉·출처·종결일·다시 볼 날) · 내 저장된 보기·열(사용자별) · 리드 업무 [완료] = 다음 연락일(+ 할 일) 또는 종결(사유·다시 볼 날)
// · 잘못 고르면 완료도 안 됨 · 완료 되돌리기 = 단계도 되돌림 · 다시 볼 날 정기 점검 · 업무 댓글이 거래처 타임라인에
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, Client, bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); return (await r.json()).detail ?? {}; };
const openTasks = (leadId) => sql`select id, title, status, due_date::text as due, assignee_id from tasks where lead_id = ${leadId} and deleted_at is null and status <> 'done' order by created_at`;
const leadRow = async (id) => (await sql`select status, next_contact_date::text as next, next_action, revisit_date::text as revisit from sales_leads where id = ${id}`)[0];
const listed = async (client, id) => (await client.ok('GET', '/api/sales/src?view=leads')).leads.find((l) => l.id === id);

before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffB.id, spaces: ['sales'] });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('#461 목록 칸 · 저장된 보기', () => {
  test('다음 할 일(연락일과 한 쌍) · 단계 머문 날 · 마지막 접촉(상담 종류) · 출처(공고 링크·리드 광고·이전 자료·직접) · 다시 볼 날은 보류·실패만', async () => {
    const a = await ctx.owner.ok('POST', '/api/sales/leads', { name: '목록 칸 A', status: '1차연락완료', ownerId: ctx.staffA.id });
    await ctx.owner.ok('PATCH', `/api/sales/leads/${a.id}`, { nextContactDate: addDays(today, 2), nextAction: '자료 보내기' });
    assert.deepEqual([(await leadRow(a.id)).next, (await leadRow(a.id)).next_action], [addDays(today, 2), '자료 보내기']);
    const [t] = await openTasks(a.id); assert.equal(t.due, addDays(today, 2), '영업 업무 마감도 따라감');
    await ctx.owner.ok('POST', `/api/sales/leads/${a.id}/activities`, { type: '방문', content: '현장 방문 상담' });
    let la = await listed(ctx.owner, a.id);
    assert.deepEqual([la.next, la.nextAction, la.lastContact?.kind, la.source.kind, la.source.label, la.closedAt], [addDays(today, 2), '자료 보내기', '방문', 'direct', '직접 등록', null]);
    assert.ok(la.stageSince, '단계 머문 시작');
    await ctx.owner.ok('PATCH', `/api/sales/leads/${a.id}`, { nextContactDate: null });
    assert.deepEqual([(await leadRow(a.id)).next, (await leadRow(a.id)).next_action], [null, null], '연락일을 지우면 할 일도');
    la = await listed(ctx.owner, a.id); assert.equal(la.next, null, '다음 행동 없음');
    // 출처
    const b = await ctx.owner.ok('POST', '/api/sales/leads', { name: '목록 칸 B(입찰)', force: true });
    await sql`update sales_leads set src = ${sql.json({ from: 'bid', id: 'N-77' })} where id = ${b.id}`;
    const c = await ctx.owner.ok('POST', '/api/sales/leads', { name: '목록 칸 C(광고)', force: true });
    await sql`update sales_leads set src = ${sql.json({ from: 'meta_lead' })} where id = ${c.id}`;
    const d = await ctx.owner.ok('POST', '/api/sales/leads', { name: '목록 칸 D(이전)', force: true });
    await sql`update sales_leads set src_id = 'old-77' where id = ${d.id}`;
    const L = (await ctx.owner.ok('GET', '/api/sales/src?view=leads')).leads;
    const src = (id) => L.find((l) => l.id === id).source;
    assert.equal(src(b.id).kind, 'bid'); assert.match(src(b.id).href, /tab=bids.*bq=N-77/); assert.match(src(b.id).label, /공고/);
    assert.deepEqual([src(c.id).kind, src(c.id).label], ['meta', '리드 광고']);
    assert.deepEqual([src(d.id).kind, src(d.id).label], ['moved', '이전 자료']);
    // 다시 볼 날: 진행 중에는 400, 보류·실패로 닫을 때만, 다시 진행 단계로 가면 지움
    assert.equal((await ctx.owner.req('PATCH', `/api/sales/leads/${a.id}`, { revisitDate: addDays(today, 30) })).status, 400);
    assert.equal((await ctx.owner.req('PATCH', `/api/sales/leads/${a.id}`, { status: '실패', reason: '예산 없음', revisitDate: today })).status, 400, '오늘은 안 됨');
    await ctx.owner.ok('PATCH', `/api/sales/leads/${a.id}`, { status: '실패', reason: '예산 없음', revisitDate: addDays(today, 90) });
    la = await listed(ctx.owner, a.id);
    assert.deepEqual([la.status, la.revisit, !!la.closedAt], ['실패', addDays(today, 90), true]);
    await ctx.owner.ok('PATCH', `/api/sales/leads/${a.id}`, { status: '미팅예정' });
    assert.equal((await leadRow(a.id)).revisit, null, '다시 진행 단계로 가면 다시 볼 날은 지움');
  });

  test('내 저장된 보기·열 — 사람마다 따로 · 기기 간 유지(서버) · 12개까지 · 영업 공간 밖은 404', async () => {
    const r = await ctx.staffA.client.ok('PUT', '/api/sales/leads/views', { views: [{ id: 'gangnam1', name: '강남 높음', q: { lv: 'mine', pri: 'high', region: '강남' } }], cols: ['source', 'contact'] });
    assert.deepEqual([r.views.length, r.cols], [1, ['source', 'contact']]);
    const g = await ctx.staffA.client.ok('GET', '/api/sales/leads/views');
    assert.deepEqual([g.views[0].name, g.views[0].q.pri, g.cols], ['강남 높음', 'high', ['source', 'contact']]);
    await ctx.staffA.client.ok('PUT', '/api/sales/leads/views', { cols: ['revenue'] });
    const g2 = await ctx.staffA.client.ok('GET', '/api/sales/leads/views');
    assert.deepEqual([g2.views.length, g2.cols], [1, ['revenue']], '준 칸만 바꿈');
    assert.equal((await ctx.staffA.client.ok('GET', '/api/sales/src?view=leads')).myViews.views[0].id, 'gangnam1', '목록 응답에도');
    assert.deepEqual((await ctx.owner.ok('GET', '/api/sales/leads/views')).views, [], '다른 사람 보기는 안 보임');
    const many = Array.from({ length: 13 }, (_, i) => ({ id: `view${i}x`, name: `보기 ${i}`, q: { lv: 'open' } }));
    assert.equal((await ctx.staffA.client.req('PUT', '/api/sales/leads/views', { views: many })).status, 400);
    assert.equal((await ctx.staffA.client.req('PUT', '/api/sales/leads/views', { views: [{ id: 'BAD ID', name: 'x', q: {} }] })).status, 400);
    assert.equal((await ctx.managerA.client.req('GET', '/api/sales/leads/views')).status, 404, '영업 공간 구성원이 아니면 404');
  });
});

describe('#460 업무 완료 → 다음 연락일 또는 종결', () => {
  test('다음 연락일 + 할 일을 고르면 그날 담당자 업무 · 지난 날은 400(완료도 안 됨) · 응답 안내', async () => {
    const l = await ctx.owner.ok('POST', '/api/sales/leads', { name: '완료 묻기 거래처', status: '1차연락완료', nextContactDate: today, ownerId: ctx.staffA.id, force: true });
    const [t1] = await openTasks(l.id);
    const bad = await ctx.staffA.client.req('PATCH', `/api/tasks/${t1.id}`, { status: 'done', leadFollowUp: { nextDate: addDays(today, -1) } });
    assert.equal(bad.status, 400); assert.match(bad.body.error.message, /다음 연락일/);
    assert.equal((await sql`select status from tasks where id = ${t1.id}`)[0].status, 'todo', '잘못 고르면 완료도 안 됨');
    const r = await ctx.staffA.client.ok('PATCH', `/api/tasks/${t1.id}`, { status: 'done', leadFollowUp: { nextDate: addDays(today, 3), nextAction: '견적서 보내기' } });
    assert.deepEqual([r.leadFollowUp.action, r.leadFollowUp.next, r.leadFollowUp.nextAction, r.leadFollowUp.created], ['followup', addDays(today, 3), '견적서 보내기', true]);
    assert.deepEqual([(await leadRow(l.id)).next, (await leadRow(l.id)).next_action], [addDays(today, 3), '견적서 보내기']);
    const [t2] = await openTasks(l.id);
    assert.deepEqual([t2.title, t2.due, t2.assignee_id], ['[영업] 완료 묻기 거래처 — 견적서 보내기', addDays(today, 3), ctx.staffA.id]);
    const [au] = await sql`select detail from audit_logs where action = 'sales.followup' and target_id = ${l.id} order by created_at desc limit 1`;
    assert.deepEqual([au.detail.chosen, au.detail.to, au.detail.action], [true, addDays(today, 3), '견적서 보내기'], '고른 다음 행동 기록');
    // 업무 댓글은 거래처 타임라인에
    await ctx.staffA.client.ok('POST', `/api/tasks/${t2.id}/comments`, { body: '고객이 견적 다시 요청' });
    const v = await ctx.owner.ok('GET', `/api/sales/src?view=lead&id=${l.id}`);
    const cm = v.timeline.find((x) => x.kind === 'comment');
    assert.ok(cm && cm.title.includes('고객이 견적 다시 요청') && cm.task === t2.title && cm.href === `/tasks/${t2.id}`, JSON.stringify(cm));
    assert.equal(v.lead.nextAction, '견적서 보내기');
  });

  test('종결: 보류는 사유 필수(400·완료 안 됨) · 사유·다시 볼 날로 닫으면 단계·기록·열린 업무 보류 · 완료 되돌리기 = 단계도 되돌림', async () => {
    const l = await ctx.owner.ok('POST', '/api/sales/leads', { name: '종결 거래처', status: '미팅예정', nextContactDate: today, ownerId: ctx.staffA.id, force: true });
    const [t1] = await openTasks(l.id);
    const extra = await ctx.owner.ok('POST', `/api/sales/leads/${l.id}/tasks`, { title: '자료 정리', assigneeId: ctx.staffA.id });
    const no = await ctx.staffA.client.req('PATCH', `/api/tasks/${t1.id}`, { status: 'done', leadFollowUp: { close: '보류' } });
    assert.equal(no.status, 400); assert.equal((await sql`select status from tasks where id = ${t1.id}`)[0].status, 'todo');
    const r = await ctx.staffA.client.ok('PATCH', `/api/tasks/${t1.id}`, { status: 'done', leadFollowUp: { close: '보류', reason: '시기 안 맞음', revisitDate: addDays(today, 180) } });
    assert.deepEqual([r.leadFollowUp.action, r.leadFollowUp.to, r.leadFollowUp.revisit], ['closed', '보류', addDays(today, 180)]);
    assert.deepEqual([(await leadRow(l.id)).status, (await leadRow(l.id)).revisit], ['보류', addDays(today, 180)]);
    const [g] = await sql`select from_status, to_status, reason from sales_status_log where lead_id = ${l.id} order by changed_at desc limit 1`;
    assert.deepEqual([g.from_status, g.to_status], ['미팅예정', '보류']); assert.match(g.reason, /시기 안 맞음 — 업무 완료: /);
    assert.equal((await sql`select status from tasks where id = ${extra.id}`)[0].status, 'todo', '사람이 만든 업무는 그대로');
    assert.equal((await openTasks(l.id)).filter((x) => x.title.startsWith('[영업]')).length, 0, '자동 영업 업무는 더 생기지 않음');
    const back = await ctx.staffA.client.ok('PATCH', `/api/tasks/${t1.id}`, { status: 'in_progress' });
    assert.deepEqual(back.leadReverted, { from: '보류', to: '미팅예정' });
    assert.deepEqual([(await leadRow(l.id)).status, (await leadRow(l.id)).revisit], ['미팅예정', null]);
    const [g2] = await sql`select to_status, reason from sales_status_log where lead_id = ${l.id} order by changed_at desc limit 1`;
    assert.deepEqual([g2.to_status, g2.reason], ['미팅예정', '업무 완료를 되돌려 단계도 되돌림']);
  });

  test('단계 권한: 리드 담당이 아닌 담당자는 종결 못 함(403·완료 안 됨) · 다음 연락일은 됨 · 요약(brief)의 canStage · 다른 회사 404', async () => {
    const l = await ctx.owner.ok('POST', '/api/sales/leads', { name: '대표 담당 거래처', status: '미팅예정', force: true }); // 담당 = 대표
    const t = await ctx.owner.ok('POST', `/api/sales/leads/${l.id}/tasks`, { title: '현장 사진 찍기', assigneeId: ctx.staffB.id });
    const br = await ctx.staffB.client.ok('GET', `/api/sales/leads/${l.id}/brief`);
    assert.deepEqual([br.name, br.status, br.closed, br.canStage], ['대표 담당 거래처', '미팅예정', false, false]);
    assert.equal((await ctx.owner.ok('GET', `/api/sales/leads/${l.id}/brief`)).canStage, true);
    const no = await ctx.staffB.client.req('PATCH', `/api/tasks/${t.id}`, { status: 'done', leadFollowUp: { close: '실패', reason: '경쟁사 선정' } });
    assert.equal(no.status, 403); assert.equal((await sql`select status from tasks where id = ${t.id}`)[0].status, 'todo');
    assert.equal((await leadRow(l.id)).status, '미팅예정');
    await ctx.staffB.client.ok('PATCH', `/api/tasks/${t.id}`, { status: 'done', leadFollowUp: { nextDate: addDays(today, 7) } });
    assert.equal((await leadRow(l.id)).next, addDays(today, 7));
    const o = new Client('other-lead');
    const s = await o.ok('POST', '/api/auth/signup', { email: 'boss@other-lead.test', name: '남사장', mode: 'team', company: '남의영업', password: 'signup-pass-1234', agree: { terms: true, age14: true, privacy: true, ai: true, marketing: false } });
    await o.ok('POST', '/api/auth/verify', { token: s.devLink.split('/').pop() });
    await o.ok('POST', '/api/auth/login', { email: 'boss@other-lead.test', password: 'signup-pass-1234' });
    assert.equal((await o.get(`/api/sales/leads/${l.id}/brief`)).status, 404, '다른 회사는 404');
  });

  test('다시 볼 날 정기 점검 — 그날 담당자 업무 1건 + 알림 · 단계는 그대로 · 한 번만', async () => {
    const l = await ctx.owner.ok('POST', '/api/sales/leads', { name: '다시 볼 거래처', status: '미팅예정', ownerId: ctx.staffA.id, force: true });
    await ctx.owner.ok('PATCH', `/api/sales/leads/${l.id}`, { status: '보류', reason: '연락 두절', revisitDate: addDays(today, 30) });
    await sql`update sales_leads set revisit_date = ${today} where id = ${l.id}`; // 그날이 됨
    const d = await tick(); assert.ok(d.leadRevisit?.made >= 1, JSON.stringify(d.leadRevisit));
    const ts = await sql`select id, title, assignee_id, due_date::text as due, sales_ref from tasks where lead_id = ${l.id} and deleted_at is null and title like '%다시 연락%'`;
    assert.equal(ts.length, 1);
    assert.deepEqual([ts[0].title, ts[0].assignee_id, ts[0].due, ts[0].sales_ref.revisit], ['[영업] 다시 볼 거래처 — 다시 연락(재접촉 검토)', ctx.staffA.id, today, true]);
    assert.equal((await sql`select count(*)::int c from notifications where user_id = ${ctx.staffA.id} and title = '다시 볼 날: 다시 볼 거래처'`)[0].c, 1);
    assert.deepEqual([(await leadRow(l.id)).status, (await leadRow(l.id)).revisit], ['보류', null]);
    await tick();
    assert.equal((await sql`select count(*)::int c from tasks where lead_id = ${l.id} and title like '%다시 연락%'`)[0].c, 1, '한 번만');
  });
});
