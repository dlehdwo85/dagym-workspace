import { z } from 'zod';
import { db, type Sql } from '../db';
import { zUuid } from '../api';
import { HttpError, badRequest, forbidden, notFound } from '../errors';
import { notify } from '../notifications';
import { assertSpace } from '../spaces';
import { tenantOf, type SessionUser } from '../types';
import { writesOpen } from './cutover';
import { WORK_KINDS, type WorkKind, workRecord } from './work';

/**
 * 대표 10/21 12:00 영업 재편 1) [영업 진행으로 넘기기] — 입찰·공고와 영업 DB(신규단지·시설·협력사) 각 행에서:
 * ① 담당자 1명 이상 선택 ② 리드 생성(담당 = 첫 담당자) + 원 DB 행 상태 '영업 중' ③ 담당자마다 업무 "검토·첫 연락"(마감 = 참가신청/입찰 마감 전날)
 * ④ 공고의 현장설명회·참가신청 마감·개찰·입찰 마감이 있으면 회사 공용 캘린더에 일정(참석 = 담당자, 알림 하루 전·1시간 전) ⑤ 담당자에게 배정 알림.
 * 문구·기본값은 업종 중립(회사 고유 표현 없음).
 */
export const HANDOFF_STATUS = '영업 중';
export const REVERTED_STATUS = '되돌림';
export const handoffInput = z.object({ kind: z.enum(WORK_KINDS), id: z.string().min(1).max(100), assigneeIds: z.array(zUuid).min(1).max(10), note: z.string().trim().max(500).optional() });
const ITEM_TBL: Record<WorkKind, string> = { bid: 'procurement_notices', building: 'building_sales_pipeline', facility: 'operating_facility_prospects', vendor: 'vendor_registrations' };
const SRC_TBL: Record<WorkKind, string> = { bid: 'opportunity_work', building: 'opportunity_work', facility: 'operating_facility_prospects__progress', vendor: 'vendor_registrations__progress' };
/** #408 종류 이름은 회사 업종 템플릿에서(공고는 공통) */
const kindNames = async (tenant: string): Promise<Record<WorkKind, string>> => { const k = (await (await import('./options')).salesTerms(tenant)).kind; return { bid: '공고', building: k.building, facility: k.facility, vendor: k.vendor }; };
const pick = (o: any, ...keys: string[]) => { for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return null; };
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
/** 날짜(또는 일시) 문자열 → {day, iso(KST)} — 시각이 없으면 하루 종일 */
function when(v: unknown): { day: string; start: string; end: string; allDay: boolean } | null {
  const s = String(v ?? '').trim(); if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/); if (!m) { const d = new Date(s); if (Number.isNaN(d.getTime())) return null; return { day: ymd(d), start: d.toISOString(), end: new Date(d.getTime() + 3600e3).toISOString(), allDay: false }; }
  if (m[2]) { const st = new Date(`${m[1]}T${m[2]}:${m[3]}:00+09:00`); return { day: m[1], start: st.toISOString(), end: new Date(st.getTime() + 3600e3).toISOString(), allDay: false }; }
  const st = new Date(`${m[1]}T00:00:00+09:00`); return { day: m[1], start: st.toISOString(), end: new Date(st.getTime() + 864e5).toISOString(), allDay: true };
}
/** 넘길 수 있는 사람: 영업 공간 구성원 + 관리자 */
export async function handoffPeople(u: SessionUser, kind?: string | null) {
  await assertSpace(u, 'sales'); const t = tenantOf(u);
  // #100 담당자 지정: 원천별 영업 담당 규칙이 있으면 기본 선택(부재면 부 담당)
  const rule = await (await import('../assignees')).resolveAssignee(db(), t, 'sales_source', (WORK_KINDS as readonly string[]).includes(String(kind)) ? String(kind) : '').catch(() => null);
  const people = await db()<{ id: string; name: string; role: string; title: string | null }[]>`select u.id, u.name, u.role, u.title from users u left join space_members m on m.user_id = u.id and m.tenant = u.tenant
    where u.tenant = ${t} and u.status = 'active' and not u.is_demo and (u.role in ('owner', 'admin') or 'sales' = any(coalesce(m.spaces, '{}'))) order by (u.id = ${u.id}) desc, u.name`;
  return { people, me: u.id, suggested: rule && people.some((p) => p.id === rule.userId) ? rule.userId : null, suggestedByRule: rule?.ruleId ?? null };
}
export async function handoff(u: SessionUser, i: z.infer<typeof handoffInput>) {
  await assertSpace(u, 'sales'); const t = tenantOf(u); const sql = db();
  const [row] = await sql<{ row: any }[]>`select row from sales_src_rows where scope = 'global' and tbl = ${ITEM_TBL[i.kind]} and src_id = ${i.id} and not gone`;
  if (!row) throw notFound('대상을 찾을 수 없습니다');
  const r = row.row;
  if (!(await writesOpen(t))) throw new HttpError(409, 'sales_read_only', '영업관리 전환 전이라 워크인에서는 넘길 수 없습니다');
  const KIND_NAME = await kindNames(t);
  const cur = await workRecord(sql, t, i.kind, i.id);
  if (cur?.lead_id) throw new HttpError(409, 'already', '이미 영업 진행으로 넘긴 건입니다 — 리드에서 이어서 진행하세요');
  const ids = [...new Set(i.assigneeIds)];
  const people = (await handoffPeople(u)).people.filter((p) => ids.includes(p.id));
  if (people.length !== ids.length) throw badRequest('담당자는 영업 공간 구성원·관리자 중에서 골라야 합니다');
  const name = (i.kind === 'bid' ? [pick(r, 'complex_name', 'facility_name'), pick(r, 'title', 'notice_title', 'bid_name')].filter(Boolean).join(' ') : String(pick(r, 'name', 'complex_name', 'company', 'company_name', 'facility_name', 'title') ?? '')).trim() || KIND_NAME[i.kind];
  // 공고 일정 칸(원천마다 이름이 달라 후보 순서로)
  const dates = i.kind === 'bid' ? [
    ['현장설명회', when(pick(r, 'site_briefing_at', 'briefing_at', 'explanation_at', 'field_briefing_at', 'site_visit_at'))],
    ['참가신청 마감', when(pick(r, 'participation_deadline_at', 'registration_deadline_at', 'application_deadline_at'))],
    ['입찰 마감', when(pick(r, 'deadline_at', 'close_at', 'bid_close_at', 'closing_date', 'end_date'))],
    ['개찰', when(pick(r, 'opening_at', 'open_at', 'opening_date'))]] as [string, ReturnType<typeof when>][] : [];
  const td = ymd(new Date());
  const future = dates.filter(([, w]) => w && w.day >= td) as [string, NonNullable<ReturnType<typeof when>>][];
  // 업무 마감 = 참가신청 마감 또는 입찰 마감 전날(오늘 이후), 없으면 3일 뒤
  const firstDl = future.find(([l]) => l === '참가신청 마감')?.[1] ?? future.find(([l]) => l === '입찰 마감')?.[1] ?? null;
  const dayBefore = (day: string) => ymd(new Date(Date.parse(`${day}T12:00:00+09:00`) - 864e5));
  const due = firstDl ? (dayBefore(firstDl.day) >= td ? dayBefore(firstDl.day) : firstDl.day) : ymd(new Date(Date.now() + 3 * 864e5));
  const leadId = await sql.begin(async (tx) => {
    const [l] = await tx<{ id: string }[]>`insert into sales_leads (tenant, name, status, facility_type, region, owner_id, contact_name, phone, memo, src, next_contact_date)
      values (${t}, ${name}, '신규리드', ${pick(r, 'facility_type', 'building_type', 'category') ?? null}, ${pick(r, 'region', 'sido') ?? null}, ${ids[0]}, ${pick(r, 'contact_name', 'manager_name') ?? null},
        ${pick(r, 'office_phone', 'management_phone', 'phone', 'contact_phone') ?? null}, ${[`${KIND_NAME[i.kind]}에서 넘김`, i.note].filter(Boolean).join(' — ')}, ${tx.json({ from: i.kind, id: i.id, handoff: true, assignees: ids, by: u.id })}, ${due}) returning id`;
    await tx`insert into sales_status_log (tenant, lead_id, from_status, to_status, reason, changed_by) values (${t}, ${l.id}, null, '신규리드', ${`영업 진행으로 넘김(담당 ${people.map((p) => p.name).join('·')})`}, ${u.id})`;
    const d = { ...(cur?.data ?? {}), ...(i.kind === 'facility' ? { contact_status: HANDOFF_STATUS } : { status: HANDOFF_STATUS }), lead_id: l.id, handoff_by: u.id, handoff_at: new Date().toISOString(), assignees: ids, handoff_prev_status: cur?.status ?? null,
      ...(i.kind === 'bid' ? { notice_id: i.id } : i.kind === 'building' ? { source_id: i.id, source_type: 'building' } : {}) };
    const srcId = cur?.src_id ?? (SRC_TBL[i.kind] === 'opportunity_work' ? `w:${i.kind}:${i.id}` : i.id);
    await tx`insert into sales_work_records (tenant, src_tbl, src_id, ref_id, status, lead_id, data) values (${t}, ${SRC_TBL[i.kind]}, ${srcId}, ${i.id}, ${HANDOFF_STATUS}, ${l.id}, ${tx.json(d)})
      on conflict (tenant, src_tbl, src_id) do update set status = excluded.status, lead_id = excluded.lead_id, data = excluded.data, updated_at = now()`;
    return l.id;
  });
  // ③ 담당자마다 업무(검토·첫 연락) — 영업 공간 업무(sales_ref·lead_id), 요청자 = 넘긴 사람
  const { createTask } = await import('../tasks');
  const link = i.kind === 'bid' ? `/s/sales/bids?tab=working&q=${encodeURIComponent(i.id)}` : `/s/sales/hub?tab=${i.kind === 'building' ? 'buildings' : i.kind === 'facility' ? 'facilities' : 'vendors'}`;
  const taskIds: string[] = [];
  for (const a of ids) {
    const task = await createTask(u, { title: `[영업] ${name} — 검토·첫 연락`, description: `${KIND_NAME[i.kind]}에서 영업 진행으로 넘어온 건입니다. 내용을 검토하고 첫 연락을 하세요.${future.length ? `\n일정: ${future.map(([l, w]) => `${l} ${w.day}`).join(' · ')}` : ''}${i.note ? `\n메모: ${i.note}` : ''}\n원천: ${link}\n리드: /s/sales/leads?id=${leadId}`,
      space: 'sales', assigneeId: a, requestedById: u.id, dueDate: due, approvalRequired: false, tags: ['영업', KIND_NAME[i.kind]] } as never, { quiet: a === u.id, skipQuota: true });
    await sql`update tasks set sales_ref = ${sql.json({ kind: i.kind, id: i.id, name, leadId, handoff: true })}, lead_id = ${leadId} where id = ${task.id}`;
    taskIds.push(task.id);
  }
  // ④ 일정: 회사 공용 캘린더(없으면 건너뜀) — 참석 = 담당자, 알림 하루 전·1시간 전
  const eventIds: string[] = []; const eventErrors: string[] = [];
  if (future.length) {
    const [cal] = await sql<{ id: string }[]>`select id from calendars where type = 'company' and tenant = ${t} order by created_at limit 1`;
    if (cal) { const { createEvent } = await import('../events');
      for (const [label, w] of future) {
        try { const ev: any = await createEvent(u, { calendarId: cal.id, title: `[영업] ${label} · ${name}`.slice(0, 200), description: `${KIND_NAME[i.kind]} 일정 — 담당 ${people.map((p) => p.name).join('·')}\n원천: ${link}\n리드: /s/sales/leads?id=${leadId}`, start: w.start, end: w.end, allDay: w.allDay, leadId, attendeeIds: ids, reminderMinutes: w.allDay ? [1440] : [1440, 60] } as never); eventIds.push(String(ev?.id ?? ev?.event?.id ?? '')); }
        catch (e: any) { eventErrors.push(`${label}: ${String(e?.message ?? e).slice(0, 120)}`); }
      }
    } else eventErrors.push('회사 공용 캘린더가 없어 일정은 만들지 않았습니다');
  }
  // 되돌리기(영업 재편 2)용으로 만든 업무·일정 id 를 리드에 남김
  await sql`update sales_leads set src = coalesce(src, '{}'::jsonb) || ${sql.json({ taskIds, eventIds: eventIds.filter(Boolean) })} where id = ${leadId}`;
  // ⑤ 배정 알림(넘긴 본인 제외)
  await notify(sql, { userIds: ids.filter((x) => x !== u.id), type: 'assigned', space: 'sales', title: `영업 배정: ${name.slice(0, 60)}`, body: `${u.name}님이 ${KIND_NAME[i.kind]}을(를) 영업 진행으로 넘겼습니다 — 검토·첫 연락 (마감 ${due})`, link: `/s/sales/leads?id=${leadId}`, entityType: 'sales_lead', entityId: leadId, actorId: u.id, push: true, dedupeKey: `sales:handoff:${leadId}` } as never).catch(() => {});
  return { leadId, status: HANDOFF_STATUS, taskIds, eventIds: eventIds.filter(Boolean), eventErrors, due, dates: future.map(([l, w]) => ({ label: l, day: w.day })) };
}

/**
 * 영업 재편 2) [배정 이전으로 되돌리기] — 배정된 담당자·넘긴 사람·관리자가 리드 상세에서:
 * 만든 업무는 취소(소프트 삭제 + 활동 기록), 일정은 삭제(소프트), 원 행은 넘기기 전 상태로(lead_id 해제), 리드는 '되돌림'(상태 기록·사유), 담당자에게 알림.
 */
export const revertInput = z.object({ leadId: zUuid, reason: z.string().trim().max(300).optional() });
export async function revertHandoff(u: SessionUser, i: z.infer<typeof revertInput>) {
  await assertSpace(u, 'sales'); const t = tenantOf(u); const sql = db();
  const [l] = await sql<{ id: string; name: string; status: string; owner_id: string | null; src: any }[]>`select id, name, status, owner_id, src from sales_leads where id = ${i.leadId} and tenant = ${t} and deleted_at is null`;
  if (!l || !l.src?.handoff) throw notFound('넘기기로 만든 리드가 아닙니다');
  if (l.status === REVERTED_STATUS) throw new HttpError(409, 'already', '이미 되돌린 리드입니다');
  const assignees: string[] = Array.isArray(l.src.assignees) ? l.src.assignees : [];
  const can = ['owner', 'admin'].includes(u.role) || l.owner_id === u.id || l.src.by === u.id || assignees.includes(u.id);
  if (!can) throw forbidden('배정된 담당자·넘긴 사람·관리자만 되돌릴 수 있습니다');
  const taskIds: string[] = Array.isArray(l.src.taskIds) ? l.src.taskIds : [];
  const eventIds: string[] = Array.isArray(l.src.eventIds) ? l.src.eventIds : [];
  const { activity } = await import('../log');
  const out = await sql.begin(async (tx) => {
    // 업무 취소(끝나지 않은 것만; 이력은 활동 기록으로)
    const tasks = taskIds.length ? await tx<{ id: string; assignee_id: string | null }[]>`update tasks set deleted_at = now(), updated_at = now(), version = version + 1 where id = any(${taskIds}::uuid[]) and deleted_at is null and status <> 'done' returning id, assignee_id` : [];
    for (const tk of tasks) await activity(tx, 'task', tk.id, u.id, 'canceled', { reason: 'sales_handoff_revert', leadId: l.id, note: i.reason ?? null });
    const events = eventIds.length ? await tx<{ id: string }[]>`update events set deleted_at = now(), version = version + 1 where id = any(${eventIds}::uuid[]) and deleted_at is null returning id` : [];
    for (const ev of events) await activity(tx, 'event', ev.id, u.id, 'canceled', { reason: 'sales_handoff_revert', leadId: l.id });
    // 원 행: 넘기기 전 상태로, 리드 연결 해제
    const recs = await tx<{ src_tbl: string; src_id: string; data: any }[]>`select src_tbl, src_id, data from sales_work_records where tenant = ${t} and lead_id = ${l.id}`;
    for (const w of recs) {
      const prev = w.data?.handoff_prev_status ?? null; const d = { ...w.data }; delete d.lead_id; delete d.handoff_by; delete d.handoff_at; delete d.assignees; delete d.handoff_prev_status;
      if (w.src_tbl === 'operating_facility_prospects__progress') d.contact_status = prev; else d.status = prev;
      d.reverted_at = new Date().toISOString(); d.reverted_by = u.id;
      if (prev) await tx`update sales_work_records set status = ${prev}, lead_id = null, data = ${tx.json(d)}, updated_at = now() where tenant = ${t} and src_tbl = ${w.src_tbl} and src_id = ${w.src_id}`;
      else await tx`delete from sales_work_records where tenant = ${t} and src_tbl = ${w.src_tbl} and src_id = ${w.src_id}`;
    }
    await tx`update sales_leads set status = ${REVERTED_STATUS}, src = coalesce(src, '{}'::jsonb) || ${tx.json({ reverted: { by: u.id, at: new Date().toISOString(), reason: i.reason ?? null, tasks: tasks.length, events: events.length } })}, updated_at = now() where id = ${l.id}`;
    await tx`insert into sales_status_log (tenant, lead_id, from_status, to_status, reason, changed_by) values (${t}, ${l.id}, ${l.status}, ${REVERTED_STATUS}, ${`배정 이전으로 되돌림${i.reason ? ` — ${i.reason}` : ''}`}, ${u.id})`;
    return { tasks: tasks.length, events: events.length, rows: recs.length };
  });
  await notify(sql, { userIds: assignees.filter((x) => x !== u.id), type: 'task_assigned', space: 'sales', title: `영업 배정 취소: ${l.name.slice(0, 60)}`, body: `${u.name}님이 배정 이전으로 되돌렸습니다${i.reason ? ` — ${i.reason}` : ''}. 관련 업무 ${out.tasks}건·일정 ${out.events}건은 취소되었습니다.`, link: `/s/sales/leads?id=${l.id}`, entityType: 'sales_lead', entityId: l.id, actorId: u.id, dedupeKey: `sales:handoff:revert:${l.id}` });
  return { ok: true, status: REVERTED_STATUS, ...out };
}
export type { Sql };
