// #161 V25 매출 자료 자동 분석 (2026-10-15 대표 지시: "자료실에 매출 자료가 올라갈 때마다 관리 > 매출에 매출 분석·동향·향후 대안을 분석해서 관리자들이 확인할 수 있게")
// 흐름: 자료실 업로드 → 매출 자료 감지 → 숫자 읽기(가벼운 모델) → '확인 대기' → 매출 권한자 [확정] → 같은 달 10분 모아 1번 분석 → 보고서·알림.
// 숫자 계산(증감률·이동평균·추세·전망 범위)은 서버가 먼저 하고 AI 는 해석·문장만. 확정 전에는 실적(revenue_entries)에 반영하지 않는다.
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db, type Sql } from './db';
import { HttpError, badRequest, notFound } from './errors';
import { audit, logError } from './log';
import { tenantOf, type SessionUser } from './types';
import { aiConfigured, collectItems, extractRows, requireRevenue, upsertPartial, type ExtractRow } from './revenue';

/** 시험 서버는 REVENUE_AUTO=0(다른 시험의 가짜 AI 응답 순서를 흔들지 않게) — 자동 분석 시험만 켠다 */
export const autoOn = () => process.env.REVENUE_AUTO !== '0';
const BATCH_MINUTES = 10; // 같은 달 자료는 10분 모아 1번 분석(enqueue 의 interval 과 같게)
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

// ---------------- 감지 ----------------
const DOC_EXT = /\.(xlsx|xls|csv|pdf|png|jpe?g|webp|hwp|hwpx|docx)$/i;
const DOC_MIME = /^(image\/(png|jpe?g|webp)|application\/pdf|text\/csv|application\/vnd\.(ms-excel|openxmlformats-officedocument\.(spreadsheetml|wordprocessingml))|application\/(x-hwp|haansofthwp|hwp\+zip))/;
export const REVENUE_WORDS = /매출|정산|실적|손익|월\s*결산|영업\s*보고|매입\s*매출|sales|revenue/i;
const MONTH_IN = /20\d{2}\s*[-./년]\s*(0?[1-9]|1[0-2])|(^|[^\d])(0?[1-9]|1[0-2])\s*월/;
const AMOUNTS = /\d{1,3}(?:,\d{3})+|\d{5,}/g;

/** 매출 자료인가: 폴더(매출 근거·정산…) → 파일 이름·제목·태그 → 본문(매출·정산 + 월 + 금액 3개 이상). 엑셀·CSV·PDF·사진·한글만 */
export function detectRevenueDoc(f: { folder?: string | null; title?: string | null; file_name: string; mime_type?: string | null; tags?: string[] | null; text_content?: string | null }) {
  if (!DOC_EXT.test(f.file_name) && !DOC_MIME.test(f.mime_type ?? '')) return null;
  if (REVENUE_WORDS.test(f.folder ?? '')) return 'folder' as const;
  if (REVENUE_WORDS.test(`${f.file_name} ${f.title ?? ''} ${(f.tags ?? []).join(' ')}`)) return 'name' as const;
  const t = String(f.text_content ?? '').slice(0, 20000);
  if (/매출|정산/.test(t) && MONTH_IN.test(t) && (t.match(AMOUNTS)?.length ?? 0) >= 3) return 'content' as const;
  return null;
}

/** 매출 권한자(대표·본부장 등 메뉴 권한 '매출'이 view/edit 인 사람) — 알림 받는 사람·확정할 사람 */
export async function revenueManagers(sql: Sql, tenant: string, need: 'view' | 'edit' = 'view') {
  const { menuLevel, RANK } = await import('./menuPerms');
  const rows = await sql<{ id: string; role: string; tenant: string; kind: string }[]>`select u.id, u.role, u.tenant, t.kind from users u join tenants t on t.id = u.tenant
    where u.tenant = ${tenant} and u.status = 'active' and not u.is_demo and t.status = 'active'`;
  const out: string[] = [];
  for (const r of rows) {
    const su = { id: r.id, role: r.role, tenant: r.tenant, isDemo: false, personal: r.kind === 'personal' } as SessionUser;
    if (RANK[await menuLevel(su, 'revenue', sql)] >= RANK[need]) out.push(r.id);
  }
  return out;
}

async function actorFor(userId: string): Promise<SessionUser> {
  const [r] = await db()<any[]>`select u.id, u.email, u.name, u.role, u.status, u.timezone, u.is_demo, u.platform_admin, u.tenant, t.kind from users u join tenants t on t.id = u.tenant
    where u.id = ${userId} and u.status = 'active' and t.status = 'active'`;
  if (!r) throw new HttpError(409, 'uploader_gone', '올린 사람 계정을 쓸 수 없어 파일을 읽지 못했습니다 — 매출 화면 [자료로 입력(AI)]으로 다시 올려 주세요');
  return { id: r.id, email: r.email, name: r.name, role: r.role, status: r.status, timezone: r.timezone, sessionId: '', isDemo: r.is_demo, platformAdmin: r.platform_admin, tenant: r.tenant, personal: r.kind === 'personal' } as SessionUser;
}

/** 회사 시스템 작업(올린 사람 개인 한도가 아니라 회사 한도에 합산): 크레딧 차단·회사 요청 수·회사 월 한도 */
async function assertSystemAi(tenant: string) {
  await (await import('./ai/guard')).assertAiCredit();
  const Pl = await import('./plans');
  const { limits } = await Pl.effectiveLimits(tenant);
  if (limits.aiRequests !== null && (await Pl.currentUsage(tenant)).aiRequests >= limits.aiRequests) throw new HttpError(429, 'ai_quota', `이번 달 회사 AI 요청 ${limits.aiRequests}회를 모두 써 매출 자동 분석을 멈췄습니다 — 다음 달에 다시 하거나 [다시 읽기]를 눌러 주세요`);
  const co = await (await import('./ai/assistant')).usageThisMonth(tenant);
  if (co.limitUsd > 0 && co.costUsd >= co.limitUsd) throw new HttpError(429, 'ai_quota', `이번 달 회사 AI 한도에 닿아 매출 자동 분석을 멈췄습니다 — 관리 → 사용량·요금제에서 확인하세요`);
}

/** 자료실 올리기 완료 직후(라우트 after) — 매출 자료면 확인 대기 1건을 만들고 바로 숫자를 읽는다. 매출 화면 [자료로 입력(AI)]·AI 첨부·생성 파일은 제외 */
export async function onLibraryReady(u: SessionUser, fileId: string) {
  if (!autoOn() || u.isDemo || !aiConfigured()) return null;
  const sql = db();
  const t = tenantOf(u);
  const [f] = await sql<any[]>`select id, folder, title, file_name, mime_type, tags, text_content, source, upload_status from library_files where id = ${fileId} and tenant = ${t} and deleted_at is null`;
  if (!f || f.source !== 'upload' || f.upload_status !== 'ready') return null;
  const by = detectRevenueDoc(f);
  if (!by) return null;
  const [site] = await sql`select 1 from org_units where tenant = ${t} and active and type in ('branch', 'site') limit 1`;
  if (!site || !(await revenueManagers(sql, t, 'edit')).length) return null; // 받을 현장·확정할 사람이 없으면 하지 않음
  const [imp] = await sql<{ id: string }[]>`insert into revenue_imports (tenant, file_id, file_name, detected_by, created_by) values (${t}, ${fileId}, ${f.file_name}, ${by}, ${u.id})
    on conflict (file_id) where file_id is not null do nothing returning id`;
  if (!imp) return null;
  await processImport(imp.id);
  return imp.id;
}

/** 숫자 읽기: 올린 사람 권한으로 파일을 읽고(그 사람이 볼 수 있는 파일만), 사용량은 회사 시스템 작업으로 기록. 실패하면 10분 뒤 다시(최대 3번) */
export async function processImport(id: string) {
  const sql = db();
  const [imp] = await sql<any[]>`update revenue_imports set status = 'extracting', attempts = attempts + 1, locked_until = now() + interval '5 minutes', error = null, updated_at = now()
    where id = ${id} and status in ('queued', 'extracting') and (locked_until is null or locked_until < now()) and attempts < 3 returning *`;
  if (!imp) return null;
  try {
    if (!imp.file_id || !imp.created_by) throw new HttpError(409, 'file_gone', '근거 파일이나 올린 사람을 찾을 수 없습니다');
    const actor = await actorFor(imp.created_by);
    await assertSystemAi(imp.tenant);
    const x = await extractRows(actor, [imp.file_id], { purpose: 'revenue_auto_extract', usageUserId: null });
    const status = x.rows.length ? 'pending' : 'empty';
    await sql`update revenue_imports set status = ${status}, rows = ${sql.json(x.rows as never)}, notes = ${x.notes || null}, locked_until = null, updated_at = now() where id = ${id}`;
    if (status === 'pending') {
      const { notify } = await import('./notifications');
      await notify(sql, { userIds: await revenueManagers(sql, imp.tenant, 'edit'), type: 'revenue', title: `새 매출 자료 — 숫자 확인: ${imp.file_name}`.slice(0, 120),
        body: `AI 가 숫자 ${x.rows.length}개를 읽었습니다. [확정]해야 실적에 반영되고 분석(동향·전망·대안)이 시작됩니다.`, link: '/revenue#imports',
        entityType: 'revenue_import', entityId: id, dedupeKey: `revimp:${id}` });
    }
    return { status, rows: x.rows.length };
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 300);
    const final = imp.attempts >= 3 || (e instanceof HttpError && e.status < 500); // 한도·권한·파일 없음은 다시 해도 같음
    await sql`update revenue_imports set status = ${final ? 'failed' : 'queued'}, error = ${msg}, locked_until = ${final ? null : sql`now() + interval '10 minutes'`}, updated_at = now() where id = ${id}`;
    if (!(e instanceof HttpError)) await logError('revenue:import', e, { id });
    return { status: final ? 'failed' : 'queued', error: msg };
  }
}

// ---------------- 서버 계산(숫자는 여기서만) ----------------
export type MonthRow = { site: string; month: string; revenue: number; expense: number; members: number | null; target: number | null };
export const addMonth = (p: string, k: number) => { const [y, m] = p.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + k, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const r1 = (x: number) => Math.round(x * 10) / 10;
/** 증감률 = (이번 - 비교) ÷ 비교 × 100, 소수 1자리. 비교 값이 없거나 0 이면 null */
export const pctChange = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null || b <= 0 ? null : r1(((a - b) / b) * 100));
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** 한 줄(현장 또는 전체)의 월별 매출 → 전월·전년 동월·3개월 이동평균·6개월 추세·변동폭·다음 3개월 전망 범위 */
export function seriesStats(byMonth: Map<string, number>, period: string) {
  const v = (k: number) => byMonth.get(addMonth(period, k)) ?? null;
  const cur = v(0), prev = v(-1), lastYear = v(-12);
  const win = (ks: number[]) => ks.map(v).filter((x): x is number => x !== null);
  const l3 = win([-2, -1, 0]), p3 = win([-3, -2, -1]);
  const ma3 = l3.length >= 2 ? Math.round(avg(l3)) : null; // 이번 달 포함 최근 3개월 중 있는 달(2개월 이상) 평균
  const ma3Prev = p3.length >= 2 ? Math.round(avg(p3)) : null;
  const pts = [-5, -4, -3, -2, -1, 0].flatMap((k) => { const y = v(k); return y === null ? [] : [[k, y] as const]; });
  let trend: number | null = null; // 최근 6개월 선형 회귀 기울기 ÷ 평균 = 월 평균 변화율(%)
  if (pts.length >= 3) {
    const mx = avg(pts.map(([x]) => x)), my = avg(pts.map(([, y]) => y));
    const sxx = pts.reduce((a, [x]) => a + (x - mx) ** 2, 0), sxy = pts.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0);
    trend = my > 0 && sxx > 0 ? r1((sxy / sxx / my) * 100) : null;
  }
  const ch: number[] = []; // 최근 6개월 연속 두 달 증감률
  for (let k = -5; k <= 0; k++) { const a = v(k), b = v(k - 1); if (a !== null && b !== null && b > 0) ch.push((a - b) / b); }
  const sd = ch.length >= 2 ? Math.sqrt(avg(ch.map((x) => (x - avg(ch)) ** 2))) : null;
  const vol = Math.min(0.4, Math.max(0.05, sd ?? 0.1));
  const g = Math.max(-0.2, Math.min(0.2, (trend ?? 0) / 100));
  // 전망(추정): 3개월 평균(가운데 = 전월) × (1 + 추세)^(k+1), 범위 = ± 변동폭 × √k
  const forecast = ma3 === null || l3.length < 3 ? [] : [1, 2, 3].map((k) => {
    const base = ma3 * (1 + g) ** (k + 1), w = vol * Math.sqrt(k);
    return { month: addMonth(period, k), low: Math.max(0, Math.round(base * (1 - w))), base: Math.round(base), high: Math.round(base * (1 + w)) };
  });
  return { revenue: cur, prev, mom: pctChange(cur, prev), lastYear, yoy: pctChange(cur, lastYear), ma3, ma3Prev, ma3Change: pctChange(ma3, ma3Prev), trend, vol: r1(vol * 100), forecast };
}

export const STATS_METHOD = '증감률 = (이번 달 − 비교 달) ÷ 비교 달 × 100 · 3개월 이동평균 = 이번 달 포함 최근 3개월 중 있는 달 평균 · 추세 = 최근 6개월 선형 회귀 기울기 ÷ 평균(월 %) · ' +
  '전망(추정) = 3개월 평균 × (1+추세)^(k+1), 범위 ± 변동폭(최근 6개월 증감률의 표준편차, 5~40%) × √k';

/** 보고서 숫자 전부(서버 계산). AI 는 이 값을 인용만 한다 */
export function revenueStats(rows: MonthRow[], period: string) {
  const sites = [...new Set(rows.map((r) => r.site))].sort((a, b) => a.localeCompare(b, 'ko'));
  const at = (site: string, m: string) => rows.find((r) => r.site === site && r.month === m) ?? null;
  const months12 = Array.from({ length: 12 }, (_, i) => addMonth(period, i - 11));
  const extra = (rev: number | null, exp: number | null, members: number | null, target: number | null) => ({
    expense: exp, profit: rev !== null && exp !== null ? rev - exp : null, margin: rev && exp !== null ? r1(((rev - exp) / rev) * 100) : null,
    members, perMember: rev !== null && members ? Math.round(rev / members) : null, target, achieve: rev !== null && target ? r1((rev / target) * 100) : null,
  });
  const siteStats = sites.map((site) => {
    const mine = rows.filter((r) => r.site === site);
    const s = seriesStats(new Map(mine.map((r) => [r.month, r.revenue])), period);
    const c = at(site, period);
    return { site, ...s, ...extra(c?.revenue ?? null, c?.expense ?? null, c?.members ?? null, c?.target ?? null), series: months12.map((m) => ({ month: m, revenue: at(site, m)?.revenue ?? null })) };
  });
  const totalBy = new Map<string, number>();
  for (const r of rows) totalBy.set(r.month, (totalBy.get(r.month) ?? 0) + r.revenue);
  const cur = rows.filter((r) => r.month === period);
  const sum = (f: (r: MonthRow) => number | null) => (cur.length ? cur.reduce((a, r) => a + (f(r) ?? 0), 0) : null);
  const tgt = cur.filter((r) => r.target); const mem = cur.filter((r) => r.members);
  const total = { ...seriesStats(totalBy, period), ...extra(sum((r) => r.revenue), sum((r) => r.expense), mem.length ? mem.reduce((a, r) => a + (r.members ?? 0), 0) : null, tgt.length ? tgt.reduce((a, r) => a + (r.target ?? 0), 0) : null),
    series: months12.map((m) => ({ month: m, revenue: totalBy.get(m) ?? null })) };
  if (tgt.length) total.achieve = r1((tgt.reduce((a, r) => a + r.revenue, 0) / (total.target ?? 1)) * 100); // 목표를 넣은 현장끼리만 비교
  const ranked = siteStats.filter((s) => s.mom !== null).sort((a, b) => b.mom! - a.mom!);
  const ranking = { up: ranked.filter((s) => s.mom! > 0).slice(0, 3).map((s) => ({ site: s.site, mom: s.mom })), down: ranked.filter((s) => s.mom! < 0).reverse().slice(0, 3).map((s) => ({ site: s.site, mom: s.mom })) };
  const flags: { site: string; month: string; metric: 'revenue' | 'expense'; basis: 'mom' | 'yoy'; change: number }[] = [];
  for (const s of siteStats) {
    if (s.mom !== null && Math.abs(s.mom) >= 30) flags.push({ site: s.site, month: period, metric: 'revenue', basis: 'mom', change: s.mom });
    if (s.yoy !== null && Math.abs(s.yoy) >= 30) flags.push({ site: s.site, month: period, metric: 'revenue', basis: 'yoy', change: s.yoy });
    const e0 = at(s.site, period)?.expense, e1 = at(s.site, addMonth(period, -1))?.expense;
    const em = pctChange(e0, e1);
    if (em !== null && Math.abs(em) >= 30) flags.push({ site: s.site, month: period, metric: 'expense', basis: 'mom', change: em });
  }
  // 확인 필요(서버): 이번 달 빠진 현장(최근 3개월엔 있음) · 0원 · 최근 12개월 중간에 빈 달
  const checks: string[] = [];
  for (const site of sites) {
    const has = (m: string) => !!at(site, m);
    if (!has(period) && [1, 2, 3].some((k) => has(addMonth(period, -k)))) checks.push(`${site} ${period} 자료가 없습니다(직전 달까지는 있음)`);
    const c = at(site, period);
    if (c && c.revenue === 0) checks.push(`${site} ${period} 매출이 0원입니다`);
    const got = months12.filter(has);
    if (got.length) { const gaps = months12.slice(months12.indexOf(got[0])).filter((m) => !has(m) && m < got[got.length - 1]); if (gaps.length) checks.push(`${site} 빈 달: ${gaps.join(', ')}`); }
  }
  return { period, method: STATS_METHOD, total, sites: siteStats, ranking, flags, checks: checks.slice(0, 20) };
}
export type RevenueStats = ReturnType<typeof revenueStats>;

/** AI 에 보낼 값: 최근 24개월 현장별 월 집계(현장 이름·월·매출·지출·회원 수·목표)와 서버 계산값만 — 메모·파일 이름·개인정보 없음 */
async function analysisInput(sql: Sql, tenant: string, period: string) {
  const rows = await sql<MonthRow[]>`select o.name as site, to_char(r.month, 'YYYY-MM') as month, r.revenue::float8 as revenue, r.expense::float8 as expense, r.members, r.target::float8 as target
    from revenue_entries r join org_units o on o.id = r.org_unit_id
    where o.tenant = ${tenant} and not o.is_demo and r.month >= ${addMonth(period, -23) + '-01'} and r.month <= ${period + '-01'} order by o.name, r.month`;
  return rows.map((r) => ({ site: r.site, month: r.month, revenue: Number(r.revenue), expense: Number(r.expense), members: r.members === null ? null : Number(r.members), target: r.target === null ? null : Number(r.target) }));
}
const brief = (s: ReturnType<typeof seriesStats> & Record<string, unknown>) => ({ revenue: s.revenue, prev: s.prev, mom: s.mom, lastYear: s.lastYear, yoy: s.yoy, ma3: s.ma3, ma3Change: s.ma3Change, trend: s.trend, forecast: s.forecast,
  margin: s.margin ?? null, perMember: s.perMember ?? null, achieve: s.achieve ?? null });

const AI_SYSTEM = `당신은 한국 회사 본사의 매출 분석 보조입니다(회사·업종은 아래 [우리 회사]). 입력은 현장별 월 집계 숫자(rows, 원·명)와 서버가 미리 계산한 지표(stats: 전월·전년 동월 증감률, 3개월 이동평균, 6개월 추세, 다음 3개월 전망 범위, 성장·하락 순위, 이상 신호, 빠진 달)뿐입니다.
규칙:
- 숫자는 반드시 rows·stats 에 있는 값만 쓰세요. 새로 계산하거나 지어내지 마세요. 숫자를 말할 때는 그 현장·월을 함께 적으세요.
- 동향(trend)은 전월·전년 동월·3개월 이동평균과 성장/하락 순위(stats.ranking)로 2~4문장.
- 전망(forecast)은 stats 의 forecast 범위(low~high)를 그대로 인용하고 '추정'이라고 밝히며, 어떤 가정(최근 추세가 이어진다 등)에 기댄 것인지 적으세요. site 는 '전체' 또는 현장 이름.
- 대안(actions)은 현장별 2~3개, 각 제안에 근거 숫자(어떤 지표가 어떻게 변했는지)를 붙이세요. 투자 조언·사람(직원) 평가는 하지 마세요.
- 확인 필요(checks)는 빠진 달·0원·급증/급감처럼 사람이 숫자를 다시 볼 것.
- 이상치(anomalies)는 전월·전년 동월 대비 대략 ±30% 이상(stats.flags)만 고르세요.
JSON 으로만 답하세요: {"summary": "3~5문장 요약", "trend": "동향", "anomalies": [{"site": "현장 이름", "month": "YYYY-MM", "metric": "revenue|expense|members", "comment": "한두 문장"}], "comparisons": [{"site": "현장 이름", "comment": "한두 문장"}], "forecast": [{"site": "전체", "comment": "범위·가정"}], "actions": [{"site": "현장 이름", "items": ["제안"]}], "checks": ["확인할 것"]}.`;

const SCHEMA = { type: 'object', additionalProperties: false, required: ['summary', 'trend', 'anomalies', 'comparisons', 'forecast', 'actions', 'checks'], properties: {
  summary: { type: 'string' }, trend: { type: 'string' },
  anomalies: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['site', 'month', 'metric', 'comment'], properties: { site: { type: 'string' }, month: { type: 'string' }, metric: { type: 'string' }, comment: { type: 'string' } } } },
  comparisons: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['site', 'comment'], properties: { site: { type: 'string' }, comment: { type: 'string' } } } },
  forecast: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['site', 'comment'], properties: { site: { type: 'string' }, comment: { type: 'string' } } } },
  actions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['site', 'items'], properties: { site: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } } } },
  checks: { type: 'array', items: { type: 'string' } },
} };

/**
 * 한 달 분석 → 보고서 저장. kind: auto(자동 — 회사 시스템 작업, 매출 권한자에게 알림) · manual([AI 분석]) · deep([종합 보고] Opus).
 * 모델: Sonnet(보통 생각 깊이), 종합 보고만 Opus. 입력에 없는 현장·월을 가리키는 내용은 버린다.
 */
export async function analyzePeriod(tenant: string, period: string, opt: { actor: SessionUser | null; kind: 'auto' | 'manual' | 'deep'; fileIds?: string[] }) {
  const sql = db();
  if (!PERIOD.test(period)) throw badRequest('YYYY-MM 형식이어야 합니다');
  const rows = await analysisInput(sql, tenant, period);
  if (!rows.some((r) => r.month === period)) throw badRequest(`${period} 실적이 없습니다. 먼저 입력하세요`);
  const stats = revenueStats(rows, period);
  const input = { period, unit: '원(회원 수는 명)', rows, stats: { method: stats.method, total: brief(stats.total), sites: stats.sites.map((s) => ({ site: s.site, ...brief(s) })), ranking: stats.ranking, flags: stats.flags, missing: stats.checks } };
  const P = await import('./ai/provider');
  const provider = P.anthropicProvider({ tier: opt.kind === 'deep' ? 'deep' : 'default' });
  const Pn = await import('./ai/persona');
  const company = Pn.companyBlock(await Pn.companyAi((opt.actor ?? { tenant }) as SessionUser, sql));
  const r0 = await provider.chat({ system: `${AI_SYSTEM}\n\n${company}`, tools: [], format: SCHEMA, messages: [{ role: 'user', content: JSON.stringify(input) }] })
    .catch((e: any) => { throw e instanceof HttpError ? e : new HttpError(502, 'ai_unavailable', `AI 분석 서버 응답 오류${e?.status ? ` (${e.status})` : ''}`); });
  const model = r0.model ?? provider.model;
  await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
    values (${tenant}, ${opt.actor?.id ?? null}, ${randomUUID()}, ${provider.name}, ${model}, ${r0.usage.input_tokens}, ${r0.usage.output_tokens}, ${r0.usage.cache_read_input_tokens ?? 0},
      ${r0.usage.cache_creation_input_tokens ?? 0}, ${P.costUsd(model, r0.usage)}, ${opt.kind === 'auto' ? 'revenue_auto' : 'revenue'})`;
  let out: any;
  try { out = JSON.parse(r0.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')); } catch { throw new HttpError(502, 'ai_bad_output', 'AI 응답을 해석하지 못했습니다'); }
  const known = new Set(rows.map((r) => `${r.site}|${r.month}`));
  const sites = new Set(rows.map((r) => r.site));
  const siteOk = (s: unknown) => sites.has(String(s)) || s === '전체';
  const arr = (x: unknown): any[] => (Array.isArray(x) ? x : []);
  const str = (x: unknown, n: number) => String(x ?? '').trim().slice(0, n);
  const output = {
    summary: str(out.summary, 2000),
    trend: str(out.trend, 2000),
    anomalies: arr(out.anomalies).filter((a) => known.has(`${a.site}|${a.month}`)).slice(0, 20)
      .map((a) => ({ site: String(a.site), month: String(a.month), metric: ['revenue', 'expense', 'members'].includes(a.metric) ? a.metric : 'revenue', comment: str(a.comment, 400) })),
    comparisons: arr(out.comparisons).filter((c) => sites.has(c.site)).slice(0, 20).map((c) => ({ site: String(c.site), comment: str(c.comment, 400) })),
    forecast: arr(out.forecast).filter((f) => siteOk(f.site)).slice(0, 20).map((f) => ({ site: String(f.site), comment: str(f.comment, 600) })),
    actions: arr(out.actions).filter((a) => siteOk(a.site)).slice(0, 20).map((a) => ({ site: String(a.site), items: arr(a.items).map((x) => str(x, 300)).filter(Boolean).slice(0, 3) })).filter((a) => a.items.length),
    checks: arr(out.checks).map((x) => str(x, 300)).filter(Boolean).slice(0, 10),
  };
  const fileIds = [...new Set(opt.fileIds ?? [])];
  const tokens = r0.usage.input_tokens + r0.usage.output_tokens;
  const [rep] = await sql<{ id: string; created_at: string }[]>`insert into revenue_ai_reports (tenant, period, model, kind, input, stats, output, usage, file_ids, created_by)
    values (${tenant}, ${period}, ${model}, ${opt.kind}, ${sql.json(input as never)}, ${sql.json(stats as never)}, ${sql.json(output as never)}, ${sql.json({ total_tokens: tokens } as never)}, ${fileIds}::uuid[], ${opt.actor?.id ?? null})
    returning id, created_at`;
  const files = fileIds.length ? await sql<{ id: string; title: string; file_name: string }[]>`select id, title, file_name from library_files where id = any(${fileIds}::uuid[]) and tenant = ${tenant} and deleted_at is null` : [];
  if (opt.kind === 'auto') {
    const { notify } = await import('./notifications');
    const label = files.length ? `근거: 「${files[0].file_name}」${files.length > 1 ? ` 외 ${files.length - 1}건` : ''}` : '확정된 실적 기준';
    // 매출은 기밀 — 잠금 화면에 숫자가 보이지 않게 알림에는 숫자를 넣지 않는다
    await notify(sql, { userIds: await revenueManagers(sql, tenant, 'view'), type: 'revenue', title: `${Number(period.slice(5))}월 매출 자료 분석 완료 — 동향·전망·대안`,
      body: `${label} · 요약·동향·전망·현장별 대안은 매출 화면에서 확인하세요.`, link: `/revenue?report=${rep.id}`, entityType: 'revenue_report', entityId: rep.id, dedupeKey: `revrep:${rep.id}`, actorId: opt.actor?.id ?? null });
  }
  return { id: rep.id, created_at: rep.created_at, period, model, kind: opt.kind, input, stats, output, file_ids: fileIds, files, tokens };
}

// ---------------- 확정·무시·다시 읽기 ----------------
async function enqueue(sql: Sql, tenant: string, period: string, importId: string, fileId: string | null) {
  const [q] = await sql<{ run_after: string }[]>`insert into revenue_analysis_queue (tenant, period, run_after, import_ids, file_ids)
    values (${tenant}, ${period}, now() + interval '10 minutes', ${[importId]}::uuid[], ${fileId ? [fileId] : []}::uuid[])
    on conflict (tenant, period) do update set import_ids = revenue_analysis_queue.import_ids || excluded.import_ids,
      file_ids = array(select distinct x from unnest(revenue_analysis_queue.file_ids || excluded.file_ids) x), error = null
    returning run_after`;
  return q.run_after;
}

const rowInput = z.object({ site: z.string().trim().min(1).max(100), month: z.string().trim().max(10), item: z.string().trim().max(20), amount: z.coerce.number().int().min(0).max(1e13) });
export const importActInput = z.object({ action: z.enum(['confirm', 'dismiss', 'retry']), rows: z.array(rowInput).max(500).optional() });

export async function actImport(u: SessionUser, id: string, i: z.infer<typeof importActInput>, ip: string | null) {
  const sql = db(); await requireRevenue(u, sql, 'edit');
  const t = tenantOf(u);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const [imp] = await sql<any[]>`select * from revenue_imports where id = ${id} and tenant = ${t}`;
  if (!imp) throw notFound();
  if (i.action === 'retry') {
    if (!['failed', 'empty'].includes(imp.status)) throw new HttpError(409, 'not_failed', '읽기에 실패한 자료만 다시 읽을 수 있습니다');
    if (!aiConfigured()) throw badRequest('내장 AI 가 꺼져 있습니다(운영자 설정)');
    await sql`update revenue_imports set status = 'queued', attempts = 0, locked_until = null, error = null, updated_at = now() where id = ${id}`;
    await audit(sql, u.id, 'revenue.auto_retry', 'revenue_import', id, {}, ip);
    return { ok: true, ...(await processImport(id)) };
  }
  if (i.action === 'dismiss') {
    const [d] = await sql`update revenue_imports set status = 'dismissed', decided_by = ${u.id}, decided_at = now(), locked_until = null, updated_at = now()
      where id = ${id} and status in ('queued', 'pending', 'failed', 'empty') returning id`;
    if (!d) throw new HttpError(409, 'decided', '이미 처리한 자료입니다');
    await audit(sql, u.id, 'revenue.auto_dismiss', 'revenue_import', id, { file: imp.file_name }, ip);
    return { ok: true, status: 'dismissed' };
  }
  if (imp.status !== 'pending') throw new HttpError(409, 'decided', imp.status === 'confirmed' ? '이미 확정한 자료입니다' : '아직 숫자를 다 읽지 못했습니다');
  const norm = (r: any): ExtractRow => ({ site: String(r.site), month: String(r.month), item: String(r.item), amount: Math.round(Number(r.amount) || 0) });
  const rows: ExtractRow[] = ((i.rows ?? imp.rows) as unknown[]).map(norm);
  const edited = !!i.rows && JSON.stringify(rows) !== JSON.stringify(imp.rows.map(norm)); // jsonb 는 키 순서를 바꾸므로 같은 모양으로 맞춰 비교
  const { entries, errors } = await collectItems(sql, rows.map((r, k) => ({ line: k + 1, r: { ...r, sourceFile: imp.file_name } })), t);
  if (errors.length) return { ok: false, count: 0, errors }; // 하나라도 틀리면 아무것도 저장하지 않음(CSV 가져오기와 같은 규칙)
  if (!entries.length) throw badRequest('반영할 숫자가 없습니다 — 필요 없으면 [무시]를 누르세요');
  const months = [...new Set(entries.map((e) => e.month))].sort();
  await sql.begin(async (tx) => {
    const s = tx as unknown as Sql;
    const [ok] = await s`update revenue_imports set status = 'confirmed', rows = ${s.json(rows as never)}, applied = ${s.json({ count: entries.length, months, edited } as never)},
      decided_by = ${u.id}, decided_at = now(), updated_at = now() where id = ${id} and status = 'pending' returning id`;
    if (!ok) throw new HttpError(409, 'decided', '이미 처리한 자료입니다');
    for (const e of entries) await upsertPartial(s, u, e, 'ai', imp.file_id ? [imp.file_id] : null, t);
  });
  const period = months[months.length - 1];
  const analyzeAt = await enqueue(sql, t, period, id, imp.file_id);
  await audit(sql, u.id, 'revenue.auto_confirm', 'revenue_import', id, { file: imp.file_name, count: entries.length, months, edited }, ip);
  return { ok: true, count: entries.length, months, period, analyzeAt };
}

/** 분석 대기열의 그 달을 지금 바로(누른 사람 이름으로 기록). 실패하면 30분 뒤 자동으로 다시 */
export async function analyzeNow(u: SessionUser, period: string, ip: string | null) {
  const sql = db(); await requireRevenue(u, sql);
  if (!aiConfigured()) throw notFound();
  if (!PERIOD.test(period)) throw badRequest('YYYY-MM 형식이어야 합니다');
  await (await import('./plans')).assertAiRequest(u);
  const t = tenantOf(u);
  const [q] = await sql<any[]>`delete from revenue_analysis_queue where tenant = ${t} and period = ${period} returning *`;
  try {
    const r = await analyzePeriod(t, period, { actor: u, kind: 'auto', fileIds: q?.file_ids ?? [] });
    await audit(sql, u.id, 'revenue.ai_analyze', null, null, { period, model: r.model, kind: 'auto', now: true, tokens: r.tokens }, ip);
    return r;
  } catch (e) {
    if (q) await sql`insert into revenue_analysis_queue (tenant, period, run_after, import_ids, file_ids, attempts, error) values (${t}, ${period}, now() + interval '30 minutes', ${q.import_ids}::uuid[], ${q.file_ids}::uuid[], ${q.attempts}, ${String((e as Error).message).slice(0, 300)})
      on conflict (tenant, period) do nothing`;
    throw e;
  }
}

// ---------------- 정기 실행(tick) ----------------
/** 끊긴 숫자 읽기 이어서 + 모으는 시간이 지난 달 분석 — 정기 실행은 60초 안에 모든 단계를 돌므로 AI 일은 각각 한 번에 1건. 분석은 '회사 시스템 작업' */
export async function revenueAutoTick() {
  if (!aiConfigured()) return { skipped: 'ai_off' };
  const sql = db();
  await sql`update revenue_imports set status = 'failed', error = coalesce(error, '세 번 시도했지만 읽지 못했습니다'), locked_until = null, updated_at = now()
    where status in ('queued', 'extracting') and attempts >= 3 and (locked_until is null or locked_until < now())`;
  const due = await sql<{ id: string }[]>`select id from revenue_imports where status in ('queued', 'extracting') and attempts < 3 and (locked_until is null or locked_until < now()) order by created_at limit 1`;
  const read: unknown[] = [];
  for (const r of due) read.push(await processImport(r.id));
  const jobs = await sql<any[]>`update revenue_analysis_queue set run_after = now() + interval '15 minutes', attempts = attempts + 1
    where (tenant, period) in (select tenant, period from revenue_analysis_queue where run_after <= now() and attempts < 3 order by run_after limit 1 for update skip locked) returning *`;
  const analyzed: unknown[] = [];
  for (const q of jobs) {
    try {
      await assertSystemAi(q.tenant);
      const r = await analyzePeriod(q.tenant, q.period, { actor: null, kind: 'auto', fileIds: q.file_ids });
      // 분석하는 동안 같은 달 자료가 더 확정됐으면 남겨 둔다(15분 뒤 한 번 더 — 모두 포함)
      const gone = await sql`delete from revenue_analysis_queue where tenant = ${q.tenant} and period = ${q.period} and import_ids <@ ${q.import_ids}::uuid[] returning 1`;
      if (!gone.length) await sql`update revenue_analysis_queue set attempts = 0 where tenant = ${q.tenant} and period = ${q.period}`;
      analyzed.push({ tenant: q.tenant, period: q.period, report: r.id });
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 300);
      await sql`update revenue_analysis_queue set error = ${msg}, run_after = now() + interval '30 minutes' where tenant = ${q.tenant} and period = ${q.period}`;
      if (!(e instanceof HttpError)) await logError('revenue:analyze', e, { tenant: q.tenant, period: q.period });
      analyzed.push({ tenant: q.tenant, period: q.period, error: msg });
    }
  }
  return { read, analyzed };
}

// ---------------- 화면용 ----------------
type Line = ExtractRow & { current: number | null; state: 'new' | 'same' | 'changed' | 'error'; error?: string };
/** 확인 대기 표: 읽은 값 vs 지금 실적(같은 현장·월·항목) — 다른 칸 강조용 */
async function diffLines(sql: Sql, tenant: string, rows: ExtractRow[]): Promise<Line[]> {
  const { errors, lines } = await collectItems(sql, rows.map((r, k) => ({ line: k + 1, r })), tenant);
  const unitIds = [...new Set(lines.map((l) => l.unitId))];
  const months = [...new Set(lines.map((l) => l.month + '-01'))];
  const cur = unitIds.length ? await sql<any[]>`select org_unit_id, to_char(month, 'YYYY-MM') as month, revenue::float8 as revenue, expense::float8 as expense, members, target::float8 as target
    from revenue_entries where org_unit_id = any(${unitIds}::uuid[]) and month = any(${months}::date[])` : [];
  const byKey = new Map(cur.map((c) => [`${c.org_unit_id}|${c.month}`, c]));
  const err = new Map(errors.map((e) => [e.line, e.message]));
  const ln = new Map(lines.map((l) => [l.line, l]));
  return rows.map((r, k) => {
    const l = ln.get(k + 1);
    if (!l) return { ...r, current: null, state: 'error' as const, error: err.get(k + 1) ?? '확인 필요' };
    const c = byKey.get(`${l.unitId}|${l.month}`);
    const current = c && c[l.key] !== null && c[l.key] !== undefined ? Number(c[l.key]) : null;
    return { ...r, month: l.month, current, state: current === null ? 'new' as const : current === l.amount ? 'same' as const : 'changed' as const };
  });
}

/** 매출 화면 위: 확인 대기 자료·분석 대기열·보고서 이력 */
export async function autoOverview(u: SessionUser) {
  const sql = db(); await requireRevenue(u, sql);
  const t = tenantOf(u);
  const [imports, queue, reports] = await Promise.all([
    sql<any[]>`select i.id, i.file_id, i.file_name, i.detected_by, i.status, i.rows, i.notes, i.error, i.applied, i.created_at, i.decided_at,
        cu.name as created_by_name, du.name as decided_by_name, (l.id is not null) as file_ok
      from revenue_imports i left join users cu on cu.id = i.created_by left join users du on du.id = i.decided_by left join library_files l on l.id = i.file_id and l.deleted_at is null
      where i.tenant = ${t} and (i.status in ('queued', 'extracting', 'pending', 'failed') or i.updated_at > now() - interval '3 days')
      order by (i.status = 'pending') desc, i.created_at desc limit 20`,
    sql`select period, run_after, cardinality(import_ids)::int as imports, attempts, error from revenue_analysis_queue where tenant = ${t} order by period desc`,
    sql`select id, period, kind, model, created_at, left(output->>'summary', 140) as summary, cardinality(file_ids)::int as files from revenue_ai_reports where tenant = ${t} order by created_at desc limit 30`,
  ]);
  for (const imp of imports) {
    if (imp.status === 'pending') imp.lines = await diffLines(sql, t, imp.rows);
    if (imp.status !== 'pending') delete imp.rows;
  }
  const { menuLevel } = await import('./menuPerms');
  return { imports, queue, reports, canEdit: (await menuLevel(u, 'revenue', sql)) === 'edit', auto: autoOn() && aiConfigured(), batchMinutes: BATCH_MINUTES };
}
