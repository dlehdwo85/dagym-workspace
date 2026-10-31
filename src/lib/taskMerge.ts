// 280차 #821(대표 10/31 "공동 업무는 개인업무 위쪽에 … 기존 개인업무 내용 지우고 공동 업무로 정리해서 위로 표기해주고 첨부나 댓글들도 합쳐주세요"):
// '각자 1건씩'(같은 batch_id) 묶음을 함께 담당 1건으로 — 한 건을 남기고 형제 업무의 댓글·첨부·하위 업무·체크리스트를 옮긴 뒤 형제 업무는 휴지통(30일).
// 담당은 모두 남긴 업무의 함께 담당(누가 이미 끝냈으면 '내 몫 완료'). 운영의 기존 묶음은 정기 실행이 한 번 정리(mergeAllBatchesOnce).
import { db, type Sql } from './db';
import { activity, audit } from './log';
import { badRequest, forbidden, notFound } from './errors';
import { isAdmin } from './access';
import { tenantOf, type SessionUser } from './types';

type Row = { id: string; assignee_id: string | null; requested_by: string | null; created_by: string; status: string; assignee_ack_at: Date | null; completed_at: Date | null; title: string };
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** 묶음 하나를 공동 업무 1건으로(트랜잭션). 남길 업무 = 요청자 본인이 담당인 것 → 없으면 가장 먼저 만든 것 */
export async function mergeBatch(batchId: string, actorId: string | null) {
  return db().begin(async (tx) => {
    const sql = tx as unknown as Sql;
    const rows = await sql<Row[]>`select id, assignee_id, requested_by, created_by, status, assignee_ack_at, completed_at, title from tasks
      where batch_id = ${batchId} and deleted_at is null and parent_id is null order by created_at, id for update`;
    if (!rows.length) return null;
    if (rows.length === 1) { await sql`update tasks set batch_id = null, updated_at = now(), version = version + 1 where id = ${rows[0].id}`; return { keep: rows[0].id, merged: 0 }; }
    const keep = rows.find((r) => r.assignee_id && r.assignee_id === r.requested_by) ?? rows[0];
    const others = rows.filter((r) => r.id !== keep.id); const ids = others.map((o) => o.id);
    await sql`update comments set task_id = ${keep.id} where task_id = any(${ids}::uuid[])`;
    await sql`update attachments set task_id = ${keep.id} where task_id = any(${ids}::uuid[])`;
    await sql`update tasks set parent_id = ${keep.id}, updated_at = now(), version = version + 1 where parent_id = any(${ids}::uuid[]) and deleted_at is null`;
    await sql`update inquiries set task_id = ${keep.id} where task_id = any(${ids}::uuid[])`;
    // 체크리스트: 같은 글은 하나로(누가 체크했으면 체크 유지), 다른 글은 옮김
    const mine = await sql<{ id: string; text: string; done: boolean }[]>`select id, text, done from task_checklist_items where task_id = ${keep.id}`;
    const byText = new Map(mine.map((m) => [norm(m.text), m]));
    const theirs = await sql<{ id: string; text: string; done: boolean; done_by: string | null; done_at: Date | null }[]>`select id, text, done, done_by, done_at from task_checklist_items where task_id = any(${ids}::uuid[]) order by sort, id`;
    let sort = mine.length;
    for (const it of theirs) {
      const same = byText.get(norm(it.text));
      if (same) { if (it.done && !same.done) { await sql`update task_checklist_items set done = true, done_by = ${it.done_by}, done_at = ${it.done_at ?? new Date()} where id = ${same.id}`; same.done = true; } continue; }
      await sql`update task_checklist_items set task_id = ${keep.id}, sort = ${sort++} where id = ${it.id}`; byText.set(norm(it.text), { id: it.id, text: it.text, done: it.done });
    }
    // 담당: 남긴 업무의 담당 = 주 담당, 나머지 = 함께 담당(그 사람 업무가 끝났으면 내 몫 완료)
    for (const o of others) {
      if (!o.assignee_id || o.assignee_id === keep.assignee_id) continue;
      await sql`insert into task_assignees (task_id, user_id, added_by, acked_at, done_at) values (${keep.id}, ${o.assignee_id}, ${actorId}, ${o.assignee_ack_at}, ${o.status === 'done' ? o.completed_at ?? new Date() : null})
        on conflict (task_id, user_id) do update set done_at = coalesce(task_assignees.done_at, excluded.done_at), acked_at = coalesce(task_assignees.acked_at, excluded.acked_at)`;
    }
    const allDone = rows.every((r) => r.status === 'done');
    const status = allDone ? 'done' : keep.status === 'done' ? 'in_progress' : rows.some((r) => r.status === 'in_progress') && keep.status === 'todo' ? 'in_progress' : keep.status;
    await sql`update tasks set batch_id = null, status = ${status}, completed_at = ${allDone ? keep.completed_at ?? new Date() : null},
        assignee_done_at = case when ${keep.status === 'done'} then coalesce(assignee_done_at, completed_at, now()) else assignee_done_at end, updated_at = now(), version = version + 1 where id = ${keep.id}`;
    await sql`update tasks set deleted_at = now(), updated_at = now(), version = version + 1 where id = any(${ids}::uuid[])`;
    await activity(sql, 'task', keep.id, actorId, 'merged', { reason: 'batch_to_shared', from: ids }).catch(() => {});
    for (const id of ids) await activity(sql, 'task', id, actorId, 'merged_into', { into: keep.id }).catch(() => {});
    return { keep: keep.id, merged: ids.length };
  });
}

/** [공동 업무로 합치기] — 요청자·만든 사람·관리자 */
export async function mergeBatchByUser(u: SessionUser, batchId: string) {
  const [t] = await db()<{ requested_by: string | null; created_by: string; tenant: string }[]>`select t.requested_by, t.created_by, cu.tenant from tasks t join users cu on cu.id = t.created_by
    where t.batch_id = ${batchId} and t.deleted_at is null limit 1`;
  if (!t || t.tenant !== tenantOf(u)) throw notFound('묶음을 찾을 수 없습니다');
  if (!isAdmin(u) && t.requested_by !== u.id && t.created_by !== u.id) throw forbidden('요청한 사람·만든 사람·관리자만 합칠 수 있습니다');
  const r = await mergeBatch(batchId, u.id);
  if (!r) throw badRequest('합칠 업무가 없습니다');
  await audit(db(), u.id, 'task.batch_merge', 'task', r.keep, { batchId, merged: r.merged }).catch(() => {});
  return r;
}

/** 운영의 기존 묶음 한 번 정리 — 대표 지시(10/31 11시 KST) 전에 만든 묶음 중 아직 안 끝난 업무가 있는 것만(모두 끝난 묶음은 기록 그대로,
 *  그 뒤에 일부러 '각자 1건씩'으로 만든 묶음은 그대로). 정기 실행이 한 번에 50묶음씩, 다 하면 표시 */
const MERGE_BEFORE = () => process.env.TASK_MERGE_BEFORE || '2026-10-31T02:00:00Z';
export async function mergeAllBatchesOnce(max = 50) {
  const sql = db();
  const [doneFlag] = await sql<{ value: unknown }[]>`select value from app_settings where key = 'task_batch_merge_821'`;
  if (doneFlag) return { skipped: 'done' };
  const batches = await sql<{ batch_id: string }[]>`select batch_id from tasks where batch_id is not null and deleted_at is null and parent_id is null
    group by batch_id having count(*) > 1 and bool_or(status <> 'done') and min(created_at) < ${MERGE_BEFORE()} limit ${max}`;
  let merged = 0;
  for (const b of batches) { const r = await mergeBatch(b.batch_id, null).catch(() => null); if (r?.merged) merged++; }
  if (batches.length < max) await sql`insert into app_settings (key, value) values ('task_batch_merge_821', ${sql.json({ at: new Date().toISOString(), merged } as never)}) on conflict (key) do nothing`;
  return { batches: batches.length, merged };
}
