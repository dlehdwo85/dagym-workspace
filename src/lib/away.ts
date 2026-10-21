// V35 2 2차 (#76) 부재중 설정 — 기간·자동 응답 문구·대리인·알림 보류. 근무 상태(presence)에 '부재', 담당자 규칙은 부 담당으로,
// 부재(직접 설정 또는 연차 일정) 중에는 푸시를 보내지 않고 목록에만 쌓았다가 돌아온 날 "부재 중 알림 n건" 1건, 1:1 대화에는 안내 메시지(방마다 하루 1번).
import { z } from 'zod';
import { db, type Sql } from './db';
import { badRequest, notFound } from './errors';
import { tenantOf, type SessionUser } from './types';
import { zUuid } from './api';
import type { Presence } from './presence';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식(YYYY-MM-DD)');
export const awayInput = z.object({ from: DATE, to: DATE, note: z.string().trim().max(300).optional(), deputyId: zUuid.nullable().optional(), hold: z.boolean().optional() })
  .refine((v) => v.to >= v.from, { message: '끝 날짜가 시작보다 앞입니다', path: ['to'] });
export const kstToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

type Row = { away_from: string | null; away_to: string | null; away_note: string | null; away_deputy_id: string | null; away_hold: boolean; deputy_name: string | null };
export async function getAway(u: SessionUser) {
  const [r] = await db()<Row[]>`select s.away_from::text, s.away_to::text, s.away_note, s.away_deputy_id, s.away_hold, d.name as deputy_name
    from user_settings s left join users d on d.id = s.away_deputy_id where s.user_id = ${u.id}`;
  const today = kstToday();
  const away = r?.away_from && r?.away_to ? { from: r.away_from, to: r.away_to, note: r.away_note ?? '', deputyId: r.away_deputy_id, deputyName: r.deputy_name, hold: r.away_hold } : null;
  return { away, active: !!away && away.from <= today && away.to >= today, hold: r?.away_hold ?? true };
}
export async function setAway(u: SessionUser, i: z.infer<typeof awayInput>) {
  const sql = db();
  if (i.deputyId) {
    if (i.deputyId === u.id) throw badRequest('대리인은 본인이 될 수 없습니다');
    const [d] = await sql`select 1 from users where id = ${i.deputyId} and tenant = ${tenantOf(u)} and status = 'active'`;
    if (!d) throw notFound('대리인을 찾을 수 없습니다');
  }
  await sql`insert into user_settings (user_id, away_from, away_to, away_note, away_deputy_id, away_hold, away_summary_at, updated_at)
    values (${u.id}, ${i.from}, ${i.to}, ${i.note || null}, ${i.deputyId ?? null}, ${i.hold ?? true}, null, now())
    on conflict (user_id) do update set away_from = excluded.away_from, away_to = excluded.away_to, away_note = excluded.away_note, away_deputy_id = excluded.away_deputy_id, away_hold = excluded.away_hold, away_summary_at = null, updated_at = now()`;
  return getAway(u);
}
export async function clearAway(u: SessionUser) {
  await db()`update user_settings set away_from = null, away_to = null, away_note = null, away_deputy_id = null, updated_at = now() where user_id = ${u.id}`;
  return getAway(u);
}

/** 직접 설정한 부재가 지금(한국 날짜) 진행 중인 사람 */
export async function manualAwaySet(sql: Sql, ids: string[], now = new Date()): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const today = kstToday(now);
  const rows = await sql<{ user_id: string }[]>`select user_id from user_settings where user_id = any(${ids}::uuid[]) and away_from <= ${today} and away_to >= ${today}`;
  return new Set(rows.map((r) => r.user_id));
}
/** 근무 상태용: 회사 사람 중 직접 부재 설정이 진행 중인 사람 → '부재 ~M/D · 대리 ○○' */
export async function manualAwayPresence(sql: Sql, tenant: string, now = new Date()): Promise<Record<string, Presence>> {
  const today = kstToday(now);
  const rows = await sql<{ user_id: string; away_to: string; deputy: string | null }[]>`select s.user_id, s.away_to::text, d.name as deputy from user_settings s join users x on x.id = s.user_id left join users d on d.id = s.away_deputy_id
    where x.tenant = ${tenant} and x.status = 'active' and s.away_from <= ${today} and s.away_to >= ${today}`;
  const out: Record<string, Presence> = {};
  for (const r of rows) {
    const until = new Date(`${r.away_to}T23:59:59+09:00`).toISOString();
    out[r.user_id] = { s: 'leave', label: `부재 ~${md(r.away_to)}${r.deputy ? ` · 대리 ${r.deputy}` : ''}`, until };
  }
  return out;
}
/** 알림 보류 대상인가: (직접 부재 진행 중 또는 연차 일정 진행 중) 이고 보류 설정(기본 켬) */
export async function heldNow(sql: Sql, userId: string, now = new Date()): Promise<boolean> {
  const today = kstToday(now);
  const [r] = await sql<{ hold: boolean; manual: boolean; vac: boolean }[]>`select coalesce(s.away_hold, true) as hold,
      coalesce(s.away_from <= ${today} and s.away_to >= ${today}, false) as manual,
      exists (select 1 from events e where e.created_by = ${userId} and e.deleted_at is null and not e.cancelled and e.rrule is null and e.kind = 'vacation' and e.start_at <= ${now} and e.end_at > ${now}) as vac
    from users x left join user_settings s on s.user_id = x.id where x.id = ${userId}`;
  return !!r && r.hold && (r.manual || r.vac);
}
/** 1:1 대화에서 상대가 부재중이면 안내 메시지(방마다 24시간에 1번) */
export async function autoReplyIfAway(sql: Sql, roomId: string, otherUserId: string, now = new Date()) {
  const today = kstToday(now);
  const [s] = await sql<{ name: string; away_to: string; note: string | null; deputy: string | null }[]>`select x.name, s.away_to::text, s.away_note as note, d.name as deputy
    from user_settings s join users x on x.id = s.user_id left join users d on d.id = s.away_deputy_id where s.user_id = ${otherUserId} and s.away_from <= ${today} and s.away_to >= ${today}`;
  if (!s) return false;
  const [recent] = await sql`select 1 from chat_messages where room_id = ${roomId} and kind = 'system' and body like '[부재중]%' and created_at > ${now} - interval '24 hours' limit 1`;
  if (recent) return false;
  const body = `[부재중] ${s.name}님은 ${md(s.away_to)}까지 부재중입니다.${s.note ? ` "${s.note}"` : ''}${s.deputy ? ` 급한 일은 ${s.deputy}님께 연락해 주세요.` : ''}`;
  await sql`insert into chat_messages (room_id, author_id, body, kind) values (${roomId}, null, ${body}, 'system')`;
  return true;
}
/** tick: 부재가 끝난 사람에게 "부재 중 알림 n건" 1건(보류된 알림이 있을 때만) */
export async function awayReturnTick(now = new Date()) {
  const sql = db();
  const today = kstToday(now);
  const rows = await sql<{ user_id: string; away_from: string; away_to: string }[]>`select s.user_id, s.away_from::text, s.away_to::text from user_settings s join users x on x.id = s.user_id
    where s.away_to is not null and s.away_to < ${today} and (s.away_summary_at is null or s.away_summary_at < (s.away_to::timestamp at time zone 'Asia/Seoul')) and x.status = 'active' limit 200`;
  let sent = 0;
  const { notify } = await import('./notifications');
  for (const r of rows) {
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from notifications where user_id = ${r.user_id} and meta->>'held' = 'true' and read_at is null and created_at >= (${r.away_from}::timestamp at time zone 'Asia/Seoul')`;
    if (n > 0) {
      await notify(sql, { userIds: [r.user_id], type: 'briefing', title: `부재 중 알림 ${n}건`, body: `${md(r.away_from)}~${md(r.away_to)} 부재 동안 받은 알림을 확인해 주세요`, link: '/notifications?unread=1', dedupeKey: `away_summary:${r.user_id}:${r.away_to}`, push: true });
      sent++;
    }
    await sql`update user_settings set away_summary_at = now() where user_id = ${r.user_id}`;
  }
  return { checked: rows.length, sent };
}
