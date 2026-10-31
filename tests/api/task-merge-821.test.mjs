// 280차 #821(대표 10/31 "공동 업무는 개인업무 위쪽에 … 기존 개인업무 내용 지우고 공동 업무로 정리해서 위로 표기해주고 첨부나 댓글들도 합쳐주세요"):
// '각자 1건씩' 묶음 → 공동 업무 1건(요청자 본인 담당 업무 또는 먼저 만든 것을 남김) · 형제 업무의 댓글·첨부·체크리스트(같은 글은 하나, 체크 유지)·하위 업무를 옮김 ·
// 형제 업무는 휴지통 · 다른 담당은 함께 담당(이미 끝낸 사람은 내 몫 완료) · [공동 업무로 합치기] 권한(요청자·만든 사람·관리자) · 운영 기존 묶음은 정기 실행이 한 번 정리
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); };
const each = (title, ids) => ctx.owner.ok('POST', '/api/tasks', { title, assigneeId: ids[0], assigneeIds: ids, orgUnitId: ctx.hq, approvalRequired: false });
before(async () => { await resetDb(); srv = await startServer({ TASK_MERGE_BEFORE: '2099-01-01T00:00:00Z' }); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('[공동 업무로 합치기]: 댓글·첨부·체크리스트·하위 업무를 남길 업무로 · 형제 업무 휴지통 · 다른 담당은 함께 담당(끝낸 사람은 내 몫 완료) · 권한', async () => {
  const b = await each('11월 점검 보고', [ctx.staffA.id, ctx.staffB.id]);
  const [ta, tb] = (await sql`select id, assignee_id from tasks where batch_id = ${b.batchId} order by created_at`).sort((x) => (x.assignee_id === ctx.staffA.id ? -1 : 1)).map((x) => x.id);
  await ctx.staffA.client.ok('POST', `/api/tasks/${ta}/comments`, { body: 'A 의견: 1층 확인 끝' });
  await ctx.staffB.client.ok('POST', `/api/tasks/${tb}/comments`, { body: 'B 의견: 2층 사진 올림' });
  await ctx.owner.ok('POST', `/api/tasks/${ta}/checklist`, { text: '사진 찍기' });
  const ib = await ctx.owner.ok('POST', `/api/tasks/${tb}/checklist`, { text: '사진  찍기' }); // 같은 글(띄어쓰기만 다름)
  await ctx.owner.ok('POST', `/api/tasks/${tb}/checklist`, { text: '보고서 쓰기' });
  await sql`update task_checklist_items set done = true, done_by = ${ctx.staffB.id}, done_at = now() where id = ${ib.id ?? ib.item?.id ?? (await sql`select id from task_checklist_items where task_id = ${tb} and text = '사진  찍기'`)[0].id}`;
  await sql`insert into attachments (task_id, kind, url, file_name, created_by) values (${tb}, 'link', 'https://example.com/b.pdf', 'b.pdf', ${ctx.staffB.id})`;
  const sub = await ctx.owner.ok('POST', '/api/tasks', { title: 'B 하위', parentId: tb, assigneeId: ctx.staffB.id, orgUnitId: ctx.hq, approvalRequired: false });
  await ctx.staffB.client.ok('PATCH', `/api/tasks/${tb}`, { status: 'done' }).catch(async () => sql`update tasks set status = 'done', completed_at = now() where id = ${tb}`);
  // 권한: 요청자·만든 사람·관리자만
  assert.equal((await ctx.staffA.client.req('POST', `/api/tasks/batch/${b.batchId}/merge`, {})).status, 403);
  const r = await ctx.owner.ok('POST', `/api/tasks/batch/${b.batchId}/merge`, {});
  assert.equal(r.merged, 1);
  const keep = r.keep, gone = keep === ta ? tb : ta;
  const [k] = await sql`select batch_id, status, deleted_at, assignee_id from tasks where id = ${keep}`; const [g] = await sql`select deleted_at from tasks where id = ${gone}`;
  assert.deepEqual([k.batch_id, k.deleted_at, !!g.deleted_at], [null, null, true]);
  assert.notEqual(k.status, 'done', '한 사람만 끝냄 — 공동 업무는 진행');
  assert.deepEqual((await sql`select body from comments where task_id = ${keep} order by created_at`).map((x) => x.body), ['A 의견: 1층 확인 끝', 'B 의견: 2층 사진 올림']);
  assert.equal((await sql`select count(*)::int n from attachments where task_id = ${keep} and deleted_at is null`)[0].n, 1);
  const cl = await sql`select text, done from task_checklist_items where task_id = ${keep} order by sort`;
  assert.deepEqual(cl.map((x) => [x.text.replace(/\s+/g, ' '), x.done]), [['사진 찍기', true], ['보고서 쓰기', false]], '같은 글은 하나·체크 유지');
  assert.equal((await sql`select parent_id from tasks where id = ${sub.id}`)[0].parent_id, keep, '하위 업무도');
  const co = await sql`select user_id, done_at from task_assignees where task_id = ${keep}`;
  const other = k.assignee_id === ctx.staffA.id ? ctx.staffB.id : ctx.staffA.id;
  assert.deepEqual(co.map((x) => x.user_id), [other], '다른 담당은 함께 담당');
  if (other === ctx.staffB.id) assert.ok(co[0].done_at, '이미 끝낸 사람은 내 몫 완료');
  // 업무 화면: 공동 업무로 보임(함께 담당) · 묶음 표시 없음
  const t = (await ctx.staffB.client.ok('GET', `/api/tasks/${keep}`)).task;
  assert.equal(t.batch, null); assert.ok((t.co_assignees ?? []).length >= 1, JSON.stringify(t.co_assignees));
});

test('운영 기존 묶음 한 번 정리(정기 실행): 안 끝난 묶음만 합침 · 모두 끝난 묶음은 그대로 · 한 번 하면 다시 안 함(뒤에 만든 각자 1건씩은 그대로)', async () => {
  const open = await each('주간 매장 점검', [ctx.staffA.id, ctx.staffB.id, ctx.managerA.id]);
  const done = await each('지난주 보고', [ctx.staffA.id, ctx.staffB.id]);
  await sql`update tasks set status = 'done', completed_at = now() where batch_id = ${done.batchId}`;
  await tick();
  const o = await sql`select id, deleted_at, batch_id from tasks where id = any(${open.ids}::uuid[])`;
  assert.equal(o.filter((x) => !x.deleted_at).length, 1); assert.ok(o.every((x) => x.batch_id === null || x.deleted_at));
  const keep = o.find((x) => !x.deleted_at).id;
  assert.equal((await sql`select count(*)::int n from task_assignees where task_id = ${keep}`)[0].n, 2, '세 사람 = 주 담당 + 함께 담당 2');
  assert.equal((await sql`select count(*)::int n from tasks where batch_id = ${done.batchId} and deleted_at is null`)[0].n, 2, '모두 끝난 묶음은 기록 그대로');
  assert.ok((await sql`select 1 from app_settings where key = 'task_batch_merge_821'`).length, '한 번 했음 표시');
  const later = await each('다음 주 점검', [ctx.staffA.id, ctx.staffB.id]);
  await tick();
  assert.equal((await sql`select count(*)::int n from tasks where batch_id = ${later.batchId} and deleted_at is null`)[0].n, 2, '한 번 한 뒤에 만든 각자 1건씩은 그대로');
});
