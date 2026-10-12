import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { db, type Sql } from '../db';
import { newToken } from '../crypto';
import { logError } from '../log';
import { notify } from '../notifications';
import { normalizeRule } from '../recurrence';
import { TZ, seoulMidnight, toSeoulDate } from '../time';
import { gapi, GoogleApiError, GoogleAuthError } from './client';

interface Link {
  id: string;
  user_id: string;
  google_calendar_id: string;
  local_calendar_id: string;
  sync_token: string | null;
  direction: 'both' | 'import';
  channel_id: string | null;
  channel_resource_id: string | null;
  channel_expires_at: Date | null;
  fail_count: number;
  status: string;
}

type GEvent = any;

const enc = (s: string) => encodeURIComponent(s);
async function log(sql: Sql, link: Link, direction: string, action: string, status: 'ok' | 'error' | 'conflict' | 'skipped', detail: Record<string, unknown> = {}) {
  await sql`insert into sync_logs (link_id, user_id, direction, action, status, detail) values (${link.id}, ${link.user_id}, ${direction}, ${action}, ${status}, ${sql.json(detail as never)})`;
}

// ---------- 변환 ----------
function parseGTime(t: { date?: string; dateTime?: string; timeZone?: string }): Date {
  if (t.date) return seoulMidnight(t.date);
  return new Date(t.dateTime!);
}

function parseExdates(lines: string[]): Date[] {
  const out: Date[] = [];
  for (const l of lines) {
    if (!/^EXDATE/i.test(l)) continue;
    const [head, values] = l.split(':');
    const tz = /TZID=([^;:]+)/i.exec(head)?.[1] ?? TZ;
    for (const v of values.split(',')) {
      if (/^\d{8}$/.test(v)) out.push(seoulMidnight(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`));
      else if (v.endsWith('Z')) out.push(DateTime.fromFormat(v, "yyyyMMdd'T'HHmmss'Z'", { zone: 'UTC' }).toJSDate());
      else out.push(DateTime.fromFormat(v, "yyyyMMdd'T'HHmmss", { zone: tz }).toJSDate());
    }
  }
  return out;
}

export function fromGoogle(ge: GEvent) {
  const allDay = !!ge.start?.date;
  const start = parseGTime(ge.start);
  let end = parseGTime(ge.end ?? ge.start);
  if (end < start) end = start;
  const rec: string[] = ge.recurrence ?? [];
  let rrule: string | null = null;
  const rl = rec.find((l: string) => /^RRULE:/i.test(l));
  if (rl) {
    try { rrule = normalizeRule(rl); } catch { rrule = null; }
  }
  return {
    title: (ge.summary ?? '(제목 없음)').slice(0, 200),
    description: (ge.description ?? '').slice(0, 20000),
    location: (ge.location ?? '').slice(0, 300),
    allDay, start, end, rrule, exdates: parseExdates(rec),
    kind: ge.eventType === 'outOfOffice' ? 'vacation' : 'normal',
  };
}

function fmtLocalBasic(d: Date) {
  return DateTime.fromJSDate(d).setZone(TZ).toFormat("yyyyMMdd'T'HHmmss");
}

export function toGoogle(e: any) {
  const body: any = {
    summary: e.title,
    description: e.description ?? '',
    location: e.location ?? '',
    extendedProperties: { private: { workosId: e.id } },
  };
  if (e.all_day) {
    const s = toSeoulDate(e.start_at);
    let en = toSeoulDate(e.end_at);
    if (en <= s) en = DateTime.fromISO(s).plus({ days: 1 }).toISODate()!;
    body.start = { date: s };
    body.end = { date: en };
  } else {
    body.start = { dateTime: new Date(e.start_at).toISOString(), timeZone: TZ };
    body.end = { dateTime: new Date(e.end_at).toISOString(), timeZone: TZ };
  }
  if (e.recurring_event_id === null || e.recurring_event_id === undefined) {
    if (e.rrule) {
      body.recurrence = ['RRULE:' + e.rrule];
      const ex: Date[] = e.exdates ?? [];
      if (ex.length) {
        body.recurrence.push(e.all_day
          ? 'EXDATE;VALUE=DATE:' + ex.map((d) => toSeoulDate(new Date(d)).replace(/-/g, '')).join(',')
          : `EXDATE;TZID=${TZ}:` + ex.map((d) => fmtLocalBasic(new Date(d))).join(','));
      }
    } else body.recurrence = [];
  }
  return body;
}

function instanceId(masterGoogleId: string, originalStart: Date, allDay: boolean) {
  const basic = allDay
    ? toSeoulDate(originalStart).replace(/-/g, '')
    : originalStart.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return `${masterGoogleId}_${basic}`;
}

// ---------- 잠금 ----------
async function lock(sql: Sql, name: string, seconds = 120) {
  const holder = randomUUID();
  const r = await sql`insert into job_locks (name, locked_until, holder) values (${name}, now() + ${seconds + ' seconds'}::interval, ${holder})
    on conflict (name) do update set locked_until = excluded.locked_until, holder = excluded.holder where job_locks.locked_until < now()
    returning holder`;
  return r.length ? holder : null;
}
async function unlock(sql: Sql, name: string, holder: string) {
  await sql`delete from job_locks where name = ${name} and holder = ${holder}`;
}

// ---------- 가져오기 (Google → 회사 캘린더) ----------
async function applyGoogleEvent(sql: Sql, link: Link, ge: GEvent, stats: Record<string, number>) {
  const [map] = await sql`select * from google_event_map where link_id = ${link.id} and google_event_id = ${ge.id}`;

  // 반복 일정의 개별 회차(예외)
  if (ge.recurringEventId) {
    const [mm] = await sql`select local_event_id from google_event_map where link_id = ${link.id} and google_event_id = ${ge.recurringEventId}`;
    if (!mm) { stats.skipped++; return; } // 마스터를 아직 모르면 다음 동기화에서 처리
    const orig = parseGTime(ge.originalStartTime);
    if (ge.status === 'cancelled') {
      await sql`update events set exdates = case when ${orig}::timestamptz = any(exdates) then exdates else array_append(exdates, ${orig}::timestamptz) end,
        version = version + 1, updated_at = now() where id = ${mm.local_event_id}`;
      await sql`update events set deleted_at = now() where recurring_event_id = ${mm.local_event_id} and original_start = ${orig} and deleted_at is null`;
      const [v] = await sql`select version from events where id = ${mm.local_event_id}`;
      await sql`update google_event_map set local_version = ${v.version} where link_id = ${link.id} and local_event_id = ${mm.local_event_id}`;
      stats.cancelled++;
      return;
    }
    if (map && map.google_etag === ge.etag) { stats.unchanged++; return; }
    const f = fromGoogle(ge);
    const [master] = await sql`select created_by, kind, task_id from events where id = ${mm.local_event_id}`;
    const [x] = await sql<{ id: string; version: number }[]>`
      insert into events (calendar_id, title, description, location, kind, all_day, start_at, end_at, recurring_event_id, original_start, task_id, created_by)
      values (${link.local_calendar_id}, ${f.title}, ${f.description}, ${f.location}, ${master.kind}, ${f.allDay}, ${f.start}, ${f.end},
        ${mm.local_event_id}, ${orig}, ${master.task_id}, ${master.created_by})
      on conflict (recurring_event_id, original_start) where recurring_event_id is not null and deleted_at is null
      do update set title = excluded.title, description = excluded.description, location = excluded.location, all_day = excluded.all_day,
        start_at = excluded.start_at, end_at = excluded.end_at, version = events.version + 1, updated_at = now()
      returning id, version`;
    await sql`insert into google_event_map (link_id, local_event_id, google_event_id, google_etag, local_version, google_updated)
      values (${link.id}, ${x.id}, ${ge.id}, ${ge.etag}, ${x.version}, ${ge.updated ?? null})
      on conflict (link_id, google_event_id) do update set local_event_id = excluded.local_event_id, google_etag = excluded.google_etag,
        local_version = excluded.local_version, google_updated = excluded.google_updated, updated_at = now()`;
    stats.updated++;
    return;
  }

  if (ge.status === 'cancelled') {
    if (map && !map.deleted_local) {
      // Google 에서 삭제된 일정 → 동기화로 들어온 회사 일정만 삭제
      await sql`update events set deleted_at = now(), version = version + 1 where (id = ${map.local_event_id} or recurring_event_id = ${map.local_event_id}) and deleted_at is null`;
      await sql`delete from google_event_map where link_id = ${link.id} and google_event_id = ${ge.id}`;
      stats.deleted++;
    }
    return;
  }

  // 회사 서비스에서 만든 일정이 Google 을 거쳐 다시 들어온 경우(map 저장 전 장애) 중복 생성 방지
  const workosId = ge.extendedProperties?.private?.workosId as string | undefined;
  const f = fromGoogle(ge);
  if (!map) {
    if (workosId) {
      const [own] = await sql`select id, version from events where id = ${workosId} and calendar_id = ${link.local_calendar_id}`;
      if (own) {
        await sql`insert into google_event_map (link_id, local_event_id, google_event_id, google_etag, local_version, google_updated)
          values (${link.id}, ${own.id}, ${ge.id}, ${ge.etag}, ${own.version}, ${ge.updated ?? null}) on conflict do nothing`;
        stats.relinked++;
        return;
      }
    }
    const [owner] = await sql`select user_id from google_calendar_links where id = ${link.id}`;
    const [e] = await sql<{ id: string; version: number }[]>`
      insert into events (calendar_id, title, description, location, kind, all_day, start_at, end_at, rrule, exdates, created_by)
      values (${link.local_calendar_id}, ${f.title}, ${f.description}, ${f.location}, ${f.kind}, ${f.allDay}, ${f.start}, ${f.end},
        ${f.rrule}, ${f.exdates}, ${owner.user_id})
      returning id, version`;
    await sql`insert into google_event_map (link_id, local_event_id, google_event_id, google_etag, local_version, google_updated)
      values (${link.id}, ${e.id}, ${ge.id}, ${ge.etag}, ${e.version}, ${ge.updated ?? null})`;
    await syncAttendeeResponse(sql, link, e.id, ge);
    stats.created++;
    return;
  }

  if (map.google_etag === ge.etag) { stats.unchanged++; return; }
  const [local] = await sql`select * from events where id = ${map.local_event_id}`;
  if (!local) return;
  if (local.deleted_at) {
    // 회사 쪽에서 삭제했지만 아직 Google 에 반영 전 → 삭제가 우선(push 단계에서 처리)
    stats.skipped++;
    return;
  }
  if (local.version > map.local_version) {
    // 양쪽 모두 수정됨: 최근 수정이 우선
    const googleNewer = ge.updated && new Date(ge.updated) > new Date(local.updated_at);
    await log(sql, link, 'pull', 'conflict', 'conflict', {
      eventId: local.id, title: local.title, winner: googleNewer ? 'google' : 'local', googleUpdated: ge.updated, localUpdated: local.updated_at,
    });
    if (!googleNewer) {
      await sql`update google_event_map set google_etag = ${ge.etag}, google_updated = ${ge.updated ?? null} where link_id = ${link.id} and google_event_id = ${ge.id}`;
      stats.conflicts++;
      return;
    }
    stats.conflicts++;
  }
  const [u] = await sql<{ version: number }[]>`
    update events set title = ${f.title}, description = ${f.description}, location = ${f.location}, all_day = ${f.allDay},
      start_at = ${f.start}, end_at = ${f.end}, rrule = ${f.rrule}, exdates = ${f.exdates}, version = version + 1, updated_at = now()
    where id = ${local.id} returning version`;
  await sql`update google_event_map set google_etag = ${ge.etag}, local_version = ${u.version}, google_updated = ${ge.updated ?? null}, updated_at = now()
    where link_id = ${link.id} and google_event_id = ${ge.id}`;
  await syncAttendeeResponse(sql, link, local.id, ge);
  stats.updated++;
}

/** Google 참석 응답(responseStatus)을 회사 계정 참석자에 반영 (이메일 일치 사용자만) */
async function syncAttendeeResponse(sql: Sql, link: Link, localId: string, ge: GEvent) {
  for (const a of ge.attendees ?? []) {
    if (!a.email || !a.responseStatus) continue;
    const [u] = await sql`select id from users where lower(email) = ${String(a.email).toLowerCase()} and status = 'active'`;
    if (!u) continue;
    await sql`insert into event_attendees (event_id, user_id, response) values (${localId}, ${u.id}, ${a.responseStatus})
      on conflict (event_id, user_id) do update set response = excluded.response`;
  }
}

async function pull(sql: Sql, link: Link) {
  const stats = { created: 0, updated: 0, deleted: 0, cancelled: 0, unchanged: 0, skipped: 0, conflicts: 0, relinked: 0, pages: 0 };
  let pageToken: string | undefined;
  let syncToken = link.sync_token;
  let full = !syncToken;
  const base = `/calendars/${enc(link.google_calendar_id)}/events`;
  const pending: GEvent[] = [];
  for (;;) {
    let page: any;
    try {
      page = await gapi(link.user_id, 'GET', base, {
        query: full
          ? { maxResults: '250', showDeleted: 'true', timeMin: new Date(Date.now() - 60 * 86400000).toISOString(), pageToken }
          : { maxResults: '250', showDeleted: 'true', syncToken: syncToken!, pageToken },
      });
    } catch (e) {
      if (e instanceof GoogleApiError && e.status === 410) {
        // 동기화 토큰 만료 → 전체 재동기화
        await log(sql, link, 'pull', 'sync_token_expired', 'skipped');
        syncToken = null; full = true; pageToken = undefined; pending.length = 0;
        continue;
      }
      throw e;
    }
    stats.pages++;
    pending.push(...(page.items ?? []));
    if (page.nextPageToken) { pageToken = page.nextPageToken; continue; }
    // 마스터를 먼저, 예외 회차를 나중에 처리
    pending.sort((a, b) => Number(!!a.recurringEventId) - Number(!!b.recurringEventId));
    for (const ge of pending) await db().begin((tx) => applyGoogleEvent(tx, link, ge, stats));
    await sql`update google_calendar_links set sync_token = ${page.nextSyncToken ?? null} where id = ${link.id}`;
    break;
  }
  return stats;
}

// ---------- 내보내기 (회사 캘린더 → Google) ----------
async function push(sql: Sql, link: Link) {
  const stats = { inserted: 0, patched: 0, deleted: 0, conflicts: 0, exceptions: 0 };
  if (link.direction !== 'both') return stats;
  const cal = enc(link.google_calendar_id);
  const masters = await sql`
    select e.*, m.google_event_id, m.google_etag, m.local_version as map_version
    from events e left join google_event_map m on m.local_event_id = e.id and m.link_id = ${link.id}
    where e.calendar_id = ${link.local_calendar_id} and e.recurring_event_id is null
      and ((m.google_event_id is null and e.deleted_at is null and (e.rrule is not null or e.end_at > now() - interval '30 days'))
        or (m.google_event_id is not null and m.local_version < e.version))
    order by e.updated_at limit 200`;
  for (const e of masters) {
    if (e.deleted_at && e.google_event_id) {
      try {
        await gapi(link.user_id, 'DELETE', `/calendars/${cal}/events/${enc(e.google_event_id)}`);
      } catch (err) {
        if (!(err instanceof GoogleApiError && (err.status === 404 || err.status === 410))) throw err;
      }
      await sql`delete from google_event_map where link_id = ${link.id} and local_event_id = ${e.id}`;
      await log(sql, link, 'push', 'delete', 'ok', { eventId: e.id, title: e.title });
      stats.deleted++;
      continue;
    }
    if (e.deleted_at) continue;
    const body = toGoogle(e);
    if (!e.google_event_id) {
      // 직전 시도에서 생성은 됐는데 map 저장 전에 실패한 경우 대비
      const found = await gapi(link.user_id, 'GET', `/calendars/${cal}/events`, { query: { privateExtendedProperty: `workosId=${e.id}`, showDeleted: 'false' } });
      let ge = found?.items?.[0];
      if (!ge) ge = await gapi(link.user_id, 'POST', `/calendars/${cal}/events`, { body, query: { sendUpdates: 'none' } });
      await sql`insert into google_event_map (link_id, local_event_id, google_event_id, google_etag, local_version, google_updated)
        values (${link.id}, ${e.id}, ${ge.id}, ${ge.etag}, ${e.version}, ${ge.updated ?? null})
        on conflict (link_id, google_event_id) do update set google_etag = excluded.google_etag, local_version = excluded.local_version`;
      await log(sql, link, 'push', 'insert', 'ok', { eventId: e.id, title: e.title });
      stats.inserted++;
      continue;
    }
    try {
      const ge = await gapi(link.user_id, 'PATCH', `/calendars/${cal}/events/${enc(e.google_event_id)}`, { body, ifMatch: e.google_etag, query: { sendUpdates: 'none' } });
      await sql`update google_event_map set google_etag = ${ge.etag}, local_version = ${e.version}, google_updated = ${ge.updated ?? null}, updated_at = now()
        where link_id = ${link.id} and local_event_id = ${e.id}`;
      stats.patched++;
    } catch (err) {
      if (err instanceof GoogleApiError && err.status === 412) {
        // Google 쪽이 먼저 바뀜 → 최신본 확인 후 수정 시각 비교
        const ge = await gapi(link.user_id, 'GET', `/calendars/${cal}/events/${enc(e.google_event_id)}`);
        stats.conflicts++;
        if (ge.updated && new Date(ge.updated) > new Date(e.updated_at)) {
          await db().begin((tx) => applyGoogleEvent(tx, { ...link }, { ...ge, etag: ge.etag }, { created: 0, updated: 0, deleted: 0, cancelled: 0, unchanged: 0, skipped: 0, conflicts: 0, relinked: 0 }));
          await log(sql, link, 'push', 'conflict', 'conflict', { eventId: e.id, winner: 'google' });
        } else {
          const ge2 = await gapi(link.user_id, 'PATCH', `/calendars/${cal}/events/${enc(e.google_event_id)}`, { body, ifMatch: ge.etag, query: { sendUpdates: 'none' } });
          await sql`update google_event_map set google_etag = ${ge2.etag}, local_version = ${e.version} where link_id = ${link.id} and local_event_id = ${e.id}`;
          await log(sql, link, 'push', 'conflict', 'conflict', { eventId: e.id, winner: 'local' });
        }
      } else if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) {
        // Google 에서 사라진 일정 → 연결만 끊고 회사 일정은 유지 (임의 삭제 금지)
        await sql`delete from google_event_map where link_id = ${link.id} and local_event_id = ${e.id}`;
        await log(sql, link, 'push', 'missing_on_google', 'skipped', { eventId: e.id });
      } else throw err;
    }
  }
  // 반복 일정의 개별 수정 회차
  const exs = await sql`
    select x.*, mm.google_event_id as master_gid, me.all_day as master_all_day, m.google_event_id, m.google_etag, m.local_version as map_version
    from events x join events me on me.id = x.recurring_event_id
    join google_event_map mm on mm.local_event_id = x.recurring_event_id and mm.link_id = ${link.id}
    left join google_event_map m on m.local_event_id = x.id and m.link_id = ${link.id}
    where me.calendar_id = ${link.local_calendar_id} and x.deleted_at is null and not x.cancelled
      and (m.google_event_id is null or m.local_version < x.version)
    limit 100`;
  for (const x of exs) {
    const gid = x.google_event_id ?? instanceId(x.master_gid, x.original_start, x.master_all_day);
    try {
      const ge = await gapi(link.user_id, 'PATCH', `/calendars/${cal}/events/${enc(gid)}`, { body: toGoogle(x), query: { sendUpdates: 'none' } });
      await sql`insert into google_event_map (link_id, local_event_id, google_event_id, google_etag, local_version)
        values (${link.id}, ${x.id}, ${ge.id}, ${ge.etag}, ${x.version})
        on conflict (link_id, google_event_id) do update set google_etag = excluded.google_etag, local_version = excluded.local_version, local_event_id = excluded.local_event_id`;
      stats.exceptions++;
    } catch (err) {
      await log(sql, link, 'push', 'exception', 'error', { eventId: x.id, error: (err as Error).message });
    }
  }
  return stats;
}

// ---------- 웹훅 채널 ----------
export async function ensureWatch(sql: Sql, link: Link) {
  const app = process.env.APP_URL ?? '';
  if (!app.startsWith('https://') && !process.env.GOOGLE_WEBHOOK_URL) return { skipped: 'https 주소가 아니어서 웹훅을 등록하지 않음' };
  if (link.channel_expires_at && new Date(link.channel_expires_at).getTime() > Date.now() + 24 * 3600_000) return { ok: 'valid' };
  await stopWatch(sql, link);
  const id = randomUUID();
  const token = newToken(24);
  const r = await gapi(link.user_id, 'POST', `/calendars/${enc(link.google_calendar_id)}/events/watch`, {
    body: { id, type: 'web_hook', address: process.env.GOOGLE_WEBHOOK_URL ?? `${app}/api/google/webhook`, token, params: { ttl: String(7 * 86400) } },
  });
  await sql`update google_calendar_links set channel_id = ${id}, channel_token = ${token}, channel_resource_id = ${r.resourceId},
    channel_expires_at = ${r.expiration ? new Date(Number(r.expiration)) : null} where id = ${link.id}`;
  await log(sql, link, 'watch', 'register', 'ok', { expires: r.expiration });
  return { ok: 'registered' };
}

export async function stopWatch(sql: Sql, link: Link) {
  if (!link.channel_id || !link.channel_resource_id) return;
  try {
    await gapi(link.user_id, 'POST', '/channels/stop', { body: { id: link.channel_id, resourceId: link.channel_resource_id } });
  } catch { /* 이미 만료된 채널 */ }
  await sql`update google_calendar_links set channel_id = null, channel_resource_id = null, channel_token = null, channel_expires_at = null where id = ${link.id}`;
}

// ---------- 전체 실행 ----------
export async function syncLink(linkId: string, reason = 'manual') {
  const sql = db();
  const name = `gsync:${linkId}`;
  let holder = await lock(sql, name);
  // 사용자가 누른 동기화는 진행 중인 동기화가 끝날 때까지 잠시 기다린다
  for (let i = 0; !holder && reason === 'manual' && i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    holder = await lock(sql, name);
  }
  if (!holder) return { skipped: 'locked' };
  try {
    const [link] = await sql<Link[]>`select * from google_calendar_links where id = ${linkId}`;
    if (!link || link.status === 'paused') return { skipped: 'paused' };
    try {
      const pulled = await pull(sql, link);
      const pushed = await push(sql, link);
      let watch: unknown = null;
      try { watch = await ensureWatch(sql, (await sql<Link[]>`select * from google_calendar_links where id = ${linkId}`)[0]); }
      catch (e) { watch = { error: (e as Error).message }; }
      await sql`update google_calendar_links set status = 'active', last_error = null, fail_count = 0, last_synced_at = now() where id = ${linkId}`;
      const changed = pulled.created + pulled.updated + pulled.deleted + pulled.cancelled + pushed.inserted + pushed.patched + pushed.deleted + pushed.exceptions;
      if (changed || pulled.conflicts || pushed.conflicts || reason === 'manual') await log(sql, link, 'sync', reason, 'ok', { pulled, pushed, watch });
      return { pulled, pushed, watch };
    } catch (e) {
      const msg = (e as Error).message;
      const fails = link.fail_count + 1;
      await sql`update google_calendar_links set fail_count = ${fails}, last_error = ${msg}, status = ${fails >= 3 ? 'error' : link.status} where id = ${linkId}`;
      await log(sql, link, 'sync', reason, 'error', { error: msg });
      if (!(e instanceof GoogleAuthError)) await logError('google-sync', e, { linkId });
      if (fails === 3) {
        await notify(sql, { userIds: [link.user_id], type: 'sync_error', title: 'Google Calendar 동기화 실패',
          body: `최근 동기화가 계속 실패했습니다: ${msg.slice(0, 80)}. 설정 > Google Calendar 에서 "지금 동기화" 또는 "다시 연결"을 눌러 주세요.`,
          link: '/settings/google', dedupeKey: `syncfail:${linkId}:${new Date().toISOString().slice(0, 10)}` });
      }
      return { error: msg };
    }
  } finally {
    await unlock(sql, name, holder);
  }
}

export async function syncAllDue(maxLinks = 20) {
  const sql = db();
  const links = await sql<{ id: string }[]>`select l.id from google_calendar_links l join google_accounts a on a.user_id = l.user_id
    where l.status <> 'paused' and a.status = 'active' and (l.last_synced_at is null or l.last_synced_at < now() - interval '10 minutes')
    order by l.last_synced_at nulls first limit ${maxLinks}`;
  const results: Record<string, unknown> = {};
  for (const l of links) results[l.id] = await syncLink(l.id, 'scheduler');
  return { links: links.length, results };
}
