// #1142(대표 11/24 위임 · 로컬 추천안): 입찰을 안 들어가거나 공고가 취소되면 업무·일정을 정리하고 공고는 영업 DB 에 사유와 함께 남긴다.
// ① 영업 › 입찰관리 [미참여](사유) → 이 공고로 만든 열린 업무는 휴지통(기록 남음) · 연결된 자동 일정(입찰 마감·현장설명회)은 삭제 · 공고는 '미참여' 탭에
// ② 발주처 공고 취소(자동 감지) → ①과 같은 정리를 자동으로 + 담당자 알림(업무 화면의 빨간 띠·[공고 취소로 완료] 없앰)
// ③ 업무 화면의 공통 [삭제](사유 선택) → 출처가 공고면 공고를 '미참여(업무에서 삭제)'로 · 휴지통에서 되살리면 공고 상태도 이전으로(일정은 361차 규칙대로 함께 돌아옴)
// 결정(참여·미참여·취소·되돌리기)은 영업에서, 업무 쪽은 공통 동작(완료·삭제)만 — #1143
import { db, type Sql } from '../db';
import { HttpError, badRequest, forbidden, notFound } from '../errors';
import { activity, audit } from '../log';
import { notify } from '../notifications';
import { assertSpace } from '../spaces';
import { tenantOf, type SessionUser } from '../types';
import { writesOpen } from './cutover';

export const NOENTRY = '미참여';
const SRC = 'opportunity_work';
const UUID = /^[0-9a-f-]{36}$/i;
/** 미참여 사유 고르기(영업 화면) — 직접 쓰기도 됨 */
export const NOENTRY_REASONS = ['일정이 맞지 않음', '참가 자격 미달', '수익성 낮음', '현장 여건', '기타'] as const;
/** 끝난 상태(미참여로 바꾸지 않음): 미참여·대상 아님·완료·결과(낙찰·미낙찰·유찰·공고 취소) */
const CLOSED = /^(미참여|대상\s?아님|완료|낙찰|미낙찰|유찰|공고 취소)$/;

type Rec = { tenant: string; src_id: string; status: string; data: any };
async function recordOf(sql: Sql, tenant: string, noticeId: string): Promise<Rec | null> {
  const [r] = await sql<Rec[]>`select tenant, src_id, status, data from sales_work_records where tenant = ${tenant} and src_tbl = ${SRC} and ref_id = ${noticeId} order by updated_at desc limit 1`;
  return r ?? null;
}

/**
 * 공고 업무 정리: 넘긴 입찰 업무(bid_task_id) + 이 공고로 자동으로 만든 열린 업무(직접 만든 업무 manual 은 그대로) → 휴지통(하위 업무 포함),
 * 연결된 자동 일정(bid_events + 업무가 모두 끝나면 숨기는 연결) → 삭제하고 task_event_deletions 에 남김(업무를 되살리면 일정도 돌아옴)
 */
export async function trashBidWork(sql: Sql, tenant: string, noticeId: string, d: any, actorId: string | null, reason: string, via: 'bid_skip' | 'notice_canceled' | 'task_deleted') {
  const main = typeof d?.bid_task_id === 'string' && UUID.test(d.bid_task_id) ? d.bid_task_id : null;
  const open = await sql<{ id: string; title: string; assignee_id: string | null; requested_by: string | null }[]>`
    select t.id, t.title, t.assignee_id, t.requested_by from tasks t join users cu on cu.id = t.created_by and cu.tenant = ${tenant}
    where t.deleted_at is null and t.status <> 'done' and t.parent_id is null
      and (t.id = ${main} or (t.sales_ref->>'kind' = 'bid' and t.sales_ref->>'id' = ${noticeId} and coalesce(t.sales_ref->>'manual', '') <> 'true'))`;
  const ids = open.map((t) => t.id);
  const evIds = new Set<string>(Object.values(d?.bid_events ?? {}).filter((x): x is string => typeof x === 'string' && UUID.test(x)));
  if (ids.length) for (const e of await sql<{ event_id: string }[]>`select event_id from event_tasks where task_id = any(${ids}::uuid[]) and hide_when_done`) evIds.add(e.event_id);
  const gone = ids.length ? await sql<{ id: string }[]>`update tasks set deleted_at = now(), updated_at = now(), version = version + 1 where (id = any(${ids}::uuid[]) or parent_id = any(${ids}::uuid[])) and deleted_at is null returning id` : [];
  if (gone.length) { const { hideTaskBlocks } = await import('../tasks'); await hideTaskBlocks(sql, gone.map((g) => g.id)); }
  for (const t of open) await activity(sql, 'task', t.id, actorId, 'deleted', { reason, via, noticeId });
  // 일정: 다른 살아 있는 업무에도 연결된 일정은 남김(361차 규칙)
  const evs = evIds.size ? await sql<{ id: string }[]>`update events e set deleted_at = now(), updated_at = now(), version = e.version + 1
    where e.id = any(${[...evIds]}::uuid[]) and e.deleted_at is null
      and not exists (select 1 from event_tasks et join tasks t on t.id = et.task_id where et.event_id = e.id and t.deleted_at is null and not (t.id = any(${ids}::uuid[])))
    returning e.id` : [];
  const owner = main && ids.includes(main) ? main : ids[0] ?? null;
  const co = ids.length ? (await sql<{ user_id: string }[]>`select distinct user_id from task_assignees where task_id = any(${ids}::uuid[])`).map((x) => x.user_id) : [];
  for (const e of evs) {
    if (owner) await sql`insert into task_event_deletions (task_id, event_id, deleted_by) values (${owner}, ${e.id}, ${actorId})`;
    await activity(sql, 'event', e.id, actorId, 'canceled', { reason: via, noticeId });
  }
  return { tasks: open, taskIds: ids, events: evs.length, co };
}

const pickPeople = (d: any, tasks: { assignee_id: string | null; requested_by: string | null }[], co: string[] = []) =>
  [...new Set([...(Array.isArray(d?.assignees) ? d.assignees : []), d?.handoff_by, ...tasks.flatMap((t) => [t.assignee_id, t.requested_by]), ...co].filter((x): x is string => typeof x === 'string' && UUID.test(x)))];

/** 공고를 '미참여'로(사유·누가·언제·이전 상태·휴지통으로 보낸 업무) — 영업 DB 미참여 탭 */
async function markNoEntry(sql: Sql, rec: Rec, by: string | null, reason: string, taskIds: string[], extra: Record<string, unknown> = {}) {
  const d = rec.data ?? {}; const at = new Date().toISOString();
  const nd = { ...d, status: NOENTRY, bid_result: d.bid_task_id ? 'skipped' : d.bid_result ?? null,
    bid_skip: { by, at, reason, prev: rec.status, taskIds, ...extra }, skip_by: by, skip_at: at, skip_reason: reason };
  await sql`update sales_work_records set status = ${NOENTRY}, data = ${sql.json(nd)}, updated_at = now() where tenant = ${rec.tenant} and src_tbl = ${SRC} and src_id = ${rec.src_id}`;
}

/** ① 영업 › 입찰관리 [미참여] — 넘긴 입찰 업무(결과 전)·자동 업무가 있는 공고. 담당자·넘긴 사람·관리자 */
export async function skipBid(u: SessionUser, i: { id: string; reason?: string | null }) {
  await assertSpace(u, 'sales'); const sql = db(); const t = tenantOf(u);
  if (!(await writesOpen(t))) throw new HttpError(409, 'sales_read_only', '영업관리 전환 전이라 워크인에서는 고칠 수 없습니다');
  const rec = await recordOf(sql, t, i.id);
  if (!rec) throw notFound('진행 기록이 없는 공고입니다 — 목록에서 [미참여]로 바꿔 주세요');
  if (CLOSED.test(String(rec.status ?? ''))) throw badRequest(`이미 '${rec.status}' 상태인 공고입니다`);
  const d = rec.data ?? {}; const assignees: string[] = Array.isArray(d.assignees) ? d.assignees : [];
  if (d.bid_task_id && !(['owner', 'admin'].includes(u.role) || d.handoff_by === u.id || assignees.includes(u.id))) throw forbidden('배정된 담당자·넘긴 사람·관리자만 미참여로 바꿀 수 있습니다');
  const reason = String(i.reason ?? '').trim().slice(0, 300) || '미참여';
  const r = await sql.begin(async (tx) => {
    const x = await trashBidWork(tx as unknown as Sql, t, i.id, d, u.id, reason, 'bid_skip');
    await markNoEntry(tx as unknown as Sql, rec, u.id, reason, x.taskIds, { events: x.events });
    return x;
  });
  await audit(sql, u.id, 'sales.bid_skip', 'sales_bid', i.id, { from: rec.status, reason, tasks: r.taskIds.length, events: r.events }).catch(() => {});
  const to = pickPeople(d, r.tasks, r.co).filter((x) => x !== u.id);
  if (to.length) await notify(sql, { userIds: to, type: 'bid_update', space: 'sales', title: `입찰 미참여: ${String(d.bid_name ?? r.tasks[0]?.title ?? '입찰 공고').replace(/^\[입찰\]\s*/, '').slice(0, 60)}`,
    body: `${u.name}님이 이 공고를 미참여로 정리했습니다(사유: ${reason}). 업무 ${r.taskIds.length}건은 휴지통(30일 안에 되살릴 수 있음), 일정 ${r.events}건은 지웠습니다.`,
    link: `/s/sales/hub?tab=bids&bt=noentry&bq=${encodeURIComponent(i.id)}`, entityType: 'task', entityId: r.taskIds[0] ?? null, actorId: u.id, push: true, dedupeKey: `sales:bid:skip:${i.id}:${Date.now()}` } as never).catch(() => {});
  return { ok: true, status: NOENTRY, tasks: r.taskIds.length, events: r.events };
}

/** ② 발주처 공고 취소(정기 점검) — ①과 같은 정리를 자동으로 + 담당자·요청자·넘긴 사람 알림. 진행 기록 상태는 호출한 쪽이 '공고 취소'로 */
export async function trashCanceledBid(sql: Sql, tenant: string, noticeId: string, d: any, c: { day: string | null; reason: string | null }) {
  const r = await trashBidWork(sql, tenant, noticeId, d, null, `발주처 공고 취소${c.reason ? ` — ${c.reason}` : ''}`.slice(0, 300), 'notice_canceled');
  if (!r.taskIds.length && !r.events) return r;
  const to = pickPeople(d, r.tasks, r.co);
  const name = String(d?.bid_name ?? r.tasks[0]?.title ?? '입찰 공고').replace(/^\[입찰\]\s*/, '').slice(0, 60);
  if (to.length) await notify(sql, { userIds: to, type: 'bid_update', space: 'sales', title: `공고 취소: ${name}`,
    body: `발주처가 이 공고를 취소했습니다${c.day ? `(${c.day})` : ''}${c.reason ? ` — 사유: ${c.reason.slice(0, 100)}` : ''}. 업무 ${r.taskIds.length}건은 휴지통(30일 안에 되살릴 수 있음), 일정 ${r.events}건은 지웠습니다. 재공고가 올라오면 그때 다시 넘겨 주세요.`,
    link: `/s/sales/hub?tab=bids&bt=all&bq=${encodeURIComponent(noticeId)}`, entityType: 'task', entityId: r.taskIds[0] ?? null, actorId: null, push: true, dedupeKey: `sales:bid:cancel-trash:${noticeId}` } as never).catch(() => {});
  return r;
}

/** ③ 업무 화면 공통 [삭제] 뒤: 출처가 공고(넘긴 입찰 업무·자동 업무)면 공고를 '미참여(업무에서 삭제)'로 — 이미 끝난 공고는 그대로 */
export async function bidTaskDeleted(sql: Sql, u: SessionUser, taskId: string, reason?: string | null) {
  const [t] = await sql<{ nid: string | null; manual: boolean }[]>`select sales_ref->>'id' as nid, coalesce(sales_ref->>'manual', '') = 'true' as manual from tasks where id = ${taskId} and sales_ref->>'kind' = 'bid'`;
  if (!t?.nid || t.manual) return null;
  const rec = await recordOf(sql, tenantOf(u), t.nid);
  if (!rec || CLOSED.test(String(rec.status ?? ''))) return null;
  if (rec.data?.bid_task_id && rec.data.bid_task_id !== taskId) return null; // 넘긴 공고는 그 입찰 업무를 지울 때만
  const why = ['업무에서 삭제', String(reason ?? '').trim()].filter(Boolean).join(' — ').slice(0, 300);
  // 넘긴 공고의 남은 자동 일정은 업무 삭제 창에서 고른 대로(기본 체크) — 여기서는 공고 상태만
  await markNoEntry(sql, rec, u.id, why, [taskId], { fromTask: true });
  return { noticeId: t.nid, status: NOENTRY };
}

/** 휴지통에서 되살림 → 그 업무 때문에 '미참여'가 된 공고는 이전 상태로(넘긴 공고면 '입찰 진행') */
export async function bidTasksRestored(sql: Sql, u: SessionUser, taskIds: string[]) {
  if (!taskIds.length) return 0;
  const recs = await sql<Rec[]>`select tenant, src_id, status, data from sales_work_records where tenant = ${tenantOf(u)} and src_tbl = ${SRC} and status = ${NOENTRY}
    and exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof(data->'bid_skip'->'taskIds') = 'array' then data->'bid_skip'->'taskIds' else '[]'::jsonb end) x where x = any(${taskIds}::text[]))`;
  for (const rec of recs) {
    const d = { ...(rec.data ?? {}) }; const prev = String(d.bid_skip?.prev ?? '') || (d.bid_task_id ? '입찰 진행' : '검토중');
    delete d.bid_skip; delete d.skip_by; delete d.skip_at; delete d.skip_reason; if (d.bid_result === 'skipped') d.bid_result = null;
    await sql`update sales_work_records set status = ${prev}, data = ${sql.json({ ...d, status: prev })}, updated_at = now() where tenant = ${rec.tenant} and src_tbl = ${SRC} and src_id = ${rec.src_id}`;
    await activity(sql, 'task', taskIds[0], u.id, 'updated', { reason: 'bid_skip_undone', noticeStatus: { from: NOENTRY, to: prev } }).catch(() => {});
  }
  return recs.length;
}

/** [미참여] 되돌리기(영업 화면): 그때 휴지통으로 보낸 업무를 되살림(일정도 함께 돌아옴) → 공고는 이전 상태로. 보낸 업무가 없으면 상태만 이전으로 */
export async function undoSkipBid(u: SessionUser, id: string) {
  await assertSpace(u, 'sales'); const sql = db(); const t = tenantOf(u);
  if (!(await writesOpen(t))) throw new HttpError(409, 'sales_read_only', '영업관리 전환 전이라 워크인에서는 고칠 수 없습니다');
  const rec = await recordOf(sql, t, id);
  if (!rec || rec.status !== NOENTRY) throw badRequest('미참여로 정리한 공고가 아닙니다');
  const ids: string[] = Array.isArray(rec.data?.bid_skip?.taskIds) ? rec.data.bid_skip.taskIds.filter((x: unknown): x is string => typeof x === 'string' && UUID.test(x)) : [];
  const { restoreTask } = await import('../tasks');
  let tasks = 0, events = 0;
  for (const x of ids) { try { const r = await restoreTask(u, x); tasks++; events += r.eventsRestored ?? 0; } catch { /* 이미 되살렸거나 30일 지남·권한 없음 */ } }
  const [still] = await sql<{ status: string }[]>`select status from sales_work_records where tenant = ${t} and src_tbl = ${SRC} and src_id = ${rec.src_id}`;
  if (still?.status === NOENTRY) await bidTasksRestored(sql, u, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']).then(async (n) => {
    if (n) return;
    const d = { ...(rec.data ?? {}) }; const prev = String(d.bid_skip?.prev ?? '') || (d.bid_task_id ? '입찰 진행' : '검토중');
    delete d.bid_skip; delete d.skip_by; delete d.skip_at; delete d.skip_reason; if (d.bid_result === 'skipped') d.bid_result = null;
    await sql`update sales_work_records set status = ${prev}, data = ${sql.json({ ...d, status: prev })}, updated_at = now() where tenant = ${t} and src_tbl = ${SRC} and src_id = ${rec.src_id}`;
  });
  await audit(sql, u.id, 'sales.bid_skip_undo', 'sales_bid', id, { tasks, events }).catch(() => {});
  const [after] = await sql<{ status: string }[]>`select status from sales_work_records where tenant = ${t} and src_tbl = ${SRC} and src_id = ${rec.src_id}`;
  return { ok: true, status: after?.status ?? null, tasks, events };
}
