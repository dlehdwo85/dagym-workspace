// 수집기 등록·실행·일정(tick) — 대표 10/21 08:45 "수집기 12개 이식 최우선". 하루 한 번(KST 시각) tick 에서 한 개씩, 수동 [지금 수집] 은 관리자.
import { db } from '../../db';
import { isAdmin } from '../../access';
import { assertSpace } from '../../spaces';
import { forbidden, notFound } from '../../errors';
import { audit, logError } from '../../log';
import { tenantOf, type SessionUser } from '../../types';
import { CUSTOMER_COPY, INTERNAL_TENANT, collectorState, seesInternals } from '../../customerScope';
import { completeRun, mergeNoticeDuplicates, startRun } from './store';
import { collectorTodo, type CollectorTodo } from './todo';
import type { Collector, CollectorCtx, CollectorResult } from './types';
import { kaptBidNotices, kaptBidResults, kaptSaSun, operatingFromKapt } from './kapt';
import { g2bBidNotices, g2bPrespecAwards } from './g2b';
import { publicAgencyBids } from './publicAgency';
import { vendorRecruitWatch } from './vendorRecruit';
import { kicoxIndustrial, publicSports, rebRecent, touristHotels } from './facilities';
import { kaptNewComplexes } from './kaptComplexes';
import { kaptWeeklyComplexes } from './kaptWeekly';
import { bizinfoSupport, gov24Support, kstartupSupport, supportWatch } from './support';

/** 원본 12개 그대로(영업관리 FEATURES 4장 순서) + #450 지원사업 3개(하루 두 번). 실행 시각은 KST 시(時) — tick 이 그 시각 이후 하루 1회(againKst 가 있으면 그 시각(들) 이후 한 번씩 더) */
export const COLLECTORS: Collector[] = [kaptSaSun, operatingFromKapt, kicoxIndustrial, publicSports, touristHotels, kaptWeeklyComplexes /* 200차 신규 단지 1순위 */, rebRecent, kaptNewComplexes /* 186차 */, kaptBidNotices, g2bBidNotices, g2bPrespecAwards, kaptBidResults, publicAgencyBids, vendorRecruitWatch,
  bizinfoSupport, kstartupSupport, supportWatch, gov24Support];
export const SUPPORT_COLLECTORS = new Set(['bizinfo_support', 'kstartup_support', 'support_watch', 'gov24_support']);
export const BID_COLLECTORS = new Set(['kapt_bid_notices', 'g2b_bid_notices', 'g2b_prespec_awards', 'kapt_bid_results', 'public_agency_bids', 'vendor_recruit_watch']);
export const find = (slug: string) => COLLECTORS.find((c) => c.slug === slug) ?? null;
const SRC_KO: Record<string, string> = { kapt_bid: 'K-apt', g2b_bid: '나라장터', nuri_bid: '누리장터', g2b_prespec: '나라장터 사전규격', lh_bid: 'LH', lh_prespec: 'LH 사전규격', d2b_bid: '국방', onbid_lease: '온비드', vendor_recruit: '협력사 모집' };
const kstHour = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date())) % 24;
const kstDay = (d: Date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const kstHourOf = (d: Date) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(d)) % 24;
/** 하루 실행 시각들(KST 시) — hourKst + againKst(하나 또는 여러 개) */
export const hoursOf = (c: Pick<Collector, 'hourKst' | 'againKst'>) => [...new Set([c.hourKst, ...(c.againKst == null ? [] : Array.isArray(c.againKst) ? c.againKst : [c.againKst])])].sort((a, b) => a - b);
/** 오늘 돌 차례인가: 실행 시각이 지났고 오늘 아직 안 돌았거나, 지난 마지막 실행 시각(againKst) 뒤로 안 돌았으면 — #476 c: K-apt·나라장터 06·10·14·18시 */
export function isDue(c: Pick<Collector, 'hourKst' | 'againKst'>, lastRunAt: Date | null, hour: number, today: string) {
  const slots = hoursOf(c).filter((h) => h <= hour);
  if (!slots.length) return false;
  if (!lastRunAt || kstDay(lastRunAt) !== today) return true;
  return kstHourOf(lastRunAt) < slots[slots.length - 1];
}

/** 한 수집기 실행(실행 이력·공용 상태 갱신). 예산은 Vercel 60초 안 — 기본 45초 */
export async function runCollector(slug: string, trigger: 'cron' | 'manual', opt: { deadlineMs?: number; params?: Record<string, unknown>; fetchImpl?: typeof fetch } = {}) {
  const c = find(slug); if (!c) throw notFound('그런 수집기가 없습니다');
  const runId = await startRun(slug, trigger);
  const ctx: CollectorCtx = { fetchImpl: opt.fetchImpl ?? fetch, deadlineMs: opt.deadlineMs ?? 45000, params: opt.params, now: Date.now };
  let result: CollectorResult;
  try { result = await Promise.race([c.run(ctx), new Promise<CollectorResult>((_, rej) => setTimeout(() => rej(new Error('수집기 시간 초과')), ctx.deadlineMs + 8000))]); }
  catch (e) { const msg = e instanceof Error ? e.message : String(e); result = { inserted: 0, updated: 0, unchanged: 0, errors: 1, errorLog: msg, summary: `실행 중 예외: ${msg}`, providerMode: 'manual' }; await logError(`sales-collect:${slug}`, e).catch(() => {}); }
  // #507 후속: 공고 수집 뒤 같은 공고 여러 줄(원본 복사 + 워크인 수집)을 한 줄로 — 진행 기록·업무가 걸린 줄을 살림
  if (BID_COLLECTORS.has(slug)) {
    const m = await mergeNoticeDuplicates().catch(async (e) => { await logError('sales-notice-merge', e).catch(() => {}); return null; });
    const by = Object.entries(m?.byType ?? {}).map(([k, v]) => `${SRC_KO[k] ?? k} ${v}`).join('·');
    if (m?.hidden || m?.kept) result = { ...result, summary: `${result.summary ?? ''}${m.hidden ? ` · 같은 공고 ${m.hidden}줄 합침(${by})` : ''}${m.kept ? ` · 두 줄 모두 진행 기록·업무가 있어 그대로 둔 공고 ${m.kept}건` : ''}` };
  }
  const status = await completeRun(runId, slug, result);
  return { runId, slug, status, ...result };
}
/** tick: KST 실행 시각이 지났고 오늘 아직 안 돈 수집기 중 하나(순서대로)만 — 한 tick 에 하나(60초 한도) */
export async function collectorsTick(opt: { now?: Date } = {}) {
  const sql = db(); const now = opt.now ?? new Date(); const hour = kstHour(); const today = kstDay(now);
  const states = new Map((await sql<{ slug: string; enabled: boolean; last_run_at: Date | null }[]>`select slug, enabled, last_run_at from sales_collector_state`).map((r) => [r.slug, r]));
  const [anyTenant] = await sql<{ n: number }[]>`select count(*)::int as n from tenants where spaces @> array['sales']::text[]`;
  if (!anyTenant?.n) return { skipped: 'no sales tenant' };
  const due = COLLECTORS.find((c) => { const s = states.get(c.slug); if (s && !s.enabled) return false; return isDue(c, s?.last_run_at ? new Date(s.last_run_at) : null, hour, today); });
  if (!due) return { ran: null };
  const r = await runCollector(due.slug, 'cron');
  return { ran: due.slug, status: r.status, summary: r.summary };
}
/**
 * #522 누락 점검(로컬 10/24 '실패가 3일째 조용히 지나갔다'): 켜진 수집기마다(원천이 여럿이면 원천마다) 마지막 성공·연속 실패.
 * 마지막 성공이 25시간(하루 + 1시간 여유) 넘었거나 2회 연속 실패면 문제 → 영업 홈 빨간 띠 + 하루 한 번 관리자 알림. 한 번도 안 돈 수집기는 보지 않음.
 */
export type CollectorAlert = { slug: string; source: string | null; label: string; lastOkAt: string | null; failStreak: number; reason: string; error: string | null } & CollectorTodo;
export async function collectorAlerts(now = Date.now()): Promise<CollectorAlert[]> {
  const sql = db(); const LIMIT = 25 * 3600e3;
  const off = new Set((await sql<{ slug: string }[]>`select slug from sales_collector_state where not enabled`).map((r) => r.slug));
  type RunRow = { slug: string; status: string; started_at: Date; detail: any; error_log: string | null; summary: string | null };
  const runs = await sql<RunRow[]>`select slug, status, started_at, detail, error_log, summary from (
      select r.slug, r.status, r.started_at, r.detail, r.error_log, r.summary, row_number() over (partition by r.slug order by r.started_at desc) as n from sales_collector_runs r
      where r.status in ('success', 'partial', 'failed') and r.started_at > now() - interval '14 days') x where n <= 12 order by slug, started_at desc`;
  const by = new Map<string, RunRow[]>(); for (const r of runs) { if (!by.has(r.slug)) by.set(r.slug, []); by.get(r.slug)!.push(r); }
  const out: CollectorAlert[] = [];
  for (const c of COLLECTORS) {
    const rs = by.get(c.slug) ?? []; if (off.has(c.slug) || !rs.length) continue;
    const keys = [...new Set(rs.flatMap((r) => Object.keys(r.detail?.sources ?? {})))];
    const units = keys.length
      ? keys.map((k) => ({ source: k as string | null, label: keys.length > 1 ? `${c.label} › ${rs.find((r) => r.detail?.sources?.[k])!.detail.sources[k].label ?? k}` : c.label, ok: (r: RunRow) => (r.detail?.sources?.[k] ? !!r.detail.sources[k].ok : null), err: (r: RunRow) => (r.detail?.sources?.[k]?.error as string | undefined) ?? null }))
      : [{ source: null as string | null, label: c.label, ok: (r: RunRow) => r.status !== 'failed', err: (r: RunRow) => r.error_log }];
    for (const u of units) {
      let streak = 0, lastOk: Date | null = null, err: string | null = null, hint: string | null = null, oldest: Date | null = null;
      for (const r of rs) { const ok = u.ok(r); if (ok === null) continue; oldest = new Date(r.started_at); if (ok) { lastOk = oldest; break; } streak++; err ??= u.err(r); hint ??= [r.summary, r.error_log].filter(Boolean).join(' ') || null; }
      if (!oldest) continue;
      const stale = now - (lastOk ?? oldest).getTime() > LIMIT;
      if (streak >= 2 || stale) {
        const reason = streak >= 2 ? `${streak}회 연속 실패` : lastOk ? `마지막 성공 ${Math.floor((now - lastOk.getTime()) / 3600e3)}시간 전` : '최근 성공 없음';
        const error = err?.split('\n')[0].slice(0, 160) ?? null;
        // #629: 첫 줄은 '할 일' 문장(todo) — 오류 원문·영문 코드·HTTP 코드는 error 로 따로(화면에서 접힘 '자세히'). 서비스 번호는 원문에 없으면 실행 요약·오류 기록(hint)에서
        out.push({ slug: c.slug, source: u.source, label: u.label, lastOkAt: lastOk?.toISOString() ?? null, failStreak: streak, error, reason, ...collectorTodo({ slug: c.slug, source: u.source, error, hint, reason }) });
      }
    }
  }
  return out;
}
/** 하루 한 번(09시 뒤) 문제 원천을 영업 공간 회사의 관리자 + 플랫폼 운영자에게(같은 날 다시 안 보냄) */
export async function collectorAlertTick(now = new Date()) {
  if (kstHourOf(now) < 9) return { skipped: 'before 09 KST' };
  const alerts = await collectorAlerts(now.getTime()); if (!alerts.length) return { alerts: 0 };
  const sql = db(); const day = kstDay(now);
  const { superAdmin } = await import('../../superAdmin'); // 142차 후속: 플랫폼 운영자 쪽은 슈퍼관리자만
  const people = (await sql<{ id: string; email: string; tenant: string; pa: boolean; mine: boolean }[]>`select u.id, u.email, u.tenant, coalesce(u.platform_admin, false) as pa, (t.spaces @> array['sales']::text[] and u.role in ('owner', 'admin')) as mine
    from users u join tenants t on t.id = u.tenant where u.status = 'active' and not coalesce(u.is_demo, false)
      and ((t.spaces @> array['sales']::text[] and u.role in ('owner', 'admin')) or coalesce(u.platform_admin, false))`).filter((p) => p.mine || superAdmin(p.email, p.pa));
  if (!people.length) return { alerts: alerts.length, notified: 0 };
  const title = `영업 DB 수집 누락 위험 ${alerts.length}곳 — ${alerts.slice(0, 2).map((a) => a.label).join(' · ')}${alerts.length > 2 ? ' 외' : ''}`;
  const body = alerts.slice(0, 6).map((a) => `${a.label} — ${a.todo} (${a.reason})`).join('\n'); // #629: 알림도 '할 일' 문장 — 원문·영문 코드는 화면의 '자세히'에서
  const { notify } = await import('../../notifications');
  // #602: 원천 이름·HTTP 코드·연속 실패 수는 슈퍼관리자·내부 테넌트에게만. 고객사 관리자에게는 '오늘 새 공고를 받지 못했습니다' 한 줄
  const seesAll = (p: { email: string; pa: boolean; tenant: string }) => superAdmin(p.email, p.pa) || p.tenant === INTERNAL_TENANT;
  const ins = people.filter(seesAll), cust = people.filter((p) => !seesAll(p));
  const common = { type: 'sales_collector_alert', link: '/s/sales/sources#collectors', entityType: 'sales_collector', actorId: null, dedupeKey: `salescol:${day}`, space: 'sales' } as const;
  const sent = [
    ...(ins.length ? await notify(sql, { ...common, userIds: ins.map((p) => p.id), title, body }) : []),
    ...(cust.length ? await notify(sql, { ...common, userIds: cust.map((p) => p.id), title: '오늘 새 공고를 받지 못했습니다', body: CUSTOMER_COPY.todayMissed }) : []),
  ];
  return { alerts: alerts.length, notified: sent.length };
}
/** 회사 화면: 수집기 목록(상태·마지막 실행·회사 켜기)·최근 실행 20건·필요 env 존재 여부(값은 안 보여줌)
 *  #602(대표 10/25): 고객사(슈퍼관리자·내부 테넌트 아님)에게는 연결 상태 3가지(연결됨 / 신청 필요 / 연결 안 됨)·연결 방법·'받았습니다 n건'만 —
 *  키 이름·원천 주소·오류 원인·원천별 상세·공용 실행 기록은 서버가 아예 내려보내지 않는다(docs/handoff/SUPER_ADMIN_SCOPE_2026-10-25.md §2) */
export async function collectorsView(u: SessionUser) {
  await assertSpace(u, 'sales'); const sql = db(); const t = tenantOf(u); const full = seesInternals(u);
  const states = new Map((await sql<any[]>`select slug, enabled, last_run_at, last_status from sales_collector_state`).map((r) => [r.slug, r]));
  const mine = new Map((await sql<{ slug: string; enabled: boolean }[]>`select slug, enabled from sales_collector_settings where tenant = ${t}`).map((r) => [r.slug, r.enabled]));
  const last = new Map((await sql<any[]>`select distinct on (slug) slug, started_at, finished_at, status, inserted, updated, unchanged, errors, summary, error_log, detail from sales_collector_runs order by slug, started_at desc`).map((r) => [r.slug, r]));
  const env = (k: string) => !!process.env[k.replace(/\(.*\)$/, '')];
  const counts = Object.fromEntries((await sql<{ st: string; n: number }[]>`select row->>'source_type' as st, count(*)::int as n from sales_src_rows where tbl = 'procurement_notices' and scope = 'global' and not gone group by 1`).map((r) => [r.st, r.n]));
  const runs = await sql<any[]>`select id, slug, trigger, started_at, finished_at, status, inserted, updated, unchanged, errors, summary, error_log from sales_collector_runs order by started_at desc limit 30`;
  const ready = new Map(await Promise.all(COLLECTORS.filter((c) => c.keyReady).map(async (c) => [c.slug, await c.keyReady!().catch(() => false)] as const))); // 플랫폼 운영에 넣은 키도 '있음'
  const alerts = await collectorAlerts().catch(() => []);
  const collectors = COLLECTORS.map((c) => {
    const needs = (c.needs ?? []).map((k) => ({ key: k, present: env(k) || !!ready.get(c.slug) })); const st = states.get(c.slug); const l = last.get(c.slug) ?? null;
    const base = { slug: c.slug, label: c.label, hourKst: c.hourKst, againKst: c.againKst ?? null, hours: hoursOf(c), bid: BID_COLLECTORS.has(c.slug), support: SUPPORT_COLLECTORS.has(c.slug), globalEnabled: st?.enabled ?? true, enabled: mine.get(c.slug) ?? true, lastRunAt: st?.last_run_at ?? null, lastStatus: st?.last_status ?? null };
    if (full) return { ...base, source: c.source as string | null, needs, last: l, state: null as ReturnType<typeof collectorState> | null, how: null as string | null };
    const missing = needs.filter((n) => !n.present && !/선택/.test(n.key)).length;
    const state = collectorState({ globalEnabled: base.globalEnabled, missingKeys: missing, lastStatus: base.lastStatus });
    return { ...base, source: null, needs: [] as typeof needs, state, how: state === 'apply_needed' ? (/watch/.test(c.slug) ? CUSTOMER_COPY.howWatch : CUSTOMER_COPY.howPublicData) : null, last: l ? customerRun(l) : null };
  });
  return { full, canEdit: isAdmin(u), platformAdmin: !!u.platformAdmin, counts, alerts: full ? alerts : alerts.map((a) => ({ ...a, reason: CUSTOMER_COPY.todayMissed, error: null, todo: CUSTOMER_COPY.todayMissed, action: 'check' as const, service: null, link: null })), collectors, runs: full ? runs : [] };
}
/** #602 고객용 실행 결과 한 줄: '받았습니다 n건' 또는 '못 받았습니다' — 오류 원문·원천별 상세·보낸 주소는 빠짐 */
function customerRun(r: { status: string; started_at: Date; finished_at: Date | null; inserted: number; updated: number; unchanged: number }) {
  const got = (r.inserted ?? 0) + (r.updated ?? 0) + (r.unchanged ?? 0);
  return { status: r.status, started_at: r.started_at, finished_at: r.finished_at, inserted: r.inserted, updated: r.updated, unchanged: r.unchanged, errors: 0, summary: r.status === 'failed' ? CUSTOMER_COPY.notReceived : CUSTOMER_COPY.received(got), error_log: null, detail: null };
}
export async function setCollectorEnabled(u: SessionUser, slug: string, enabled: boolean, scope: 'tenant' | 'global' = 'tenant') {
  await assertSpace(u, 'sales'); if (!isAdmin(u)) throw forbidden('관리자만'); if (!find(slug)) throw notFound('그런 수집기가 없습니다');
  const sql = db();
  if (scope === 'global') { if (!u.platformAdmin) throw forbidden('플랫폼 운영자만'); await sql`insert into sales_collector_state (slug, enabled) values (${slug}, ${enabled}) on conflict (slug) do update set enabled = excluded.enabled, updated_at = now()`; }
  else await sql`insert into sales_collector_settings (tenant, slug, enabled) values (${tenantOf(u)}, ${slug}, ${enabled}) on conflict (tenant, slug) do update set enabled = excluded.enabled, updated_at = now()`;
  await audit(sql, u.id, 'sales_collector.toggle', 'tenant', null, { slug, enabled, scope }).catch(() => {});
  return { slug, enabled, scope };
}
export async function runCollectorManual(u: SessionUser, slug: string) {
  await assertSpace(u, 'sales'); if (!isAdmin(u)) throw forbidden('지금 수집은 관리자만');
  if (!find(slug)) throw notFound('그런 수집기가 없습니다');
  const [running] = await db()<{ id: number }[]>`select id from sales_collector_runs where slug = ${slug} and status = 'running' and started_at > now() - interval '3 minutes'`;
  if (running) throw forbidden('이미 실행 중입니다 — 잠시 뒤 다시');
  const r = await runCollector(slug, 'manual', { deadlineMs: 40000 });
  await audit(db(), u.id, 'sales_collector.run', 'tenant', null, { slug, status: r.status }).catch(() => {});
  if (seesInternals(u)) return r;
  // #602 고객사: 결과는 '받았습니다 n건 / 못 받았습니다 — 연결을 확인해 주세요'만(오류 원문·원천별 상세 없음)
  return { runId: r.runId, slug: r.slug, status: r.status, inserted: r.inserted, updated: r.updated, unchanged: r.unchanged, errors: 0, summary: r.status === 'failed' ? CUSTOMER_COPY.notReceived : CUSTOMER_COPY.received(r.inserted + r.updated + r.unchanged) };
}
