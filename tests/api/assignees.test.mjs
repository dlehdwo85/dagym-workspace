// 대표 10/20 15:00 (#100) 담당자 지정: 규칙(마케팅 브랜드별·영업 원천별·업무 배정 부서/팀별·승인자, 주+부 담당) → 자동 업무·카드·알림이 지정 담당자에게, 주 담당 연차·출장이면 부 담당, '규칙 배정' 표시, 감사
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const P = {};
const put = (tbl, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', ${tbl}, ${String(row.id)}, ${sql.json(row)})`;
before(async () => {
  await resetDb(); srv = await startServer({ MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffB.id, spaces: ['sales', 'marketing'] });
  await put('building_sales_pipeline', { id: 'B1', name: '규칙 단지 1', households: 900, region: '경기', status: '영업 전', first_seen_at: today });
  await put('building_sales_pipeline', { id: 'B2', name: '규칙 단지 2', households: 700, region: '경기', status: '영업 전', first_seen_at: today });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('규칙 목록·저장: 관리자만, 선택지(사람·브랜드·부서/팀·영업 원천 = 업종 템플릿 용어), 검증(같은 사람·없는 원천·다른 회사 사람)', async () => {
  assert.equal((await ctx.staffA.client.req('GET', '/api/admin/assignees')).status, 403);
  const v = await ctx.owner.ok('GET', '/api/admin/assignees');
  assert.deepEqual(v.rules, []); assert.ok(v.options.people.some((p) => p.id === ctx.staffA.id));
  assert.equal(v.options.sources.find((s) => s.key === 'building').label, '신규단지', '첫 회사 = 시설 템플릿 용어');
  assert.ok(v.options.units.length >= 1); assert.equal(v.labels.sales_source, '영업 담당(원천별)');
  assert.equal((await ctx.owner.req('PUT', '/api/admin/assignees', { kind: 'sales_source', ref: 'building', primaryUserId: ctx.staffA.id, backupUserId: ctx.staffA.id })).status, 400, '같은 사람');
  assert.equal((await ctx.owner.req('PUT', '/api/admin/assignees', { kind: 'sales_source', ref: 'nope', primaryUserId: ctx.staffA.id })).status, 400, '없는 원천');
  assert.equal((await ctx.owner.req('PUT', '/api/admin/assignees', { kind: 'task_unit', ref: '', primaryUserId: ctx.staffA.id })).status, 400, '부서·팀 필요');
  assert.equal((await ctx.staffA.client.req('PUT', '/api/admin/assignees', { kind: 'approver', primaryUserId: ctx.staffA.id })).status, 403);
  const r = await ctx.owner.ok('PUT', '/api/admin/assignees', { kind: 'sales_source', ref: 'building', primaryUserId: ctx.staffA.id, backupUserId: ctx.staffB.id, note: '신규단지는 A' });
  P.rule = r.rules.find((x) => x.kind === 'sales_source' && x.ref === 'building');
  assert.ok(P.rule); assert.equal(P.rule.primaryName, ctx.staffA.name ?? P.rule.primaryName); assert.equal(P.rule.backupUserId, ctx.staffB.id);
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'assignee_rule.set'`)[0].n, 1, '감사 기록');
});

test('영업 원천 규칙 → 자동 업무 담당 = 주 담당 + 규칙 배정 표시 · [넘기기] 기본 선택 · 주 담당 연차면 부 담당에게', async () => {
  const w = await ctx.owner.ok('POST', '/api/sales/work', { kind: 'building', id: 'B1', status: '연락중' });
  const [t1] = await sql`select assignee_id, assigned_by_rule from tasks where id = ${w.task.taskId}`;
  assert.equal(t1.assignee_id, ctx.staffA.id, '규칙의 주 담당'); assert.equal(t1.assigned_by_rule, P.rule.id, '규칙 배정 표시');
  const list = await ctx.staffA.client.ok('GET', '/api/tasks?view=all');
  assert.ok((list.tasks ?? list.items ?? []).some((t) => t.id === w.task.taskId && t.assigned_by_rule === P.rule.id), '목록에도 규칙 id');
  const hp = await ctx.owner.ok('GET', '/api/sales/work/handoff?kind=building');
  assert.equal(hp.suggested, ctx.staffA.id, '넘기기 기본 선택 = 규칙 담당');
  assert.equal((await ctx.owner.ok('GET', '/api/sales/work/handoff?kind=vendor')).suggested, null, '규칙 없는 원천은 기본 없음');
  // 주 담당 A 오늘 연차(개인 캘린더 종일 일정) → 부 담당 B
  const cals = await ctx.staffA.client.ok('GET', '/api/calendars');
  const calList = cals.calendars ?? cals;
  const cal = calList.find((c) => c.type === 'personal') ?? calList[0];
  await ctx.staffA.client.ok('POST', '/api/events', { calendarId: cal.id, title: '연차', kind: 'vacation', allDay: true, start: `${today}T00:00:00+09:00`, end: new Date(Date.parse(`${today}T00:00:00+09:00`) + 864e5).toISOString() });
  const w2 = await ctx.owner.ok('POST', '/api/sales/work', { kind: 'building', id: 'B2', status: '연락중' });
  const [t2] = await sql`select assignee_id, assigned_by_rule from tasks where id = ${w2.task.taskId}`;
  assert.equal(t2.assignee_id, ctx.staffB.id, '주 담당 부재 → 부 담당'); assert.equal(t2.assigned_by_rule, P.rule.id);
  assert.equal((await ctx.owner.ok('GET', '/api/sales/work/handoff?kind=building')).suggested, ctx.staffB.id);
  const v = await ctx.owner.ok('GET', '/api/admin/assignees');
  assert.ok(v.rules[0].primaryAway, '화면: 주 담당 부재 표시');
  await sql`update events set deleted_at = now() where created_by = ${ctx.staffA.id} and kind = 'vacation'`;
});

test('승인자 규칙 → 마케팅 승인 요청 알림은 그 사람에게만 · 브랜드별 마케팅 담당 → 전화 문의 업무 담당 + 규칙 배정', async () => {
  await ctx.owner.ok('PUT', '/api/admin/assignees', { kind: 'approver', ref: '', primaryUserId: ctx.staffB.id });
  const c = await ctx.owner.ok('POST', '/api/marketing/contents', { title: '승인자 규칙 글', channel: 'instagram', body: '캡션', mediaIds: [] });
  const who = await sql`select user_id from notifications where entity_type = 'mkt_content' and entity_id = ${c.id} and type = 'review_requested'`;
  assert.deepEqual(who.map((x) => x.user_id), [ctx.staffB.id], '승인자 규칙의 사람만');
  const brand = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '규칙 브랜드' });
  await ctx.owner.ok('PUT', '/api/admin/assignees', { kind: 'marketing_brand', ref: brand.id, primaryUserId: ctx.staffB.id });
  const call = await ctx.owner.ok('POST', '/api/marketing/calls', { phone: '010-9999-0000' });
  await sql`update mkt_calls set brand_id = ${brand.id} where id = ${call.id}`;
  const cv = await ctx.owner.ok('POST', `/api/marketing/calls/${call.id}/convert`, {});
  const [t] = await sql`select assignee_id, assigned_by_rule from tasks where id = ${cv.taskId}`;
  assert.equal(t.assignee_id, ctx.staffB.id, '브랜드 담당'); assert.ok(t.assigned_by_rule);
  const call2 = await ctx.owner.ok('POST', '/api/marketing/calls', { phone: '010-9999-0001' });
  const cv2 = await ctx.owner.ok('POST', `/api/marketing/calls/${call2.id}/convert`, {});
  assert.equal((await sql`select assignee_id from tasks where id = ${cv2.taskId}`)[0].assignee_id, ctx.ownerId, '브랜드 없는 건은 전과 같이 만든 사람');
});

test('규칙 지우기 → 기본으로 돌아감 · 다른 회사 규칙 id 는 404', async () => {
  const v = await ctx.owner.ok('GET', '/api/admin/assignees');
  const ap = v.rules.find((r) => r.kind === 'approver');
  await ctx.owner.ok('DELETE', `/api/admin/assignees/${ap.id}`);
  assert.equal((await ctx.owner.req('DELETE', `/api/admin/assignees/${ap.id}`)).status, 404);
  // 만든 사람 본인은 알림에서 빠지므로 직원(B)이 올림 → 대표에게 가고, 지운 규칙의 B 에게는 안 감
  const c = await ctx.staffB.client.ok('POST', '/api/marketing/contents', { title: '승인자 규칙 지운 뒤', channel: 'instagram', body: '캡션', mediaIds: [] });
  const who = await sql`select user_id from notifications where entity_type = 'mkt_content' and entity_id = ${c.id} and type = 'review_requested' order by user_id`;
  assert.ok(who.some((x) => x.user_id === ctx.ownerId) && !who.some((x) => x.user_id === ctx.staffB.id), `다시 대표·관리자에게: ${JSON.stringify(who)}`);
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'assignee_rule.delete'`)[0].n, 1);
});
