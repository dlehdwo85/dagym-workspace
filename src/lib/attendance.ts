// V30 ③ 간이 근태: [출근][퇴근] 기록 + (동의한 사람만) 그 순간의 위치 → 회사 현장(주소·반경 m) 안인지, 밖이면 사유. 관리자: 날짜별·사람별 표(지각·미기록·연차·출장), 월 요약, 엑셀.
// 급여·52시간 관리는 범위 밖. 위치는 출퇴근 순간만 저장하고 다른 곳에 쓰지 않는다. 다른 회사 404.
import { z } from 'zod';
import { db, type Sql } from './db';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { isAdmin, denyDemo } from './access';
import { RANK, menuLevel } from './menuPerms';
import { audit } from './log';
import { todaySeoul } from './time';
import { tenantOf, type SessionUser } from './types';

export const clockInput = z.object({
  type: z.enum(['in', 'out']),
  lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), accuracy: z.number().min(0).optional(),
  reason: z.string().trim().max(200).optional(),
  consent: z.boolean().optional(), // 처음 1번: 위치 동의
  noLocation: z.boolean().optional(), // 위치 권한 거부·실패 → 위치 없이 기록
});
export const siteInput = z.object({ name: z.string().trim().min(1).max(60), address: z.string().trim().max(200).optional(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radiusM: z.number().int().min(30).max(5000).default(200), active: z.boolean().optional() });
export const settingsInput = z.object({ attendanceOn: z.boolean().optional(), workStart: z.string().regex(/^\d{2}:\d{2}$/).optional() });

const R = 6371000;
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const hhmm = (d: Date | null) => (d ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(d) : null);
const canAdmin = async (u: SessionUser, need: 'view' | 'edit', sql: Sql = db()) => isAdmin(u) || RANK[await menuLevel(u, 'attendance_admin', sql)] >= RANK[need];

async function settings(sql: Sql, t: string) {
  const [r] = await sql<{ attendance_on: boolean; work_start: string }[]>`select attendance_on, work_start from tenants where id = ${t}`;
  return { on: r?.attendance_on ?? true, workStart: r?.work_start ?? '09:00' };
}
async function sites(sql: Sql, t: string, all = false) {
  return sql<{ id: string; name: string; address: string | null; lat: number; lng: number; radius_m: number; active: boolean }[]>`select id, name, address, lat, lng, radius_m, active from work_sites where tenant = ${t} ${all ? sql`` : sql`and active`} order by name`;
}
/** 오늘 내 기록 + 현장 수·동의 여부·기능 켬 */
export async function myToday(u: SessionUser) {
  const sql = db(); const t = tenantOf(u);
  const day = todaySeoul();
  const [row] = await sql<any[]>`select a.*, si.name as in_site_name, so.name as out_site_name from attendance a left join work_sites si on si.id = a.in_site_id left join work_sites so on so.id = a.out_site_id where a.tenant = ${t} and a.user_id = ${u.id} and a.day = ${day}`;
  const [cs] = await sql<{ location_consent_at: Date | null }[]>`select location_consent_at from user_settings where user_id = ${u.id}`;
  const st = await settings(sql, t); const ss = await sites(sql, t);
  return { on: st.on, day, consent: !!cs?.location_consent_at, sites: ss.length, workStart: st.workStart,
    today: row ? { inAt: row.in_at, inTime: hhmm(row.in_at), inSite: row.in_site_name, inInside: row.in_inside, inReason: row.in_reason, outAt: row.out_at, outTime: hhmm(row.out_at), outSite: row.out_site_name, outInside: row.out_inside, outReason: row.out_reason } : null };
}
/** 출근/퇴근 기록 — 현장이 등록돼 있고 위치가 있으면 가장 가까운 현장과 반경 안인지, 밖이면 사유 필요(없으면 400 outside) */
export async function clock(u: SessionUser, i: z.infer<typeof clockInput>, ip: string | null) {
  denyDemo(u);
  const sql = db(); const t = tenantOf(u);
  const st = await settings(sql, t);
  if (!st.on) throw badRequest('이 회사는 출퇴근 기록을 쓰지 않습니다(관리자 설정)');
  if (i.consent) await sql`insert into user_settings (user_id, location_consent_at) values (${u.id}, now()) on conflict (user_id) do update set location_consent_at = coalesce(user_settings.location_consent_at, now())`;
  const [cs] = await sql<{ location_consent_at: Date | null }[]>`select location_consent_at from user_settings where user_id = ${u.id}`;
  if (!cs?.location_consent_at && !i.noLocation) throw new HttpError(400, 'consent', '위치 동의가 필요합니다 — 출퇴근 순간의 위치만 저장합니다');
  const day = todaySeoul();
  const [cur] = await sql<any[]>`select in_at, out_at from attendance where tenant = ${t} and user_id = ${u.id} and day = ${day}`;
  if (i.type === 'in' && cur?.in_at) throw badRequest(`오늘은 이미 ${hhmm(cur.in_at)}에 출근했습니다`);
  if (i.type === 'out' && !cur?.in_at) throw badRequest('출근 기록이 없습니다 — 먼저 [출근]을 눌러 주세요');
  if (i.type === 'out' && cur?.out_at) throw badRequest(`오늘은 이미 ${hhmm(cur.out_at)}에 퇴근했습니다`);
  const ss = await sites(sql, t);
  let siteId: string | null = null, inside: boolean | null = null, nearest: { name: string; distance: number; radius: number } | null = null;
  const has = i.lat !== undefined && i.lng !== undefined && !i.noLocation;
  if (has && ss.length) {
    const d = ss.map((s) => ({ s, dist: distanceM({ lat: i.lat!, lng: i.lng! }, { lat: s.lat, lng: s.lng }) })).sort((a, b) => a.dist - b.dist)[0];
    nearest = { name: d.s.name, distance: Math.round(d.dist), radius: d.s.radius_m };
    inside = d.dist <= d.s.radius_m + (i.accuracy && i.accuracy < 100 ? i.accuracy : 0);
    siteId = d.s.id;
    if (!inside && !i.reason) throw new HttpError(400, 'outside', `현장 밖입니다 (${d.s.name}에서 ${Math.round(d.dist)}m) — 사유를 적어 주세요`, { nearest });
  }
  const lat = has ? i.lat! : null, lng = has ? i.lng! : null;
  const reason = i.reason?.trim() || (!has && ss.length ? '위치 없음' : null);
  if (i.type === 'in') {
    await sql`insert into attendance (tenant, user_id, day, in_at, in_lat, in_lng, in_site_id, in_inside, in_reason) values (${t}, ${u.id}, ${day}, now(), ${lat}, ${lng}, ${siteId}, ${inside}, ${reason})
      on conflict (tenant, user_id, day) do update set in_at = now(), in_lat = excluded.in_lat, in_lng = excluded.in_lng, in_site_id = excluded.in_site_id, in_inside = excluded.in_inside, in_reason = excluded.in_reason, updated_at = now()`;
  } else {
    await sql`update attendance set out_at = now(), out_lat = ${lat}, out_lng = ${lng}, out_site_id = ${siteId}, out_inside = ${inside}, out_reason = ${reason}, updated_at = now() where tenant = ${t} and user_id = ${u.id} and day = ${day}`;
  }
  await audit(sql, u.id, `attendance.${i.type}`, 'attendance', null, { day, inside, site: nearest?.name ?? null }, ip);
  return { ok: true, ...(await myToday(u)), nearest };
}

/** 관리자 표: 날짜 하루(사람별 출퇴근·현장·지각·미기록·연차/출장) 또는 월 요약 */
export async function sheet(u: SessionUser, f: { day?: string; month?: string }) {
  const sql = db(); const t = tenantOf(u);
  if (!(await canAdmin(u, 'view', sql))) throw forbidden('근태 표는 관리자(근태 관리 권한)만 볼 수 있습니다');
  const st = await settings(sql, t);
  const people = await sql<{ id: string; name: string; title: string | null }[]>`select id, name, title from users where tenant = ${t} and status = 'active' order by name`;
  const [ws] = st.workStart.split(':').map(Number);
  const late = (inAt: Date | null) => { if (!inAt) return false; const k = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(inAt); const [h, m] = k.split(':').map(Number); return h * 60 + m > ws * 60 + (Number(st.workStart.split(':')[1]) || 0); };
  if (f.day) {
    const day = f.day;
    const rows = await sql<any[]>`select a.*, si.name as in_site_name, so.name as out_site_name from attendance a left join work_sites si on si.id = a.in_site_id left join work_sites so on so.id = a.out_site_id where a.tenant = ${t} and a.day = ${day}`;
    const away = await awayMap(sql, t, day, day);
    const [hol] = await sql<{ name: string }[]>`select name from holidays where date = ${day}`;
    const dow = new Date(`${day}T00:00:00+09:00`).getUTCDay();
    const workday = !hol && dow !== 0 && dow !== 6;
    return { day, workday, holiday: hol?.name ?? null, workStart: st.workStart, rows: people.map((p) => {
      const a = rows.find((r) => r.user_id === p.id); const aw = away.get(`${p.id}:${day}`);
      return { id: p.id, name: p.name, title: p.title, inTime: hhmm(a?.in_at ?? null), inSite: a?.in_site_name ?? null, inInside: a?.in_inside ?? null, inReason: a?.in_reason ?? null, outTime: hhmm(a?.out_at ?? null), outSite: a?.out_site_name ?? null, outInside: a?.out_inside ?? null, outReason: a?.out_reason ?? null,
        late: late(a?.in_at ?? null), missing: workday && !a?.in_at && !aw, away: aw ?? null };
    }) };
  }
  const month = f.month ?? todaySeoul().slice(0, 7);
  const from = `${month}-01`; const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const rows = await sql<any[]>`select user_id, to_char(day, 'YYYY-MM-DD') as day, in_at, out_at, in_inside, out_inside from attendance where tenant = ${t} and day between ${from} and ${to}`;
  const hols = new Set((await sql<{ d: string }[]>`select to_char(date, 'YYYY-MM-DD') d from holidays where date between ${from} and ${to}`).map((r) => r.d));
  const away = await awayMap(sql, t, from, to);
  const today = todaySeoul();
  const days: string[] = []; for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
  const workdays = days.filter((d) => d <= today && !hols.has(d) && ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
  return { month, workStart: st.workStart, days: workdays.length, rows: people.map((p) => {
    const mine = rows.filter((r) => r.user_id === p.id);
    const present = mine.filter((r) => r.in_at).length, lateN = mine.filter((r) => late(r.in_at)).length, outside = mine.filter((r) => r.in_inside === false || r.out_inside === false).length;
    const awayN = workdays.filter((d) => away.get(`${p.id}:${d}`)).length;
    const missing = workdays.filter((d) => !mine.some((r) => r.day === d && r.in_at) && !away.get(`${p.id}:${d}`)).length;
    return { id: p.id, name: p.name, title: p.title, present, late: lateN, outside, away: awayN, missing };
  }) };
}
/** 연차·반차·출장(일정)으로 자리 비운 날: `${userId}:${day}` → 종류 */
async function awayMap(sql: Sql, t: string, from: string, to: string) {
  const rows = await sql<{ user_id: string; kind: string; start_at: Date; end_at: Date }[]>`select e.created_by as user_id, e.kind, e.start_at, e.end_at from events e join users us on us.id = e.created_by
    where us.tenant = ${t} and e.deleted_at is null and not e.cancelled and e.kind in ('vacation', 'half_day', 'business_trip') and e.start_at < ${to + 'T23:59:59+09:00'} and e.end_at > ${from + 'T00:00:00+09:00'}`;
  const m = new Map<string, string>();
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
  for (const r of rows) {
    const label = r.kind === 'vacation' ? '연차' : r.kind === 'half_day' ? '반차' : '출장';
    for (let d = new Date(r.start_at); d < r.end_at; d.setUTCDate(d.getUTCDate() + 1)) { const k = fmt.format(d); if (k >= from && k <= to) m.set(`${r.user_id}:${k}`, label); }
    const last = fmt.format(new Date(r.end_at.getTime() - 1)); if (last >= from && last <= to) m.set(`${r.user_id}:${last}`, label);
  }
  return m;
}
export async function exportMonth(u: SessionUser, month: string) {
  const sql = db(); const t = tenantOf(u);
  if (!(await canAdmin(u, 'view', sql))) throw forbidden('근태 표는 관리자만 내려받을 수 있습니다');
  const from = `${month}-01`; const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const rows = await sql<any[]>`select us.name, us.title, to_char(a.day, 'YYYY-MM-DD') as day, a.in_at, a.out_at, si.name as in_site, a.in_inside, a.in_reason, so.name as out_site, a.out_inside, a.out_reason
    from attendance a join users us on us.id = a.user_id left join work_sites si on si.id = a.in_site_id left join work_sites so on so.id = a.out_site_id where a.tenant = ${t} and a.day between ${from} and ${to} order by a.day, us.name`;
  const { writeXlsx } = await import('./xlsx');
  const summary = (await sheet(u, { month })) as { days: number; rows: { name: string; title: string | null; present: number; late: number; outside: number; away: number; missing: number }[] };
  const data = writeXlsx([
    { name: '출퇴근 기록', rows: [['날짜', '이름', '직책', '출근', '출근 현장', '현장 안', '출근 사유', '퇴근', '퇴근 현장', '현장 안', '퇴근 사유'],
      ...rows.map((r) => [r.day, r.name, r.title ?? '', hhmm(r.in_at) ?? '', r.in_site ?? '', r.in_inside === null ? '' : r.in_inside ? '예' : '아니오', r.in_reason ?? '', hhmm(r.out_at) ?? '', r.out_site ?? '', r.out_inside === null ? '' : r.out_inside ? '예' : '아니오', r.out_reason ?? ''])], widths: [12, 10, 10, 8, 12, 8, 16, 8, 12, 8, 16] },
    { name: '월 요약', rows: [['이름', '직책', '근무일(지금까지)', '출근', '지각', '현장 밖', '연차·출장', '미기록'], ...summary.rows.map((r) => [r.name, r.title ?? '', summary.days, r.present, r.late, r.outside, r.away, r.missing])] },
  ]);
  return { fileName: `출퇴근_${month}.xlsx`, data };
}
// ---- 현장·설정(관리자 편집) ----
export async function listSites(u: SessionUser) {
  const sql = db(); const t = tenantOf(u);
  const edit = await canAdmin(u, 'edit', sql);
  return { sites: await sites(sql, t, edit), canEdit: edit, settings: await settings(sql, t) };
}
export async function saveSite(u: SessionUser, id: string | null, i: z.infer<typeof siteInput>, ip: string | null) {
  const sql = db(); const t = tenantOf(u);
  if (!(await canAdmin(u, 'edit', sql))) throw forbidden('현장은 관리자(근태 관리 편집)만 고칠 수 있습니다');
  let sid = id;
  if (id) {
    const r = await sql`update work_sites set name = ${i.name}, address = ${i.address ?? null}, lat = ${i.lat}, lng = ${i.lng}, radius_m = ${i.radiusM}, active = ${i.active ?? true} where id = ${id} and tenant = ${t} returning id`;
    if (!r.length) throw notFound('현장이 없습니다');
  } else { const [r] = await sql<{ id: string }[]>`insert into work_sites (tenant, name, address, lat, lng, radius_m, created_by) values (${t}, ${i.name}, ${i.address ?? null}, ${i.lat}, ${i.lng}, ${i.radiusM}, ${u.id}) returning id`; sid = r.id; }
  await audit(sql, u.id, 'attendance.site', 'work_site', sid, { name: i.name }, ip);
  return { id: sid };
}
export async function deleteSite(u: SessionUser, id: string, ip: string | null) {
  const sql = db();
  if (!(await canAdmin(u, 'edit', sql))) throw forbidden('현장은 관리자만 지울 수 있습니다');
  const r = await sql`update work_sites set active = false where id = ${id} and tenant = ${tenantOf(u)} returning id`;
  if (!r.length) throw notFound('현장이 없습니다');
  await audit(sql, u.id, 'attendance.site_delete', 'work_site', id, {}, ip);
  return { ok: true };
}
export async function saveSettings(u: SessionUser, i: z.infer<typeof settingsInput>, ip: string | null) {
  const sql = db(); const t = tenantOf(u);
  if (!(await canAdmin(u, 'edit', sql))) throw forbidden('근태 설정은 관리자만 바꿀 수 있습니다');
  if (i.attendanceOn !== undefined) await sql`update tenants set attendance_on = ${i.attendanceOn} where id = ${t}`;
  if (i.workStart) await sql`update tenants set work_start = ${i.workStart} where id = ${t}`;
  await audit(sql, u.id, 'attendance.settings', null, null, i, ip);
  return settings(sql, t);
}
/** 근무 상태 점에 쓸 오늘 출퇴근: 기능을 쓰는 회사(현장 있음 또는 이달 기록 있음)만 — 출근 전/퇴근 */
export async function clockStates(sql: Sql, t: string): Promise<Record<string, 'before' | 'done'>> {
  const [st] = await sql<{ attendance_on: boolean }[]>`select attendance_on from tenants where id = ${t}`;
  if (st && !st.attendance_on) return {};
  const [{ n }] = await sql<{ n: number }[]>`select (select count(*) from work_sites where tenant = ${t} and active) + (select count(*) from attendance where tenant = ${t} and day >= current_date - 31) as n`;
  if (!Number(n)) return {};
  const day = todaySeoul();
  const rows = await sql<{ id: string; in_at: Date | null; out_at: Date | null }[]>`select us.id, a.in_at, a.out_at from users us left join attendance a on a.user_id = us.id and a.day = ${day} where us.tenant = ${t} and us.status = 'active'`;
  const out: Record<string, 'before' | 'done'> = {};
  for (const r of rows) { if (!r.in_at) out[r.id] = 'before'; else if (r.out_at) out[r.id] = 'done'; }
  return out;
}
