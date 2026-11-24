import { z } from 'zod';
import { DateTime } from 'luxon';
import { db, type Sql } from './db';
import { notFound } from './errors';
import { audit } from './log';
import type { SessionUser } from './types';

/**
 * D-18 위치정보 보호조치(로컬 11/24 위임 — docs/legal/LBS_BUSINESS_PLAN_2026-11-24.md 부록 ③④⑤⑥, 지침: docs/legal/LBS_INTERNAL_POLICY_2026-11-24.md)
 * ③ 출퇴근 좌표 = 앱 수준 암호화(attendance.in_loc_enc/out_loc_enc, AES-256-GCM) — 평문 위도·경도 칸은 비워 둠
 * ④ 확인자료(location_logs) = DB 트리거로 고치기·1년 전 지우기 금지(DB 286) + 매일 요약 해시 사슬(location_log_digests)
 * ⑤ 플랫폼 운영자 월 점검 화면(누가 위치 결과를 봤는지·건수·이상) + [점검 완료] 기록(audit lbs.monthly_check)
 * ⑥ 정기 자체 점검: 평문 좌표 남음·6개월 지난 좌표·1년 지난 확인자료·해시 빠짐/불일치 → 있으면 플랫폼 운영자 알림(하루 한 번)
 */
const TZ = 'Asia/Seoul';
const seoulDay = (d: DateTime = DateTime.now()) => d.setZone(TZ).toISODate()!;

export async function encLoc(lat: number | null, lng: number | null, accuracy?: number | null) {
  if (lat === null || lng === null) return null;
  const { encrypt } = await import('./crypto');
  return encrypt(JSON.stringify({ lat, lng, acc: accuracy ?? null }));
}

/** 예전 평문 좌표를 암호화 칸으로 옮김(한 번에 500줄) */
export async function migratePlainCoords(sql: Sql = db()) {
  const rows = await sql<{ id: string; in_lat: number | null; in_lng: number | null; out_lat: number | null; out_lng: number | null }[]>`
    select id, in_lat::float8 in_lat, in_lng::float8 in_lng, out_lat::float8 out_lat, out_lng::float8 out_lng from attendance where in_lat is not null or out_lat is not null limit 500`;
  for (const r of rows) {
    const ie = r.in_lat !== null && r.in_lng !== null ? await encLoc(r.in_lat, r.in_lng) : null;
    const oe = r.out_lat !== null && r.out_lng !== null ? await encLoc(r.out_lat, r.out_lng) : null;
    await sql`update attendance set in_loc_enc = coalesce(${ie}, in_loc_enc), out_loc_enc = coalesce(${oe}, out_loc_enc), in_lat = null, in_lng = null, out_lat = null, out_lng = null where id = ${r.id}`;
  }
  return rows.length;
}

const DIGEST_ROWS = (sql: Sql, day: string) => sql`select count(*)::int as n,
    coalesce(string_agg(concat_ws('|', id, tenant, kind, coalesce(subject_user_id::text, ''), coalesce(viewer_user_id::text, ''), coalesce(purpose, ''), detail::text,
      to_char(extract(epoch from created_at), 'FM9999999999.999999')), E'\\n' order by id), '') as body
  from location_logs where day = ${day}::date`;
async function digestOf(sql: Sql, day: string, prev: string | null) {
  const [r] = await sql<{ n: number; body: string }[]>`${DIGEST_ROWS(sql, day)}`;
  const { createHash } = await import('node:crypto');
  return { rows: r.n, digest: createHash('sha256').update(`${prev ?? ''}\n${r.body}`).digest('hex') };
}
/** 어제까지 아직 없는 날의 요약 해시를 만듦(앞날 해시를 이어 붙임) */
export async function writeDigests(sql: Sql = db()) {
  const yesterday = seoulDay(DateTime.now().minus({ days: 1 }));
  const [last] = await sql<{ day: string; digest: string }[]>`select day::text, digest from location_log_digests order by day desc limit 1`;
  const [first] = await sql<{ day: string | null }[]>`select min(day)::text as day from location_logs`;
  let day = last ? seoulDay(DateTime.fromISO(last.day, { zone: TZ }).plus({ days: 1 })) : first?.day ?? null;
  let prev = last?.digest ?? null; let n = 0;
  while (day && day <= yesterday && n < 400) {
    const d = await digestOf(sql, day, prev);
    await sql`insert into location_log_digests (day, rows, digest, prev_digest) values (${day}, ${d.rows}, ${d.digest}, ${prev}) on conflict (day) do nothing`;
    prev = d.digest; n++;
    day = seoulDay(DateTime.fromISO(day, { zone: TZ }).plus({ days: 1 }));
  }
  return n;
}

export type LbsIssue = { code: 'plain' | 'old_coords' | 'old_logs' | 'digest_missing' | 'digest_mismatch'; label: string };
/** ⑥ 자체 점검 — 문제 목록(없으면 빈 배열). 최근 35일 해시는 다시 셈해 맞춰 봄 */
export async function locationSelfCheck(sql: Sql = db()): Promise<LbsIssue[]> {
  const out: LbsIssue[] = [];
  const [c] = await sql<{ plain: number; old: number; logs: number }[]>`select
      (select count(*)::int from attendance where in_lat is not null or out_lat is not null) as plain,
      (select count(*)::int from attendance where day < (now() at time zone 'Asia/Seoul')::date - interval '6 months' and (in_loc_enc is not null or out_loc_enc is not null or in_lat is not null or out_lat is not null)) as old,
      (select count(*)::int from location_logs where created_at < now() - interval '1 year' - interval '2 days') as logs`;
  if (c.plain) out.push({ code: 'plain', label: `암호화되지 않은 좌표 ${c.plain}줄(정기 실행이 옮기는 중이면 다음 실행 뒤 0)` });
  if (c.old) out.push({ code: 'old_coords', label: `6개월 지난 좌표 ${c.old}줄이 남아 있음` });
  if (c.logs) out.push({ code: 'old_logs', label: `1년 지난 확인자료 ${c.logs}줄이 남아 있음` });
  const since = seoulDay(DateTime.now().minus({ days: 35 })); const yesterday = seoulDay(DateTime.now().minus({ days: 1 }));
  const days = await sql<{ day: string }[]>`select distinct day::text from location_logs where day >= ${since}::date and day <= ${yesterday}::date order by 1`;
  const digests = await sql<{ day: string; rows: number; digest: string; prev_digest: string | null }[]>`select day::text, rows, digest, prev_digest from location_log_digests where day >= ${since}::date order by day`;
  const byDay = new Map(digests.map((d) => [d.day, d]));
  const missing = days.filter((d) => !byDay.has(d.day)).map((d) => d.day);
  if (missing.length) out.push({ code: 'digest_missing', label: `요약 해시가 없는 날 ${missing.length}일(${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ' …' : ''})` });
  const bad: string[] = [];
  for (const d of digests) { const r = await digestOf(sql, d.day, d.prev_digest); if (r.digest !== d.digest || r.rows !== d.rows) bad.push(d.day); }
  if (bad.length) out.push({ code: 'digest_mismatch', label: `기록이 바뀐 날 ${bad.length}일(${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ' …' : ''}) — 요약 해시와 다름` });
  return out;
}

/** 정기 실행(locationRetentionTick 뒤): 해시 쓰기 + 자체 점검 → 문제가 있으면 플랫폼 운영자에게 하루 한 번 알림 */
export async function locationProtectTick(sql: Sql = db()) {
  const written = await writeDigests(sql);
  const issues = await locationSelfCheck(sql);
  if (issues.length) {
    const ids = await (await import('./superAdmin')).platformAdminIds(sql).catch(() => [] as string[]);
    if (ids.length) await (await import('./notifications')).notify(sql, { userIds: ids, type: 'usage_alert', title: '위치정보 자체 점검에서 확인할 것이 있습니다',
      body: issues.map((i) => i.label).join(' · ').slice(0, 300), link: '/platform?tab=company#lbs-check', dedupeKey: `lbs-check:${seoulDay()}` }).catch(() => {});
  }
  return { written, issues: issues.length };
}

// ---------------- ⑤ 월 점검(플랫폼 운영자) ----------------
const requireOp = (u: SessionUser) => { if (!u.platformAdmin || u.support) throw notFound(); };
export const lbsCheckQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() });
export async function locationCheckView(u: SessionUser, q: z.infer<typeof lbsCheckQuery> = {}) {
  requireOp(u);
  const sql = db();
  const month = q.month ?? DateTime.now().setZone(TZ).minus({ months: 1 }).toFormat('yyyy-MM');
  const from = `${month}-01`; const to = DateTime.fromISO(from, { zone: TZ }).plus({ months: 1 }).toISODate()!;
  const [kinds, viewers, tenants, checks, issues] = await Promise.all([
    sql<{ kind: string; n: number }[]>`select kind, count(*)::int n from location_logs where day >= ${from}::date and day < ${to}::date group by kind order by kind`,
    sql<{ viewer: string | null; tenant_name: string | null; n: number; people: number; days: number }[]>`select v.name as viewer, t.name as tenant_name, count(*)::int n, count(distinct l.subject_user_id)::int people, count(distinct l.day)::int days
      from location_logs l left join users v on v.id = l.viewer_user_id left join tenants t on t.id = l.tenant
      where l.kind = 'provide' and l.day >= ${from}::date and l.day < ${to}::date group by v.name, t.name order by n desc limit 30`,
    sql<{ tenant_name: string | null; collects: number }[]>`select t.name as tenant_name, count(*)::int collects from location_logs l left join tenants t on t.id = l.tenant
      where l.kind = 'collect' and l.day >= ${from}::date and l.day < ${to}::date group by t.name order by collects desc limit 30`,
    sql<{ at: Date; by: string | null; detail: any }[]>`select a.created_at as at, us.name as by, a.detail from audit_logs a left join users us on us.id = a.actor_id where a.action = 'lbs.monthly_check' order by a.created_at desc limit 12`,
    locationSelfCheck(sql),
  ]);
  return { month, kinds, viewers, tenants, checks: checks.map((c) => ({ at: c.at, by: c.by, month: c.detail?.month ?? null, note: c.detail?.note ?? null, issues: c.detail?.issues ?? 0 })), issues };
}
export const lbsCheckInput = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), note: z.string().trim().max(500).optional() });
export async function markLocationChecked(u: SessionUser, i: z.infer<typeof lbsCheckInput>, ip: string | null) {
  requireOp(u);
  const sql = db();
  const issues = await locationSelfCheck(sql);
  await audit(sql, u.id, 'lbs.monthly_check', null, null, { month: i.month, note: i.note ?? null, issues: issues.length, issueCodes: issues.map((x) => x.code) }, ip);
  return { ok: true, issues };
}
