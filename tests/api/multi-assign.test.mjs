// 로컬 10/21 22:00 ① (#414): 부서장(김민수 역할 = dept_lead) 계정이 제목만 넣고 '3명에게 각각 만들기'(마감 11/16) → 각자 1건씩 — 장애(DB 쿼터) 시각과 겹쳤는지 확인용 재현
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, Client } from '../helpers.mjs';

let srv, ctx, sql, lead;
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: 'lead@dagym.test', name: '김부서장', role: 'dept_lead', orgUnitIds: [ctx.hq] });
  lead = new Client('lead');
  await lead.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'lead-pass-1234' });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('부서장: 제목만 + 3명 각각 + 마감 11/16 → 3건(묶음 id 같음), 담당자 알림 3건, 본인 포함도 됨', async () => {
  const me = (await lead.ok('GET', '/api/auth/me')).user.id;
  const body = { title: '11월 매장 점검', assigneeId: ctx.staffA.id, requestedById: me, dueDate: '2026-11-16', dueTime: null, projectId: null, priority: 'normal', recurrenceRule: null, reminderMinutes: null,
    assigneeIds: [ctx.staffA.id, ctx.staffB.id, ctx.managerA.id], parentId: undefined, orgUnitId: undefined, sectionId: null, approvalRequired: false }; // QuickAddTask 가 보내는 모양 그대로
  const r = await lead.ok('POST', '/api/tasks', body);
  assert.equal(r.ids.length, 3); assert.ok(r.batchId);
  const rows = await sql`select assignee_id, due_date::text d, requested_by, batch_id from tasks where id = any(${r.ids}::uuid[]) order by created_at`;
  assert.deepEqual(rows.map((x) => x.assignee_id).sort(), [ctx.staffA.id, ctx.staffB.id, ctx.managerA.id].sort());
  assert.ok(rows.every((x) => x.d === '2026-11-16' && x.requested_by === me && x.batch_id === r.batchId));
  assert.equal((await sql`select count(*)::int n from notifications where type = 'task_assigned' and entity_id = any(${r.ids}::uuid[])`)[0].n, 3, '담당자 3명 배정 알림');
  // 본인을 포함한 3명(김민수 사례: 부서장이 자기도 넣음)
  const r2 = await lead.ok('POST', '/api/tasks', { title: '본인 포함', assigneeId: me, assigneeIds: [me, ctx.staffA.id, ctx.staffB.id], requestedById: me, dueDate: '2026-11-16', approvalRequired: false });
  assert.equal(r2.ids.length, 3);
  // 직원(staff)도 서로 배정 가능(V3)
  const r3 = await ctx.staffA.client.ok('POST', '/api/tasks', { title: '직원이 3명에게', assigneeId: ctx.staffB.id, assigneeIds: [ctx.staffB.id, ctx.managerA.id, ctx.ownerId], requestedById: ctx.staffA.id, dueDate: '2026-11-16', approvalRequired: false });
  assert.equal(r3.ids.length, 3);
});
