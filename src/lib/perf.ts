import { z } from 'zod';
import { db, type Sql } from './db';
import { newToken, sha256 } from './crypto';
import { notFound } from './errors';
import { addDays, todaySeoul } from './time';
import type { SessionUser } from './types';

/**
 * #948(대표 11/04 '앱·웹 속도 정기 검침', 로컬 제안안):
 * ① 정기 검침 — 30분마다(정기 실행 안에서) 서버가 자기 주소(APP_URL)로 핵심 API 7곳을 불러 응답 시간을 기록한다(perf_probes).
 *    로그인이 필요한 곳은 슈퍼관리자 1명 이름으로 3분짜리 검침 세션을 만들어 쓰고 바로 지운다(토큰은 이 서버 안에서만 오간다).
 * ② 실제 사용자 — 로그인한 화면의 PerfBeacon 이 화면마다 첫 표시·목록 표시 시간을 보내면(웹·앱 구분) 하루 히스토그램으로 모아 p75 를 낸다(perf_screens).
 * ③ 기준 — API 1.5초(PERF_API_MS) · 화면 3초(PERF_SCREEN_MS). API 는 2번 연속, 화면은 오늘·어제 p75 둘 다 넘으면 플랫폼 운영자(대표) 알림(하루 1번).
 * ④ 주간 요약 — 월요일 08시(KST) 뒤 첫 정기 실행에 지난 7일 요약 메일 1통(PERF_WEEKLY '요일-시', 'any' = 늘, 'off').
 * 시험 서버는 PERF_PROBE=off·PERF_WEEKLY=off(tests/helpers.mjs) — tests/api/perf-948.test.mjs 만 'any'.
 * 검침은 한 곳 10초·전체 35초 상한(정기 실행 호출 90초 안) · 화면 비콘은 로그인한 세션만 셈(사람 값은 저장 안 함) · 하루 화면 줄 1,000개 상한.
 */
export const PERF_API_MS = () => Math.max(100, Number(process.env.PERF_API_MS ?? 1500) || 1500);
export const PERF_SCREEN_MS = () => Math.max(100, Number(process.env.PERF_SCREEN_MS ?? 3000) || 3000);
export const PERF_PROBE_MINUTES = () => Math.max(5, Number(process.env.PERF_PROBE_MINUTES ?? 30) || 30);

export const PERF_TARGETS = [
  { key: 'health', label: '서버 상태(/api/health)', path: '/api/health', auth: false },
  { key: 'login', label: '로그인 화면 첫 응답', path: '/login', auth: false },
  { key: 'tasks', label: '업무 목록(열린 업무)', path: '/api/tasks?status=open', auth: true },
  { key: 'hub', label: '영업기회 허브 › 시설', path: '/api/sales/src?view=hub&tab=facilities', auth: true },
  { key: 'bids', label: '입찰 공고 목록', path: '/api/sales/src?view=bids', auth: true },
  { key: 'approvals', label: '마케팅 승인함', path: '/api/marketing/contents?view=approvals', auth: true },
  { key: 'messages', label: '메신저 대화방 목록', path: '/api/chat/rooms', auth: true },
] as const;
export type PerfTargetKey = (typeof PERF_TARGETS)[number]['key'];
const labelOf = (k: string) => PERF_TARGETS.find((t) => t.key === k)?.label ?? k;

/** 히스토그램 칸 경계(ms) — 마지막 칸(60초)은 그 위 전부 */
export const PERF_BUCKETS = [100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000, 7500, 10000, 15000, 20000, 60000];
const NB = PERF_BUCKETS.length;
export const bucketOf = (ms: number) => { const i = PERF_BUCKETS.findIndex((b) => ms <= b); return i < 0 ? NB - 1 : i; };
/** 히스토그램 분위수(칸 안은 선형 보간). 자료가 없으면 null */
export function quantile(h: number[], q: number): number | null {
  const n = h.reduce((a, b) => a + (b || 0), 0); if (!n) return null;
  const target = q * n; let acc = 0;
  for (let i = 0; i < NB; i++) {
    const c = h[i] || 0; if (!c) continue;
    const lo = i === 0 ? 0 : PERF_BUCKETS[i - 1], hi = PERF_BUCKETS[i];
    if (acc + c >= target) return Math.round(lo + (hi - lo) * ((target - acc) / c));
    acc += c;
  }
  return PERF_BUCKETS[NB - 1];
}
const addH = (a: number[], b: number[]) => a.map((x, i) => (x || 0) + (b[i] || 0));
const zeros = () => Array.from({ length: NB }, () => 0);

// ───────── ② 실제 사용자 화면 비콘 ─────────
export const perfBeaconInput = z.object({
  c: z.enum(['web', 'app']),
  items: z.array(z.object({
    s: z.string().regex(/^\/[a-z0-9/_:.-]{0,60}$/, '화면 이름'),
    f: z.number().min(0).max(120000).optional(),
    l: z.number().min(0).max(120000).optional(),
  })).min(1).max(20),
});
export type PerfBeacon = z.infer<typeof perfBeaconInput>;
const MAX_SCREEN_ROWS_PER_DAY = 1000; // 화면 이름이 끝없이 늘지 않게 — 넘으면 이미 있는 줄만 더함
export async function recordScreens(input: PerfBeacon, now = new Date()) {
  const sql = db(); const day = todaySeoul(now); let n = 0;
  const [{ c }] = await sql<{ c: number }[]>`select count(*)::int as c from perf_screens where day = ${day}`;
  const full = c >= MAX_SCREEN_ROWS_PER_DAY;
  for (const it of input.items) {
    for (const [metric, v] of [['first', it.f], ['list', it.l]] as const) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const ms = Math.round(v); const b = bucketOf(ms) + 1; // SQL 배열은 1부터
      const h = zeros(); h[b - 1] = 1;
      if (full) {
        const u = await sql`update perf_screens set n = n + 1, sum_ms = sum_ms + ${ms}, max_ms = greatest(max_ms, ${ms}), h[${b}] = coalesce(h[${b}], 0) + 1 where day = ${day} and client = ${input.c} and screen = ${it.s} and metric = ${metric} returning 1`;
        n += u.length; continue;
      }
      await sql`insert into perf_screens (day, client, screen, metric, n, sum_ms, max_ms, h) values (${day}, ${input.c}, ${it.s}, ${metric}, 1, ${ms}, ${ms}, ${h}::int[])
        on conflict (day, client, screen, metric) do update set n = perf_screens.n + 1, sum_ms = perf_screens.sum_ms + ${ms}, max_ms = greatest(perf_screens.max_ms, ${ms}),
          h = (select array_agg(case when g = ${b} then coalesce(perf_screens.h[g], 0) + 1 else coalesce(perf_screens.h[g], 0) end order by g) from generate_series(1, ${NB}) g)`;
      n++;
    }
  }
  return { ok: true, n };
}

// ───────── ① 정기 검침 ─────────
type ProbeResult = { key: string; ms: number | null; status: number | null; ok: boolean; skipped?: string };
export async function perfProbeTick(now = new Date()) {
  const gate = process.env.PERF_PROBE ?? 'on';
  if (gate === 'off') return { skipped: 'off' };
  const base = (process.env.APP_URL ?? '').replace(/\/$/, ''); if (!base) return { skipped: 'no APP_URL' };
  const sql = db();
  if (gate !== 'any') {
    const [last] = await sql<{ at: Date | null }[]>`select max(at) as at from perf_probes`;
    if (last?.at && now.getTime() - new Date(last.at).getTime() < (PERF_PROBE_MINUTES() - 2) * 60_000) return { skipped: 'recent' };
  }
  const round = Math.floor(now.getTime() / 60_000);
  const { platformAdminIds } = await import('./superAdmin');
  const admins = await platformAdminIds(sql);
  let token: string | null = null; let sid: string | null = null;
  if (admins[0]) {
    token = newToken(); sid = sha256(token);
    await sql`insert into sessions (id, user_id, client, user_agent, expires_at, persistent) values (${sid}, ${admins[0]}, 'web', 'WorkInPerfProbe/1', now() + interval '3 minutes', false)`;
  }
  const results: ProbeResult[] = [];
  // 정기 실행 호출(GitHub 90초 제한) 안에 끝나게: 한 곳 최대 10초, 전체 최대 35초 — 넘으면 남은 곳은 이번엔 건너뜀(기록 안 함)
  const timeout = Math.max(1000, Number(process.env.PERF_PROBE_TIMEOUT_MS ?? 10000) || 10000);
  const budget = Math.max(2000, Number(process.env.PERF_PROBE_BUDGET_MS ?? 35000) || 35000); const started = performance.now();
  try {
    for (const t of PERF_TARGETS) {
      if (t.auth && !token) { results.push({ key: t.key, ms: null, status: null, ok: false, skipped: 'no admin' }); continue; }
      if (performance.now() - started > budget) { results.push({ key: t.key, ms: null, status: null, ok: false, skipped: 'budget' }); continue; }
      const t0 = performance.now(); let status = 0;
      try {
        const r = await fetch(`${base}${t.path}`, { headers: { 'user-agent': 'WorkInPerfProbe/1', accept: 'application/json, text/html', ...(t.auth ? { authorization: `Bearer ${token}` } : {}) }, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(timeout) });
        status = r.status; await r.arrayBuffer();
      } catch { status = 0; }
      const ms = Math.round(performance.now() - t0); const ok = status >= 200 && status < 400;
      await sql`insert into perf_probes (at, round, target, ms, status, ok) values (${now}, ${round}, ${t.key}, ${ms}, ${status}, ${ok})`;
      results.push({ key: t.key, ms, status, ok });
    }
  } finally { if (sid) await sql`delete from sessions where id = ${sid}`.catch(() => {}); }
  await sql`delete from perf_probes where at < now() - interval '30 days'`;
  await sql`delete from perf_screens where day < (${todaySeoul(now)}::date - 90)`;
  const alerts = await perfAlertCheck(sql, now);
  return { round, results, slow: results.filter((r) => r.ok && (r.ms ?? 0) > PERF_API_MS()).map((r) => r.key), alerts };
}

// ───────── ③ 기준 초과 알림 ─────────
const fmtMs = (ms: number | null) => (ms === null ? '응답 없음' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}초` : `${ms}ms`);
export async function perfAlertCheck(sql: Sql, now = new Date()) {
  const day = todaySeoul(now); const api = PERF_API_MS(), scr = PERF_SCREEN_MS();
  const { platformAdminIds } = await import('./superAdmin');
  const admins = await platformAdminIds(sql); if (!admins.length) return { notified: 0, keys: [] as string[] };
  const { notify } = await import('./notifications');
  const keys: string[] = [];
  const common = { userIds: admins, type: 'perf_alert' as const, link: '/platform?tab=speed', actorId: null }; // entity 칸(uuid)은 안 씀
  // ① 핵심 API: 최근 2번 연속 기준 초과(응답 없음·오류도 초과로 봄)
  const rows = await sql<{ target: string; ms: number; ok: boolean; rn: number }[]>`
    select target, ms, ok, rn from (select target, ms, ok, row_number() over (partition by target order by at desc) rn from perf_probes) x where rn <= 2 order by target, rn`;
  for (const t of PERF_TARGETS) {
    const r = rows.filter((x) => x.target === t.key); if (r.length < 2) continue;
    const bad = (x: { ms: number; ok: boolean }) => !x.ok || x.ms > api;
    if (!bad(r[0]) || !bad(r[1])) continue;
    const show = (x: { ms: number; ok: boolean }) => (x.ok ? fmtMs(x.ms) : `오류(${fmtMs(x.ms)})`);
    const n = await notify(sql, { ...common, dedupeKey: `perf:${t.key}:${day}`,
      title: `속도 기준 초과: ${t.label} — ${show(r[0])} · ${show(r[1])} (2번 연속)`,
      body: `기준 ${api / 1000}초를 2번 연속 넘었습니다. 플랫폼 운영 › 속도에서 최근 7일 흐름과 느린 곳을 보세요.` });
    if (n.length) keys.push(t.key);
  }
  // ② 실제 화면: 오늘(5번 이상)·어제 p75 둘 다 기준 초과(첫 표시 또는 목록 표시)
  const yday = addDays(day, -1);
  const sc = await sql<{ day: string; client: string; screen: string; metric: string; n: number; h: number[] }[]>`
    select day::text, client, screen, metric, n, h from perf_screens where day in (${day}::date, ${yday}::date) and n >= 5`;
  const groups = new Map<string, { client: string; screen: string; metric: string; today?: number | null; yday?: number | null }>();
  for (const r of sc) {
    const k = `${r.client}|${r.screen}|${r.metric}`; const g = groups.get(k) ?? { client: r.client, screen: r.screen, metric: r.metric }; groups.set(k, g);
    if (r.day === day) g.today = quantile(r.h, 0.75); else g.yday = quantile(r.h, 0.75);
  }
  for (const g of groups.values()) {
    if (!(g.today && g.yday && g.today > scr && g.yday > scr)) continue;
    const n = await notify(sql, { ...common, dedupeKey: `perfscr:${g.client}:${g.screen}:${day}`,
      title: `화면 속도 기준 초과: ${g.client === 'app' ? '앱' : '웹'} ${g.screen} ${g.metric === 'list' ? '목록 표시' : '첫 표시'} — 오늘 p75 ${fmtMs(g.today)} · 어제 ${fmtMs(g.yday)}`,
      body: `실제 사용자 기준 화면 ${scr / 1000}초를 이틀 연속 넘었습니다(p75 = 사용자 4명 중 3명이 겪는 시간 안).` });
    if (n.length) keys.push(`${g.client}:${g.screen}`);
  }
  return { notified: keys.length, keys };
}

// ───────── 플랫폼 운영 › 속도 ─────────
type DayRow = { day: string; p75: number | null; max: number | null; n: number; bad: number };
export async function perfOverview(u: SessionUser, days = 7, now = new Date()) {
  if (!u.platformAdmin || u.support) throw notFound(); // 있는 줄도 모르게
  return perfOverviewData(Math.min(31, Math.max(1, Math.floor(days) || 7)), now);
}
export async function perfOverviewData(days = 7, now = new Date()) {
  const sql = db(); const api = PERF_API_MS(), scr = PERF_SCREEN_MS();
  const today = todaySeoul(now); const from = addDays(today, -(days - 1));
  const dayList = Array.from({ length: days }, (_, i) => addDays(from, i));
  const fromTs = `${from}T00:00:00+09:00`;
  const byDay = await sql<(DayRow & { target: string })[]>`
    select target, to_char(at at time zone 'Asia/Seoul', 'YYYY-MM-DD') as day, count(*)::int as n, (percentile_cont(0.75) within group (order by ms))::int as p75, max(ms)::int as max, (count(*) filter (where not ok))::int as bad
    from perf_probes where at >= ${fromTs}::timestamptz group by 1, 2`;
  const week = await sql<{ target: string; n: number; p75: number; max: number; bad: number }[]>`
    select target, count(*)::int as n, (percentile_cont(0.75) within group (order by ms))::int as p75, max(ms)::int as max, (count(*) filter (where not ok))::int as bad
    from perf_probes where at >= ${fromTs}::timestamptz group by 1`;
  const last = await sql<{ target: string; at: Date; ms: number; status: number; ok: boolean }[]>`select distinct on (target) target, at, ms, status, ok from perf_probes order by target, at desc`;
  const targets = PERF_TARGETS.map((t) => ({
    key: t.key, label: t.label, path: t.path, threshold: api,
    last: last.find((r) => r.target === t.key) ?? null,
    week: week.find((r) => r.target === t.key) ?? null,
    byDay: dayList.map((d) => byDay.find((r) => r.target === t.key && r.day === d) ?? null),
  }));
  const sc = await sql<{ day: string; client: string; screen: string; metric: string; n: number; max_ms: number; h: number[] }[]>`
    select day::text, client, screen, metric, n, max_ms, h from perf_screens where day >= ${from}::date`;
  const agg = new Map<string, { client: 'web' | 'app'; screen: string; n: number; first: { h: number[]; max: number; n: number; today: number[] }; list: { h: number[]; max: number; n: number; today: number[] } }>();
  for (const r of sc) {
    const k = `${r.client}|${r.screen}`;
    const g = agg.get(k) ?? { client: r.client as 'web' | 'app', screen: r.screen, n: 0, first: { h: zeros(), max: 0, n: 0, today: zeros() }, list: { h: zeros(), max: 0, n: 0, today: zeros() } };
    agg.set(k, g);
    const m = r.metric === 'list' ? g.list : g.first;
    m.h = addH(m.h, r.h); m.max = Math.max(m.max, r.max_ms); m.n += r.n; if (r.day === today) m.today = addH(m.today, r.h);
    if (r.metric === 'first') g.n += r.n;
  }
  const screens = [...agg.values()].map((g) => ({
    client: g.client, screen: g.screen, n: Math.max(g.first.n, g.list.n), threshold: scr,
    first: g.first.n ? { p75: quantile(g.first.h, 0.75), max: g.first.max, n: g.first.n, today: quantile(g.first.today, 0.75) } : null,
    list: g.list.n ? { p75: quantile(g.list.h, 0.75), max: g.list.max, n: g.list.n, today: quantile(g.list.today, 0.75) } : null,
  })).sort((a, b) => b.n - a.n).slice(0, 60);
  // 느린 곳 상위 5: 기준 대비 p75 비율
  const slow: { kind: 'api' | 'screen'; label: string; p75: number; threshold: number; ratio: number; n: number }[] = [];
  for (const t of targets) if (t.week?.p75) slow.push({ kind: 'api', label: t.label, p75: t.week.p75, threshold: api, ratio: t.week.p75 / api, n: t.week.n });
  for (const s of screens) {
    const p = Math.max(s.first?.p75 ?? 0, s.list?.p75 ?? 0); if (!p || s.n < 3) continue;
    slow.push({ kind: 'screen', label: `${s.client === 'app' ? '앱' : '웹'} ${s.screen}`, p75: p, threshold: scr, ratio: p / scr, n: s.n });
  }
  slow.sort((a, b) => b.ratio - a.ratio);
  const alerts = await sql<{ title: string; at: Date }[]>`select title, min(created_at) as at from notifications where type = 'perf_alert' and created_at >= ${fromTs}::timestamptz group by title order by at desc limit 10`;
  const [p] = await sql<{ at: Date | null }[]>`select max(at) as at from perf_probes`;
  return { days: dayList, thresholds: { api, screen: scr }, targets, screens, slowTop: slow.slice(0, 5), alerts, probe: { lastAt: p?.at ?? null, everyMinutes: PERF_PROBE_MINUTES(), on: (process.env.PERF_PROBE ?? 'on') !== 'off' && !!process.env.APP_URL } };
}

// ───────── ④ 주간 요약 메일 ─────────
function weekMonday(day: string) { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); }
function kstGate(gate: string, now: Date) {
  const [dow, hour] = gate.split('-').map(Number);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(now);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday')?.value ?? ''); const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  return wd === dow && h >= hour;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export async function perfWeeklyTick(now = new Date()) {
  const gate = process.env.PERF_WEEKLY ?? '1-8';
  if (gate === 'off') return { skipped: 'off' };
  if (gate !== 'any' && !kstGate(gate, now)) return { skipped: 'time' };
  const sql = db(); const week = weekMonday(todaySeoul(now));
  const got = await sql`insert into perf_weekly (week) values (${week}::date) on conflict do nothing returning week`;
  if (!got.length) return { skipped: 'sent', week };
  const { superAdmin, platformAdminIds } = await import('./superAdmin');
  const people = (await sql<{ id: string; email: string }[]>`select id, email from users where platform_admin and status = 'active'`).filter((p) => superAdmin(p.email, true));
  const ov = await perfOverviewData(7, now);
  const site = (process.env.APP_URL ?? '').replace(/\/$/, '');
  const lines = ov.targets.map((t) => `${t.label}: p75 ${fmtMs(t.week?.p75 ?? null)} · 최대 ${fmtMs(t.week?.max ?? null)} · 검침 ${t.week?.n ?? 0}번${t.week?.bad ? ` · 오류 ${t.week.bad}번` : ''}${(t.week?.p75 ?? 0) > ov.thresholds.api ? ' ⚠ 기준 초과' : ''}`);
  const scrLines = ov.screens.slice(0, 10).map((s) => `${s.client === 'app' ? '앱' : '웹'} ${s.screen}: 첫 표시 p75 ${fmtMs(s.first?.p75 ?? null)} · 목록 표시 p75 ${fmtMs(s.list?.p75 ?? null)} · ${s.n}번`);
  const slowLines = ov.slowTop.map((s, i) => `${i + 1}. ${s.label} — p75 ${fmtMs(s.p75)} (기준 ${s.threshold / 1000}초${s.ratio > 1 ? ', 초과' : ''})`);
  const subject = `[워크인] 주간 속도 요약 ${ov.days[0].slice(5).replace('-', '/')}~${ov.days[ov.days.length - 1].slice(5).replace('-', '/')} — 느린 곳 ${ov.slowTop.filter((s) => s.ratio > 1).length}곳`;
  const text = [`지난 7일(${ov.days[0]}~${ov.days[ov.days.length - 1]}) 속도 요약입니다. 기준: API ${ov.thresholds.api / 1000}초 · 화면 ${ov.thresholds.screen / 1000}초 · p75 = 4번 중 3번은 이 시간 안.`, '',
    '■ 느린 곳 상위', ...(slowLines.length ? slowLines : ['없음']), '', '■ 핵심 API(30분마다 검침)', ...lines, '', '■ 실제 화면(웹·앱)', ...(scrLines.length ? scrLines : ['아직 기록 없음']), '',
    `■ 알림 ${ov.alerts.length}건`, ...ov.alerts.map((a) => `- ${a.title}`), '', `자세히: ${site}/platform?tab=speed`].join('\n');
  const html = `<div style="font-family:Pretendard,Apple SD Gothic Neo,sans-serif;font-size:14px;line-height:1.6;color:#1e293b"><p>${esc(text.split('\n')[0])}</p>
    <h3 style="font-size:15px;margin:14px 0 4px">느린 곳 상위</h3><ol style="margin:0;padding-left:18px">${ov.slowTop.map((s) => `<li>${esc(s.label)} — p75 <b>${fmtMs(s.p75)}</b>${s.ratio > 1 ? ' <span style="color:#b91c1c">기준 초과</span>' : ''}</li>`).join('') || '<li>없음</li>'}</ol>
    <h3 style="font-size:15px;margin:14px 0 4px">핵심 API(30분마다 검침)</h3><table style="border-collapse:collapse;font-size:13px"><tr><th align="left" style="padding:2px 8px 2px 0">곳</th><th align="right" style="padding:2px 8px">p75</th><th align="right" style="padding:2px 8px">최대</th><th align="right" style="padding:2px 8px">검침</th></tr>
    ${ov.targets.map((t) => `<tr><td style="padding:2px 8px 2px 0">${esc(t.label)}</td><td align="right" style="padding:2px 8px${(t.week?.p75 ?? 0) > ov.thresholds.api ? ';color:#b91c1c;font-weight:600' : ''}">${fmtMs(t.week?.p75 ?? null)}</td><td align="right" style="padding:2px 8px">${fmtMs(t.week?.max ?? null)}</td><td align="right" style="padding:2px 8px">${t.week?.n ?? 0}번${t.week?.bad ? ` · 오류 ${t.week.bad}` : ''}</td></tr>`).join('')}</table>
    <h3 style="font-size:15px;margin:14px 0 4px">실제 화면(웹·앱)</h3>${scrLines.length ? `<ul style="margin:0;padding-left:18px">${scrLines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p>아직 기록 없음</p>'}
    <h3 style="font-size:15px;margin:14px 0 4px">알림 ${ov.alerts.length}건</h3>${ov.alerts.length ? `<ul style="margin:0;padding-left:18px">${ov.alerts.map((a) => `<li>${esc(a.title)}</li>`).join('')}</ul>` : '<p>없음</p>'}
    <p style="margin-top:14px"><a href="${esc(site)}/platform?tab=speed">플랫폼 운영 › 속도에서 자세히</a></p></div>`;
  const { mailConfigured, sendMail } = await import('./mail');
  let mailed = 0;
  if (mailConfigured()) for (const p of people) { try { if ((await sendMail(p.email, subject, text, html)) === 'sent') mailed++; } catch (e) { const { logError } = await import('./log'); await logError('perf-weekly', e); } }
  const ids = await platformAdminIds(sql);
  if (ids.length) { const { notify } = await import('./notifications'); await notify(sql, { userIds: ids, type: 'perf_alert', title: subject.replace('[워크인] ', ''), body: slowLines.slice(0, 3).join('\n') || '기준을 넘은 곳이 없습니다', link: '/platform?tab=speed', actorId: null, dedupeKey: `perfweek:${week}`, push: false }); }
  await sql`update perf_weekly set recipients = ${mailed} where week = ${week}::date`;
  return { week, mailed, recipients: people.length };
}
