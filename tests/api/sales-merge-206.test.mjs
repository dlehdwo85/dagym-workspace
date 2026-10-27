// 206차 #461 ⑦ 기존 거래처끼리 합치기(설계 docs/handoff/SALES_LEADS_REVAMP_2026-10-23.md 4절 중복 방지 · 7절 7번): GET·POST /api/sales/leads/:id/merge — 관리자만.
// 후보(같은 전화 / 이름 찾기) · 미리보기(딸린 것 수·채울 칸·다른 값·남길 쪽 제안, 쓰기 없음) · 합치기 = 상담·제안·단계 기록·업무(설명 속 링크)·일정·입찰 연결을 남길 쪽으로,
// 빈 칸만 채움(다른 값은 메모 한 줄) · 비었으면 담당·다음 연락일·할 일 이어받기 · 자동 영업 업무는 하나 · 합친 거래처는 목록에서 빠지고 예전 링크는 남긴 쪽으로(합친 것을 또 합쳐도)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql, A, B, C;
const today = seoulToday(); const d3 = addDays(today, 3);
const openAuto = (id) => sql`select id, due_date::text as due, title from tasks where deleted_at is null and status <> 'done' and sales_ref->>'kind' = 'lead' and sales_ref->>'id' = ${id} and coalesce(sales_ref->>'manual', '') <> 'true'`;
const leadRow = async (id) => (await sql`select name, owner_id, phone, email, contact_name, memo, next_contact_date::text as next, next_action, deleted_at, deleted_reason, merged_into from sales_leads where id = ${id}`)[0];
const detail = (id) => ctx.owner.ok('GET', `/api/sales/src?view=lead&id=${id}`);

before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  A = (await ctx.owner.ok('POST', '/api/sales/leads', { name: '한솔 피트니스 본점', status: '미팅예정', phone: '031-111-2222', contactName: '김담당', ownerId: ctx.staffA.id, force: true })).id;
  await ctx.owner.ok('PATCH', `/api/sales/leads/${A}`, { nextContactDate: d3, nextAction: '견적 보내기' });
  B = (await ctx.owner.ok('POST', '/api/sales/leads', { name: '한솔피트니스', phone: '031-111-2222', email: 'b@hansol.example', contactName: '박담당', force: true })).id;
  // A 에 딸린 것: 상담 1 · 사람 업무 1 · 일정 1 · 제안 1 · 단계 기록(만들 때 + 바꿀 때) · 입찰 연결 1
  await ctx.owner.ok('POST', `/api/sales/leads/${A}/activities`, { type: '전화', content: '첫 통화' });
  await ctx.owner.ok('POST', `/api/sales/leads/${A}/tasks`, { title: '자료 보내기' });
  await ctx.owner.ok('POST', `/api/sales/leads/${A}/events`, { title: '현장 미팅', date: addDays(today, 5) });
  await ctx.owner.ok('POST', `/api/sales/leads/${A}/records`, { kind: 'proposals', title: '운영 제안', amount: 1000000, date: today });
  await ctx.owner.ok('PATCH', `/api/sales/leads/${A}`, { status: '현장방문완료' });
  await sql`insert into sales_work_records (tenant, src_tbl, src_id, ref_id, status, lead_id, data) values ('default', 'procurement_notices__progress', 'W206', 'N206', '전환', ${A}, ${sql.json({ lead_id: A, status: '전환' })})`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('후보·미리보기(쓰기 없음): 같은 전화·이름 찾기 · 딸린 것 수 · 남길 쪽 제안 = 딸린 것이 많은 쪽 · 어느 쪽으로든 채울 칸·다른 값 · 관리자만', async () => {
  assert.ok((await ctx.owner.ok('GET', `/api/sales/leads/${B}/merge`)).candidates.some((x) => x.id === A && x.by === 'phone'));
  assert.ok((await ctx.owner.ok('GET', `/api/sales/leads/${B}/merge?q=${encodeURIComponent('한솔 피트')}`)).candidates.some((x) => x.id === A && x.by === 'search'));
  assert.equal((await ctx.owner.ok('GET', `/api/sales/leads/${B}/merge?q=${encodeURIComponent('한솔 피트')}`)).candidates.some((x) => x.id === B), false, '자기 자신은 빼고');
  const p = await ctx.owner.ok('GET', `/api/sales/leads/${B}/merge?with=${A}`);
  assert.deepEqual([p.a.id, p.b.id, p.keep], [B, A, 'b'], '딸린 것이 많은 A 를 남기자고 제안');
  const c = p.b.counts;
  assert.deepEqual([c.acts, c.deals, c.events, c.work, c.statusLog], [1, 1, 1, 1, 2]);
  assert.ok(c.tasks >= 2, JSON.stringify(c));
  // a = 보고 있는 B, b = 고른 A — aIntoB = B 를 A 로(A 의 빈 칸을 B 값으로) · bIntoA = A 를 B 로
  assert.deepEqual([p.aIntoB.fill, p.aIntoB.diff, p.aIntoB.owner], [['이메일'], ['고객 담당자 박담당'], false]);
  assert.deepEqual([p.bIntoA.fill, p.bIntoA.diff], [['다음 연락일'], ['고객 담당자 김담당']]);
  assert.equal((await leadRow(B)).deleted_at, null, '미리보기는 쓰지 않음');
  assert.equal((await ctx.staffA.client.req('GET', `/api/sales/leads/${B}/merge?with=${A}`)).status, 403);
  assert.equal((await ctx.managerA.client.req('GET', `/api/sales/leads/${B}/merge`)).status, 404, '영업 공간 밖');
  assert.equal((await ctx.owner.req('GET', `/api/sales/leads/${B}/merge?with=${B}`)).status, 400);
  await sql`insert into tenants (id, name) values ('t_mrg', '남의회사') on conflict do nothing`;
  const [other] = await sql`insert into sales_leads (tenant, name, status) values ('t_mrg', '남의 거래처', '신규리드') returning id`;
  assert.equal((await ctx.owner.req('GET', `/api/sales/leads/${B}/merge?with=${other.id}`)).status, 404, '다른 회사 거래처는 404');
  assert.equal((await ctx.owner.req('POST', `/api/sales/leads/${B}/merge`, { into: other.id })).status, 404);
});

test('합치기 B → A: 빈 칸만 채우고 다른 값은 메모 한 줄 · B 는 목록에서 빠지고 예전 링크는 A 로 · 자동 영업 업무는 하나', async () => {
  assert.equal((await openAuto(B)).length, 1); assert.equal((await openAuto(A)).length, 1);
  const r = await ctx.owner.ok('POST', `/api/sales/leads/${B}/merge`, { into: A });
  assert.equal(r.into, A);
  const b = await leadRow(B), a = await leadRow(A);
  assert.ok(b.deleted_at); assert.deepEqual([b.merged_into, b.deleted_reason], [A, '합침 → 한솔 피트니스 본점']);
  assert.deepEqual([a.email, a.contact_name, a.phone, a.owner_id], ['b@hansol.example', '김담당', '031-111-2222', ctx.staffA.id]);
  assert.equal(a.memo, `[합침 ${today}] 한솔피트니스 — 다른 값: 고객 담당자 박담당`);
  assert.deepEqual([(await openAuto(A)).length, (await openAuto(B)).length], [1, 0], 'B 의 자동 업무는 완료, A 것 하나만');
  assert.equal((await detail(B)).mergedInto, A, '예전 링크 → A');
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=leads')).leads.some((l) => l.id === B), false);
  const [au] = await sql`select detail from audit_logs where action = 'sales.lead_merge' and target_id = ${A}`;
  assert.deepEqual([au.detail.from, au.detail.fill, au.detail.closedTasks], [B, ['이메일'], 1]);
});

test('합치기 A → C(빈 새 거래처): 상담·제안·단계 기록·업무(설명 속 링크)·일정·입찰 연결이 C 로 · 담당·다음 연락일·할 일 이어받기 · 앞서 A 로 합친 B 의 링크도 C 로', async () => {
  C = (await ctx.owner.ok('POST', '/api/sales/leads', { name: '한솔 피트니스(새 등록)', force: true })).id;
  await sql`update sales_leads set owner_id = null where id = ${C}`;
  const r = await ctx.owner.ok('POST', `/api/sales/leads/${A}/merge`, { into: C });
  assert.deepEqual([r.moved.records, r.moved.statusLog, r.moved.events, r.moved.work, r.moved.adLeads, r.moved.quotes], [2, 2, 1, 1, 0, 0]);
  assert.ok(r.moved.tasks >= 3, JSON.stringify(r.moved));
  const c = await leadRow(C);
  assert.deepEqual([c.owner_id, c.next, c.next_action, c.phone, c.email, c.contact_name], [ctx.staffA.id, d3, '견적 보내기', '031-111-2222', 'b@hansol.example', '김담당']);
  assert.ok(c.memo.startsWith(`[합침 ${today}] 한솔 피트니스 본점`) && c.memo.includes('한솔피트니스 — 다른 값: 고객 담당자 박담당'), c.memo);
  const [w] = await sql`select lead_id, data->>'lead_id' as dl from sales_work_records where src_id = 'W206'`;
  assert.deepEqual([w.lead_id, w.dl], [C, C], '입찰 연결(칸·원본 둘 다)');
  const manual = await sql`select description from tasks where lead_id = ${C} and sales_ref->>'manual' = 'true'`;
  assert.ok(manual.length === 1 && manual[0].description.includes(C) && !manual[0].description.includes(A), '업무 설명 속 거래처 링크도 C');
  const auto = await openAuto(C);
  assert.deepEqual([auto.length, auto[0].due], [1, d3], '자동 영업 업무 하나, 마감 = 이어받은 다음 연락일');
  assert.equal((await openAuto(A)).length, 0);
  assert.deepEqual([(await detail(A)).mergedInto, (await detail(B)).mergedInto], [C, C], '합친 것을 또 합쳐도 예전 링크는 마지막 남긴 쪽으로');
  const d = await detail(C);
  assert.deepEqual([d.activities.length, d.proposals.length, d.events.length, d.work.length], [1, 1, 1, 1]);
  assert.ok(d.timeline.some((x) => x.kind === 'status' && x.title.includes('현장방문완료')), '단계 기록도 타임라인에');
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'sales.lead_owner' and target_id = ${C} and detail->>'merge' = ${A}`)[0].n, 1, '담당 이어받기 기록');
  // 잘못된 요청
  assert.equal((await ctx.owner.req('POST', `/api/sales/leads/${A}/merge`, { into: C })).status, 404, '이미 합친 거래처');
  assert.equal((await ctx.owner.req('POST', `/api/sales/leads/${C}/merge`, { into: C })).status, 400);
  assert.equal((await ctx.staffA.client.req('POST', `/api/sales/leads/${C}/merge`, { into: C })).status, 403);
});
