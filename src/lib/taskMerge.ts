// 280차 #821(대표 10/31 "공동 업무는 개인업무 위쪽에 … 기존 개인업무 내용 지우고 공동 업무로 정리해서 위로 표기해주고 첨부나 댓글들도 합쳐주세요"):
// '각자 1건씩'(같은 batch_id) 묶음을 함께 담당 1건으로 — 한 건을 남기고 형제 업무의 댓글·첨부·하위 업무·체크리스트를 옮긴 뒤 형제 업무는 휴지통(30일).
// 담당은 모두 남긴 업무의 함께 담당(누가 이미 끝냈으면 '내 몫 완료'). 운영의 기존 묶음은 정기 실행이 한 번 정리(mergeAllBatchesOnce).
// 327차(로컬 11/02 9 — 대표 '사람별로 따로 만든 같은 업무를 내용 합쳐서 공동 업무로'): 같은 batch_id 가 없어도 같은 제목·같은 요청자·만든 시각이 10분 안인 업무 묶음을 찾아(duplicateSets)
// 같은 방식으로 합친다(mergeSetsByUser) — 실행 권한은 요청자(없으면 만든 사람)와 관리자. 담당이 한 사람뿐인 묶음(시험 데이터)·만든 시각이 먼 것(주차 다른 자동 알림)은 묶음으로 보지 않음.
import { db, type Sql } from './db';
import { activity, audit } from './log';
import { badRequest, forbidden, notFound } from './errors';
import { isAdmin } from './access';
import { tenantOf, type SessionUser } from './types';

type Row = { id: string; assignee_id: string | null; requested_by: string | null; created_by: string; status: string; assignee_ack_at: Date | null; completed_at: Date | null; title: string; due: string | null; tm: string | null; sales_ref: any };
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** 묶음(같은 batch_id) 하나를 공동 업무 1건으로 — 327차부터 mergeTaskIds 로 */
export async function mergeBatch(batchId: string, actorId: string | null) {
  const rows = await db()<{ id: string }[]>`select id from tasks where batch_id = ${batchId} and deleted_at is null and parent_id is null`;
  if (!rows.length) return null;
  return mergeTaskIds(rows.map((r) => r.id), actorId, 'batch_to_shared');
}
/** 업무 id 묶음 하나를 공동 업무 1건으로(트랜잭션). 남길 업무 = 요청자 본인이 담당인 것 → 없으면 가장 먼저 만든 것.
 *  댓글·첨부·하위 업무·문의 연결·체크리스트(같은 글은 하나, 체크 유지)를 옮기고 다른 담당은 함께 담당(끝낸 사람은 내 몫 완료) · 형제 업무는 휴지통 */
export async function mergeTaskIds(ids: string[], actorId: string | null, why: 'batch_to_shared' | 'dupes_to_shared' = 'batch_to_shared') {
  return db().begin(async (tx) => {
    const sql = tx as unknown as Sql;
    const rows = await sql<Row[]>`select id, assignee_id, requested_by, created_by, status, assignee_ack_at, completed_at, title, due_date::text as due, to_char(due_time, 'HH24:MI') as tm, sales_ref from tasks
      where id = any(${ids}::uuid[]) and deleted_at is null and parent_id is null order by created_at, id for update`;
    if (!rows.length) return null;
    if (rows.length === 1) { await sql`update tasks set batch_id = null, updated_at = now(), version = version + 1 where id = ${rows[0].id} and batch_id is not null`; return { keep: rows[0].id, merged: 0 }; }
    const keep = rows.find((r) => r.assignee_id && r.assignee_id === r.requested_by) ?? rows[0];
    const others = rows.filter((r) => r.id !== keep.id); const gone = others.map((o) => o.id);
    await sql`update comments set task_id = ${keep.id} where task_id = any(${gone}::uuid[])`;
    await sql`update attachments set task_id = ${keep.id} where task_id = any(${gone}::uuid[])`;
    await sql`update tasks set parent_id = ${keep.id}, updated_at = now(), version = version + 1 where parent_id = any(${gone}::uuid[]) and deleted_at is null`;
    await sql`update inquiries set task_id = ${keep.id} where task_id = any(${gone}::uuid[])`;
    // 체크리스트: 같은 글은 하나로(누가 체크했으면 체크 유지), 다른 글은 옮김
    const mine = await sql<{ id: string; text: string; done: boolean }[]>`select id, text, done from task_checklist_items where task_id = ${keep.id}`;
    const byText = new Map(mine.map((m) => [norm(m.text), m]));
    const theirs = await sql<{ id: string; text: string; done: boolean; done_by: string | null; done_at: Date | null }[]>`select id, text, done, done_by, done_at from task_checklist_items where task_id = any(${gone}::uuid[]) order by sort, id`;
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
    // 331차(대표 '업무 마감일은 입찰 마감일과 동일하게' · 로컬: 합칠 때 가장 이른 마감을 골라 더 나빠짐): 합친 업무의 마감 = 공고 업무면 공고 입찰 마감 일시, 아니면 가장 늦은 마감
    const bidId = rows.map((r) => (r.sales_ref?.kind === 'bid' && r.sales_ref?.id ? String(r.sales_ref.id) : '')).find(Boolean) || null;
    const bd = bidId ? (await (await import('./sales/bidTasks')).noticeDues(sql, [bidId])).get(bidId) ?? null : null;
    const latest = rows.filter((r) => r.due).sort((a, b) => `${b.due}${b.tm ?? ''}`.localeCompare(`${a.due}${a.tm ?? ''}`))[0] ?? null;
    const due = bd ?? (latest ? { day: latest.due!, time: latest.tm ?? null } : null);
    const dueMoved = !!due && (due.day !== keep.due || (due.time ?? null) !== (keep.tm ?? null));
    const dueSet = dueMoved ? sql`due_date = ${due!.day}::date, due_time = ${due!.time}::time,` : sql``;
    const allDone = rows.every((r) => r.status === 'done');
    const status = allDone ? 'done' : keep.status === 'done' ? 'in_progress' : rows.some((r) => r.status === 'in_progress') && keep.status === 'todo' ? 'in_progress' : keep.status;
    await sql`update tasks set ${dueSet} batch_id = null, status = ${status}, completed_at = ${allDone ? keep.completed_at ?? new Date() : null},
        assignee_done_at = case when ${keep.status === 'done'} then coalesce(assignee_done_at, completed_at, now()) else assignee_done_at end, updated_at = now(), version = version + 1 where id = ${keep.id}`;
    await sql`update tasks set deleted_at = now(), updated_at = now(), version = version + 1 where id = any(${gone}::uuid[])`;
    await activity(sql, 'task', keep.id, actorId, 'merged', { reason: why, from: gone, ...(dueMoved ? { dueDate: { from: keep.due, to: due!.day }, dueRule: bd ? 'bid_deadline' : 'latest' } : {}) }).catch(() => {});
    for (const id of gone) await activity(sql, 'task', id, actorId, 'merged_into', { into: keep.id, reason: why }).catch(() => {});
    return { keep: keep.id, merged: gone.length };
  });
}

// ── 327차: 사람마다 따로 만든 같은 업무 찾기·합치기 ─────────────────────────
const WINDOW_S = 600; // 같은 제목·요청자라도 만든 시각이 10분 넘게 다르면 다른 일(주차 다른 자동 알림·반복 업무)
type DupeRow = { id: string; title: string; batch_id: string | null; requested_by: string | null; created_by: string; created_at: Date; assignee_id: string | null; status: string; due: string | null; assignee_name: string | null; requester_name: string | null };
export type DupeSet = { key: string; title: string; batch: boolean; requesterId: string; requesterName: string | null; createdAt: string;
  tasks: { id: string; assigneeId: string | null; assigneeName: string | null; status: string; dueDate: string | null }[] };
const requesterOf = (r: { requested_by: string | null; created_by: string }) => r.requested_by ?? r.created_by;
/** 열린 업무 가운데 '각자 1건씩' 묶음(batch_id) 또는 같은 제목·같은 요청자·만든 시각 10분 안 묶음(담당이 2명 이상 다름) — 이 사람이 합칠 수 있는 것만(요청자 본인·관리자) */
export async function duplicateSets(u: SessionUser): Promise<DupeSet[]> {
  const sql = db(); const t = tenantOf(u);
  const rows = await sql<DupeRow[]>`select t.id, t.title, t.batch_id, t.requested_by, t.created_by, t.created_at, t.assignee_id, t.status, t.due_date::text as due, au.name as assignee_name, rq.name as requester_name
    from tasks t join users cu on cu.id = t.created_by left join users au on au.id = t.assignee_id left join users rq on rq.id = coalesce(t.requested_by, t.created_by)
    where cu.tenant = ${t} and t.deleted_at is null and t.parent_id is null and t.status <> 'done'
      and (t.batch_id is not null or exists (select 1 from tasks o join users ocu on ocu.id = o.created_by where ocu.tenant = ${t} and o.id <> t.id and o.deleted_at is null and o.parent_id is null and o.status <> 'done'
        and lower(regexp_replace(o.title, '\\s+', ' ', 'g')) = lower(regexp_replace(t.title, '\\s+', ' ', 'g'))
        and coalesce(o.requested_by, o.created_by) = coalesce(t.requested_by, t.created_by)
        and abs(extract(epoch from (o.created_at - t.created_at))) < ${WINDOW_S}))
    order by t.created_at, t.id`;
  const groups = new Map<string, DupeRow[]>();
  for (const r of rows) {
    let key = r.batch_id ? `b:${r.batch_id}` : `t:${norm(r.title)}|${requesterOf(r)}`;
    if (!r.batch_id) { let n = 0; while (groups.has(key) && Math.abs(+new Date(groups.get(key)![0].created_at) - +new Date(r.created_at)) >= WINDOW_S * 1000) key = `t:${norm(r.title)}|${requesterOf(r)}#${++n}`; }
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: DupeSet[] = [];
  for (const [key, rs] of groups) {
    if (rs.length < 2 || new Set(rs.map((r) => r.assignee_id ?? 'none')).size < 2) continue;
    if (!isAdmin(u) && !rs.every((r) => requesterOf(r) === u.id)) continue;
    out.push({ key, title: rs[0].title, batch: !!rs[0].batch_id, requesterId: requesterOf(rs[0]), requesterName: rs[0].requester_name, createdAt: new Date(rs[0].created_at).toISOString(),
      tasks: rs.map((r) => ({ id: r.id, assigneeId: r.assignee_id, assigneeName: r.assignee_name, status: r.status, dueDate: r.due })) });
  }
  return out;
}
/** 고른 묶음들을 공동 업무로 — 묶음마다 같은 batch_id 또는 같은 제목·요청자인지, 요청자 본인·관리자인지 다시 확인 */
export async function mergeSetsByUser(u: SessionUser, sets: string[][]) {
  const sql = db(); const t = tenantOf(u);
  const merged: { keep: string; merged: number; title: string }[] = []; const skipped: { ids: string[]; why: string }[] = [];
  for (const raw of sets) {
    const ids = [...new Set(raw)];
    const rows = await sql<{ id: string; title: string; batch_id: string | null; requested_by: string | null; created_by: string }[]>`select t.id, t.title, t.batch_id, t.requested_by, t.created_by from tasks t join users cu on cu.id = t.created_by
      where t.id = any(${ids}::uuid[]) and cu.tenant = ${t} and t.deleted_at is null and t.parent_id is null and t.status <> 'done'`;
    if (rows.length < 2 || rows.length !== ids.length) { skipped.push({ ids, why: '이미 합쳐졌거나 끝난 업무가 섞여 있습니다' }); continue; }
    const sameBatch = rows.every((r) => !!r.batch_id && r.batch_id === rows[0].batch_id);
    const sameTitle = rows.every((r) => norm(r.title) === norm(rows[0].title) && requesterOf(r) === requesterOf(rows[0]));
    if (!sameBatch && !sameTitle) throw badRequest('같은 묶음(각자 1건씩) 또는 같은 제목·같은 요청자의 업무만 합칠 수 있습니다');
    if (!isAdmin(u) && !rows.every((r) => requesterOf(r) === u.id)) throw forbidden('요청한 사람·관리자만 합칠 수 있습니다');
    const r = await mergeTaskIds(ids, u.id, 'dupes_to_shared');
    if (!r) { skipped.push({ ids, why: '합칠 업무가 없습니다' }); continue; }
    merged.push({ ...r, title: rows[0].title });
    await audit(sql, u.id, 'task.dupes_merge', 'task', r.keep, { ids, merged: r.merged }).catch(() => {});
  }
  return { merged, skipped };
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
