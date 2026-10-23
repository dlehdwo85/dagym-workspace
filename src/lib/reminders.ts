import { DateTime } from 'luxon';
import { db } from './db';
import { occurrences } from './recurrence';
import { todaySeoul, addDays } from './time';
import type { SessionUser } from './types';
import { assignedOpenSql } from './taskAssignees';

const TZ = 'Asia/Seoul';
/** 로컬 10/20(대표): alarm 이면 앱이 전체 화면·알람 채널로 띄우고 [해제][10분 뒤][열기] — 결과는 POST /api/reminders/alarm 로 기록(미루기 재예약은 기기) */
export type Upcoming = { id: number; key: string; fireAt: string; title: string; body: string; link: string; kind?: 'event' | 'task'; entityId?: string; alarm?: true; snoozeMinutes?: number; actions?: { id: string; label: string }[] };

/** 알림 키 → 기기 로컬 알림 id(양의 32비트 정수, 같은 알림은 늘 같은 id) */
export function reminderId(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 1) || 1;
}
const kst = (d: string, t: string) => DateTime.fromISO(`${d}T${t}`, { zone: TZ });
const leftLabel = (m: number) => (m >= 1440 ? `${Math.round(m / 1440)}일 뒤` : m >= 60 ? `${Math.round(m / 60)}시간 뒤` : m > 0 ? `${m}분 뒤` : '지금');

/**
 * 휴대폰 예약 알림용: 앞으로 N일(기본 7) 동안 내가 받을 미리 알림. 서버 정기 실행이 보내는 것과 같은 규칙.
 * - 일정: 일정별 알림(분) 또는 내 기본값(기본 1시간 전), 0 = 끔, 불참 응답한 일정 제외
 * - 시간 있는 업무: 업무별 🔔 또는 내 기본값(1시간 전) / 날짜만 있는 업무: 업무별 🔔(09시 기준) 또는 기본(18시 기준 1시간 전 = 17시) + 당일 09시 "오늘 마감"
 * - 마감 임박(설정한 시간 전, 기본 24시간) / 아침 브리핑(켜져 있으면 평일 설정 시각)
 * 가까운 순 최대 `limit`(Android·iOS 예약 한도 고려 64)
 */
export async function upcomingReminders(u: SessionUser, days = 7, limit = 64): Promise<Upcoming[]> {
  const sql = db();
  const now = DateTime.now().setZone(TZ);
  const until = now.plus({ days });
  const today = todaySeoul();
  const [s] = await sql<{ ev: number; task: number; soon: number; btime: string; bon: boolean; bweekend: boolean; req: boolean; alarmM: number }[]>`
    select coalesce(requester_due_alerts, false) req, coalesce(event_reminder_minutes, 60) ev, coalesce(task_reminder_minutes, 60) task, coalesce(due_soon_hours, 0) soon, coalesce(alarm_minutes, 10) as "alarmM",
      to_char(coalesce(briefing_time, time '08:30'), 'HH24:MI') btime, coalesce(briefing_enabled, true) bon, coalesce(briefing_weekend, false) bweekend
    from user_settings where user_id = ${u.id}`;
  const st = s ?? { ev: 60, task: 60, soon: 0, btime: '08:30', bon: true, bweekend: false, req: false, alarmM: 10 };
  const out: Upcoming[] = [];
  const { alarmDefaults, alarmOn, alarmFields } = await import('./alarm');
  const ad = await alarmDefaults(sql, u.id);
  const push = (key: string, at: DateTime, title: string, body: string, link: string, al?: { kind: 'event' | 'task'; entityId: string; on: boolean }) => {
    if (at <= now || at > until) return;
    out.push({ id: reminderId(key), key, fireAt: at.toUTC().toISO()!, title, body, link, ...(al ? { kind: al.kind, entityId: al.entityId, ...alarmFields(al.on) } : {}) });
  };

  // 일정 (내 개인 캘린더 + 참석, 불참 제외)
  const evs = await sql<{ id: string; title: string; start_at: Date; all_day: boolean; rrule: string | null; exdates: Date[]; reminder_minutes: number[] | null; alarm: boolean | null }[]>`
    select e.id, e.title, e.start_at, e.all_day, e.rrule, e.exdates, e.reminder_minutes, e.alarm from events e join calendars c on c.id = e.calendar_id
    where e.deleted_at is null and e.recurring_event_id is null and e.kind <> 'task_block'
      and (e.rrule is not null or (e.start_at > ${now.toJSDate()} and e.start_at < ${until.plus({ days: 1 }).toJSDate()}))
      and ((c.type = 'personal' and c.owner_user_id = ${u.id})
        or exists (select 1 from event_attendees a where a.event_id = e.id and a.user_id = ${u.id} and a.response <> 'declined'))`;
  const exceptions = evs.length ? await sql<{ recurring_event_id: string; original_start: Date; start_at: Date; title: string; cancelled: boolean }[]>`
    select recurring_event_id, original_start, start_at, title, cancelled from events where recurring_event_id = any(${evs.map((e) => e.id)}::uuid[]) and deleted_at is null` : [];
  for (const e of evs) {
    // 일정별 알림이 있으면 그대로(0 = 시작 시각), 없으면 내 기본값(0 = 끔)
    // 대표 10/21 22:00 ⑦(#420): 알람이 켜진 일정은 'N분 전'(alarm_minutes) 시점을 더하고, 그 시점만 전체 화면 알람(다른 시점은 보통 알림)
    const evAlarm = alarmOn('event', e.alarm, ad);
    const leads = [...new Set([...(e.reminder_minutes ?? (st.ev > 0 ? [st.ev] : [])), ...(evAlarm ? [st.alarmM] : [])])];
    if (!leads.length) continue;
    const starts: { s: Date; title: string }[] = [];
    if (!e.rrule) starts.push({ s: e.start_at, title: e.title });
    else {
      const skip = new Set([...(e.exdates ?? []).map((d) => new Date(d).getTime()), ...exceptions.filter((x) => x.recurring_event_id === e.id).map((x) => x.original_start.getTime())]);
      for (const o of occurrences(e.rrule, e.start_at, now.toJSDate(), until.plus({ days: 1 }).toJSDate())) if (!skip.has(o.getTime())) starts.push({ s: o, title: e.title });
      for (const x of exceptions.filter((x) => x.recurring_event_id === e.id && !x.cancelled)) starts.push({ s: x.start_at, title: x.title });
    }
    for (const o of starts) {
      const at0 = DateTime.fromJSDate(o.s).setZone(TZ);
      for (const m of leads) push(`ev:${e.id}:${o.s.toISOString()}:${m}`, e.all_day ? at0.set({ hour: 9 }).minus({ minutes: m }) : at0.minus({ minutes: m }),
        `${m ? `${leftLabel(m)} 일정` : '지금 일정'}: ${o.title}`, e.all_day ? '종일' : at0.toFormat('HH:mm'), `/calendar?event=${e.id}`, { kind: 'event', entityId: e.id, on: evAlarm && m === st.alarmM });
    }
  }

  // 업무 (내가 담당, 미완료·보류 아님, 삭제 제외)
  const tasks = await sql<{ id: string; title: string; due_date: string; due_time: string | null; reminder_minutes: number[] | null; alarm: boolean | null; priority: string }[]>`
    select t.id, t.title, to_char(t.due_date,'YYYY-MM-DD') due_date, to_char(t.due_time,'HH24:MI') due_time, t.reminder_minutes, t.alarm, t.priority from tasks t
    where t.deleted_at is null and ${assignedOpenSql(sql, u.id)} and t.status not in ('done','on_hold') and t.due_date between ${today} and ${addDays(today, days + 1)}`; // #475 공동 담당(내 몫 완료 전)도
  for (const t of tasks) {
    const due = kst(t.due_date, t.due_time ?? '09:00');
    const tAlarm = alarmOn('task', t.alarm, ad, t.priority);
    // #420: 알람이 켜진 업무는 'N분 전' 시점을 더하고 그 시점만 알람(마감 시각 기준, 날짜만이면 18시 기준은 아래)
    const ms = [...new Set([...(t.reminder_minutes ?? (t.due_time ? [st.task] : [])), ...(tAlarm && t.due_time ? [st.alarmM] : [])])];
    const al = { kind: 'task' as const, entityId: t.id, on: false };
    for (const m of ms) push(`task:${t.id}:${t.due_date}:${t.due_time ?? ''}:${m}`, due.minus({ minutes: m }), `${leftLabel(m)} 마감: ${t.title}`,
      `${t.due_date === today ? '오늘' : t.due_date} ${t.due_time ?? ''}까지`.trim(), `/tasks/${t.id}`, { ...al, on: tAlarm && m === st.alarmM });
    // 2026-10-15 대표: 날짜만 있는 업무도 기본 1시간 전 — 18시(퇴근) 기준(서버 정기 실행과 같은 키)
    if (!t.due_time && !t.reminder_minutes) {
      push(`task:${t.id}:${t.due_date}::${st.task}`, kst(t.due_date, '18:00').minus({ minutes: st.task }), `${leftLabel(st.task)} 마감: ${t.title}`, `${t.due_date === today ? '오늘' : t.due_date}까지`, `/tasks/${t.id}`, { ...al, on: tAlarm && st.task === st.alarmM });
      if (tAlarm && st.alarmM !== st.task) push(`task:${t.id}:${t.due_date}::${st.alarmM}`, kst(t.due_date, '18:00').minus({ minutes: st.alarmM }), `${leftLabel(st.alarmM)} 마감: ${t.title}`, `${t.due_date === today ? '오늘' : t.due_date}까지`, `/tasks/${t.id}`, { ...al, on: true });
    }
    // V14 10번(검수 3): 마감 당일에 울리는 시각 알림이 있으면 "오늘 마감"은 생략(하루 1건)
    if (!ms.some((m) => due.minus({ minutes: m }).toISODate() === t.due_date))
      push(`today:${t.id}:${t.due_date}`, kst(t.due_date, '09:00'), `오늘 마감: ${t.title}`, t.due_time ? `오늘 ${t.due_time}까지` : '오늘까지 마감입니다', `/tasks/${t.id}`, al);
    // V14 10번: 마감 당일에 울리는 "마감 임박"은 "오늘 마감"과 겹치므로 빼고, 업무별 🔔 를 정했으면 그것만
    const soonAt = kst(t.due_date, t.due_time ?? '23:59').minus({ hours: st.soon });
    if (st.soon > 0 && !t.reminder_minutes && soonAt.toISODate()! < t.due_date) push(`soon:${t.id}:${t.due_date}:${t.due_time ?? ''}`, soonAt, `마감 임박: ${t.title}`, `마감 ${t.due_date}${t.due_time ? ' ' + t.due_time : ''}`, `/tasks/${t.id}`);
  }

  // V13 6번: 내가 요청한 업무(담당자가 다른 사람) — 서버 알림과 같은 키(묶음 업무는 묶음 1건)
  if (st.req) {
    const mine = await sql<{ id: string; title: string; due_date: string; due_time: string | null; reminder_minutes: number[] | null; batch_id: string | null; assignee_name: string; atask: number | null }[]>`
      select t.id, t.title, to_char(t.due_date,'YYYY-MM-DD') due_date, to_char(t.due_time,'HH24:MI') due_time, t.reminder_minutes, t.batch_id, a.name assignee_name, s.task_reminder_minutes atask
      from tasks t join users a on a.id = t.assignee_id left join user_settings s on s.user_id = t.assignee_id
      where t.deleted_at is null and t.requested_by = ${u.id} and t.assignee_id <> ${u.id} and t.status not in ('done','on_hold')
        and t.due_date between ${today} and ${addDays(today, days + 1)}`;
    const byGroup = new Map<string, (typeof mine)[number][]>();
    for (const t of mine) { const g = t.batch_id ?? t.id; byGroup.set(g, [...(byGroup.get(g) ?? []), t]); }
    for (const [g, ts] of byGroup) {
      const t = ts[0];
      const who = ts.length > 1 ? `${t.assignee_name} 외 ${ts.length - 1}명` : t.assignee_name;
      const link = `/tasks/${t.id}`;
      const due = kst(t.due_date, t.due_time ?? '09:00');
      const rms = t.reminder_minutes ?? (t.due_time ? [t.atask ?? 60] : []);
      for (const m of rms)
        push(`req:${g}:rem${m}:${t.due_date}:${t.due_time ?? ''}`, due.minus({ minutes: m }), `[요청] ${leftLabel(m)} 마감: ${t.title}`, `담당 ${who}`, link);
      if (!t.due_time && !t.reminder_minutes) { const m = t.atask ?? 60; push(`req:${g}:rem${m}:${t.due_date}:`, kst(t.due_date, '18:00').minus({ minutes: m }), `[요청] ${leftLabel(m)} 마감: ${t.title}`, `담당 ${who}`, link); }
      if (!rms.some((m) => due.minus({ minutes: m }).toISODate() === t.due_date))
        push(`req:${g}:today:${t.due_date}`, kst(t.due_date, '09:00'), `[요청] 오늘 마감: ${t.title}`, `담당 ${who}`, link);
    }
  }

  // 아침 브리핑 (내용은 열어서 확인 — 미리 예약하므로 숫자 대신 안내)
  if (st.bon) {
    const hol = new Set((await sql<{ d: string }[]>`select to_char(date,'YYYY-MM-DD') d from holidays where date between ${today} and ${addDays(today, days)}`).map((h) => h.d));
    for (let i = 0; i <= days; i++) {
      const d = addDays(today, i), at = kst(d, st.btime);
      if (!st.bweekend && (at.weekday >= 6 || hol.has(d))) continue;
      push(`brief:${d}`, at, `좋은 아침입니다 · ${d.slice(5).replace('-', '/')} 브리핑`, '오늘의 일정과 일정을 확인하세요', '/');
    }
  }
  const seen = new Set<number>();
  return out.sort((a, b) => a.fireAt.localeCompare(b.fireAt)).filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true))).slice(0, limit);
}

/** 바뀐 일정·업무의 미리 알림을 받는 사람 (조용한 재예약 메시지 대상) */
export async function affectedByTask(taskId: string) {
  return (await db()<{ id: string }[]>`select assignee_id as id from tasks where id = ${taskId} and assignee_id is not null
    union select requested_by from tasks where id = ${taskId} and requested_by is not null
    union select user_id from task_assignees where task_id = ${taskId}`).map((r) => r.id);
}
export async function affectedByEvent(eventId: string) {
  return (await db()<{ id: string }[]>`
    select a.user_id as id from events e join event_attendees a on a.event_id = coalesce(e.recurring_event_id, e.id) where e.id = ${eventId}
    union select c.owner_user_id from events e join calendars c on c.id = e.calendar_id where e.id = ${eventId} and c.owner_user_id is not null`).map((r) => r.id);
}
