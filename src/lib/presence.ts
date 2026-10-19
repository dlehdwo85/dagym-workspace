import { db, type Sql } from './db';
import { tenantOf, type SessionUser } from './types';

/**
 * V35 2 · V36 1 근무 상태 자동 — 지금 진행 중인 일정으로 정한다(직접 설정이 생기면 그것이 먼저).
 * - 연차·반차(vacation·half_day) → 휴가(회색) · 출장(business_trip) → 출장(파랑)
 * - 외근(outside) 또는 장소가 있는 일정이 진행 중 → 외근·미팅(파랑) — 그 시간 동안만
 * - 그 밖 = 근무 중(표시 안 함)
 * 같은 회사 사람에게만, 상태와 끝나는 시각만 돌려준다(일정 제목·사유·장소는 주지 않음).
 * 반복 일정의 회차는 아직 보지 않는다(연차·출장은 보통 반복이 아님).
 */
export type Presence = { s: 'leave' | 'trip' | 'out' | 'before' | 'done'; label: string; until: string };
const RANK = { leave: 3, trip: 2, out: 1, before: 0, done: 0 } as const;

export async function presenceMap(u: SessionUser, now = new Date(), sql: Sql = db()): Promise<Record<string, Presence>> {
  const rows = await sql<{ user_id: string; kind: string; all_day: boolean; end_at: Date; has_loc: boolean }[]>`
    with cur as (
      select e.id, e.kind, e.all_day, e.end_at, e.created_by, c.type as cal_type, c.owner_user_id, coalesce(trim(e.location), '') <> '' as has_loc
      from events e join calendars c on c.id = e.calendar_id
      where e.deleted_at is null and not e.cancelled and e.rrule is null
        and e.start_at <= ${now} and e.end_at > ${now}
        and (e.kind in ('vacation', 'half_day', 'business_trip', 'outside') or coalesce(trim(e.location), '') <> '')
    ), who as (
      select cur.*, cur.created_by as user_id from cur where cur.kind in ('vacation', 'half_day', 'business_trip', 'outside')
      union select cur.*, cur.owner_user_id from cur where cur.cal_type = 'personal' and cur.owner_user_id is not null
      union select cur.*, a.user_id from cur join event_attendees a on a.event_id = cur.id and a.response <> 'declined'
    )
    select w.user_id, w.kind, w.all_day, w.end_at, w.has_loc from who w join users x on x.id = w.user_id
    where x.tenant = ${tenantOf(u)} and x.status = 'active'`;
  const out: Record<string, Presence> = {};
  const fmt = (d: Date, allDay: boolean) => {
    if (allDay) { const last = new Date(d.getTime() - 1); return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).format(last); }
    return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  };
  for (const r of rows) {
    const s: Presence['s'] = r.kind === 'vacation' || r.kind === 'half_day' ? 'leave' : r.kind === 'business_trip' ? 'trip' : 'out';
    const label = s === 'leave' ? (r.kind === 'half_day' ? '반차' : '휴가') : s === 'trip' ? '출장' : '외근·미팅';
    const p: Presence = { s, label: `${label} ~${fmt(r.end_at, r.all_day)}`, until: r.end_at.toISOString() };
    const cur = out[r.user_id];
    if (!cur || RANK[s] > RANK[cur.s] || (RANK[s] === RANK[cur.s] && p.until > cur.until)) out[r.user_id] = p;
  }
  // V30 ③ 출퇴근(기능을 쓰는 회사만): 다른 상태가 없을 때 출근 전(빈 점)·퇴근(회색 빈 점) — 오늘 자정까지
  const { clockStates } = await import('./attendance');
  const clocks = await clockStates(sql, tenantOf(u)).catch(() => ({} as Record<string, 'before' | 'done'>));
  const midnight = new Date(new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' })).setHours(24, 0, 0, 0) - (new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' })).getTime() - now.getTime())).toISOString();
  for (const [id, st] of Object.entries(clocks)) if (!out[id]) out[id] = { s: st, label: st === 'before' ? '출근 전' : '퇴근', until: midnight };
  return out;
}
