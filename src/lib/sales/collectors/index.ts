// 수집기 등록·실행·일정(tick) — 대표 10/21 08:45 "수집기 12개 이식 최우선". 하루 한 번(KST 시각) tick 에서 한 개씩, 수동 [지금 수집] 은 관리자.
import { db } from '../../db';
import { isAdmin } from '../../access';
import { assertSpace } from '../../spaces';
import { forbidden, notFound } from '../../errors';
import { audit, logError } from '../../log';
import { tenantOf, type SessionUser } from '../../types';
import { completeRun, startRun } from './store';
import type { Collector, CollectorCtx, CollectorResult } from './types';
import { kaptBidNotices, kaptBidResults, kaptSaSun, operatingFromKapt } from './kapt';
import { g2bBidNotices, g2bPrespecAwards } from './g2b';
import { publicAgencyBids } from './publicAgency';
import { vendorRecruitWatch } from './vendorRecruit';
import { kicoxIndustrial, publicSports, rebRecent, touristHotels } from './facilities';

/** 원본 12개 그대로(영업관리 FEATURES 4장 순서). 실행 시각은 KST 시(時) — tick 이 그 시각 이후 하루 1회 */
export const COLLECTORS: Collector[] = [kaptSaSun, operatingFromKapt, kicoxIndustrial, publicSports, touristHotels, rebRecent, kaptBidNotices, g2bBidNotices, g2bPrespecAwards, kaptBidResults, publicAgencyBids, vendorRecruitWatch];
export const BID_COLLECTORS = new Set(['kapt_bid_notices', 'g2b_bid_notices', 'g2b_prespec_awards', 'kapt_bid_results', 'public_agency_bids', 'vendor_recruit_watch']);
export const find = (slug: string) => COLLECTORS.find((c) => c.slug === slug) ?? null;
const kstHour = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date())) % 24;
const kstDay = (d: Date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);

/** 한 수집기 실행(실행 이력·공용 상태 갱신). 예산은 Vercel 60초 안 — 기본 45초 */
export async function runCollector(slug: string, trigger: 'cron' | 'manual', opt: { deadlineMs?: number; params?: Record<string, unknown>; fetchImpl?: typeof fetch } = {}) {
  const c = find(slug); if (!c) throw notFound('그런 수집기가 없습니다');
  const runId = await startRun(slug, trigger);
  const ctx: CollectorCtx = { fetchImpl: opt.fetchImpl ?? fetch, deadlineMs: opt.deadlineMs ?? 45000, params: opt.params, now: Date.now };
  let result: CollectorResult;
  try { result = await Promise.race([c.run(ctx), new Promise<CollectorResult>((_, rej) => setTimeout(() => rej(new Error('수집기 시간 초과')), ctx.deadlineMs + 8000))]); }
  catch (e) { const msg = e instanceof Error ? e.message : String(e); result = { inserted: 0, updated: 0, unchanged: 0, errors: 1, errorLog: msg, summary: `실행 중 예외: ${msg}`, providerMode: 'manual' }; await logError(`sales-collect:${slug}`, e).catch(() => {}); }
  const status = await completeRun(runId, slug, result);
  return { runId, slug, status, ...result };
}
/** tick: KST 실행 시각이 지났고 오늘 아직 안 돈 수집기 중 하나(순서대로)만 — 한 tick 에 하나(60초 한도) */
export async function collectorsTick(opt: { now?: Date } = {}) {
  const sql = db(); const now = opt.now ?? new Date(); const hour = kstHour(); const today = kstDay(now);
  const states = new Map((await sql<{ slug: string; enabled: boolean; last_run_at: Date | null }[]>`select slug, enabled, last_run_at from sales_collector_state`).map((r) => [r.slug, r]));
  const [anyTenant] = await sql<{ n: number }[]>`select count(*)::int as n from tenants where spaces @> array['sales']::text[]`;
  if (!anyTenant?.n) return { skipped: 'no sales tenant' };
  const due = COLLECTORS.find((c) => { const s = states.get(c.slug); if (s && !s.enabled) return false; if (hour < c.hourKst) return false; const last = s?.last_run_at ? kstDay(new Date(s.last_run_at)) : null; return last !== today; });
  if (!due) return { ran: null };
  const r = await runCollector(due.slug, 'cron');
  return { ran: due.slug, status: r.status, summary: r.summary };
}
/** 회사 화면: 수집기 목록(상태·마지막 실행·회사 켜기)·최근 실행 20건·필요 env 존재 여부(값은 안 보여줌) */
export async function collectorsView(u: SessionUser) {
  await assertSpace(u, 'sales'); const sql = db(); const t = tenantOf(u);
  const states = new Map((await sql<any[]>`select slug, enabled, last_run_at, last_status from sales_collector_state`).map((r) => [r.slug, r]));
  const mine = new Map((await sql<{ slug: string; enabled: boolean }[]>`select slug, enabled from sales_collector_settings where tenant = ${t}`).map((r) => [r.slug, r.enabled]));
  const last = new Map((await sql<any[]>`select distinct on (slug) slug, started_at, finished_at, status, inserted, updated, unchanged, errors, summary, error_log from sales_collector_runs order by slug, started_at desc`).map((r) => [r.slug, r]));
  const env = (k: string) => !!process.env[k.replace(/\(.*\)$/, '')];
  const counts = Object.fromEntries((await sql<{ st: string; n: number }[]>`select row->>'source_type' as st, count(*)::int as n from sales_src_rows where tbl = 'procurement_notices' and scope = 'global' and not gone group by 1`).map((r) => [r.st, r.n]));
  const runs = await sql<any[]>`select id, slug, trigger, started_at, finished_at, status, inserted, updated, unchanged, errors, summary, error_log from sales_collector_runs order by started_at desc limit 30`;
  return { canEdit: isAdmin(u), platformAdmin: !!u.platformAdmin, counts,
    collectors: COLLECTORS.map((c) => ({ slug: c.slug, label: c.label, hourKst: c.hourKst, source: c.source, bid: BID_COLLECTORS.has(c.slug), needs: (c.needs ?? []).map((k) => ({ key: k, present: env(k) })), globalEnabled: states.get(c.slug)?.enabled ?? true, enabled: mine.get(c.slug) ?? true, lastRunAt: states.get(c.slug)?.last_run_at ?? null, lastStatus: states.get(c.slug)?.last_status ?? null, last: last.get(c.slug) ?? null })), runs };
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
  return r;
}
