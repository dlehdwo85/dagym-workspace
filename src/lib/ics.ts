import { DateTime } from 'luxon';
import { db } from './db';
import { newToken, sha256 } from './crypto';
import { listEvents } from './events';
import type { SessionUser } from './types';

/**
 * V12 3번 캘린더 ICS 구독 주소: 구글·아웃룩·애플 캘린더에 "URL로 추가"하면 워크인 일정이 보인다(읽기 전용, 연결·로그인 없음).
 * 주소 = 비밀 토큰(해시만 저장). 내 일정(개인 캘린더·참석)과 내 업무 마감만 — 회사 전체 일정은 넣지 않는다.
 */
export async function feedInfo(u: SessionUser) {
  const [f] = await db()<{ created_at: Date; last_used_at: Date | null }[]>`select created_at, last_used_at from calendar_feeds where user_id = ${u.id}`;
  return { exists: !!f, createdAt: f?.created_at ?? null, lastUsedAt: f?.last_used_at ?? null };
}
export async function createFeed(u: SessionUser, origin: string) {
  const token = newToken();
  await db()`insert into calendar_feeds (user_id, token_hash) values (${u.id}, ${sha256(token)})
    on conflict (user_id) do update set token_hash = excluded.token_hash, created_at = now(), last_used_at = null`;
  return { url: `${origin.replace(/^http:/, 'https:').replace('https://localhost', 'http://localhost')}/api/ics/${token}.ics`, token };
}
export async function deleteFeed(u: SessionUser) {
  await db()`delete from calendar_feeds where user_id = ${u.id}`;
  return { ok: true };
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (line: string) => { const out: string[] = []; let s = line; while (Buffer.byteLength(s) > 74) { let n = 74; while (Buffer.byteLength(s.slice(0, n)) > 74) n--; out.push(s.slice(0, n)); s = ' ' + s.slice(n); } out.push(s); return out.join('\r\n'); };
const utc = (d: Date) => DateTime.fromJSDate(d).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
const day = (iso: string) => iso.replace(/-/g, '');

export async function feedIcs(token: string, origin: string): Promise<string | null> {
  const sql = db();
  const [f] = await sql<{ user_id: string }[]>`update calendar_feeds set last_used_at = now() where token_hash = ${sha256(token)} returning user_id`;
  if (!f) return null;
  const [r] = await sql<any[]>`select id, email, name, role, status, timezone, is_demo, tenant from users where id = ${f.user_id}`;
  if (!r || r.status !== 'active') return null;
  const u: SessionUser = { id: r.id, email: r.email, name: r.name, role: r.role, status: r.status, timezone: r.timezone, sessionId: '', isDemo: r.is_demo, tenant: r.tenant };
  const from = DateTime.now().minus({ days: 30 }).toJSDate(), to = DateTime.now().plus({ days: 180 }).toJSDate();
  const evs = (await listEvents(u, from, to)).filter((e: any) => !e.masked && (e.ownerId === u.id || e.createdBy === u.id || e.attendees?.some((a: any) => a.user_id === u.id)));
  const tasks = await sql<{ id: string; title: string; due_date: string; due_time: string | null; status: string; updated_at: Date }[]>`
    select id, title, to_char(due_date,'YYYY-MM-DD') due_date, to_char(due_time,'HH24:MI') due_time, status, updated_at from tasks
    where deleted_at is null and assignee_id = ${u.id} and due_date is not null and due_date >= current_date - 30 and due_date <= current_date + 180 limit 1000`;
  const now = utc(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Workin//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(`워크인 · ${u.name}`)}`, 'X-WR-TIMEZONE:Asia/Seoul', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H'];
  for (const e of evs) {
    const s = new Date(e.start), en = new Date(e.end);
    lines.push('BEGIN:VEVENT', `UID:${e.id}-${s.getTime()}@workin`, `DTSTAMP:${now}`,
      ...(e.allDay ? [`DTSTART;VALUE=DATE:${DateTime.fromJSDate(s).setZone('Asia/Seoul').toFormat('yyyyMMdd')}`, `DTEND;VALUE=DATE:${DateTime.fromJSDate(en).setZone('Asia/Seoul').toFormat('yyyyMMdd')}`]
        : [`DTSTART:${utc(s)}`, `DTEND:${utc(en)}`]),
      `SUMMARY:${esc(e.title ?? '')}`, ...(e.location ? [`LOCATION:${esc(e.location)}`] : []), `URL:${origin}/calendar?event=${e.seriesId ?? e.id}`, 'END:VEVENT');
  }
  for (const t of tasks) {
    const title = `${t.status === 'done' ? '✓ ' : ''}마감: ${t.title}`;
    lines.push('BEGIN:VEVENT', `UID:task-${t.id}@workin`, `DTSTAMP:${now}`, `LAST-MODIFIED:${utc(t.updated_at)}`,
      ...(t.due_time ? [`DTSTART:${utc(DateTime.fromISO(`${t.due_date}T${t.due_time}`, { zone: 'Asia/Seoul' }).toJSDate())}`, `DURATION:PT30M`]
        : [`DTSTART;VALUE=DATE:${day(t.due_date)}`, `DTEND;VALUE=DATE:${day(DateTime.fromISO(t.due_date).plus({ days: 1 }).toISODate()!)}`]),
      `SUMMARY:${esc(title)}`, `URL:${origin}/tasks/${t.id}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
