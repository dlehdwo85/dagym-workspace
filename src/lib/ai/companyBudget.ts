import { db, type Sql } from '../db';
import { HttpError } from '../errors';
import { notify } from '../notifications';
import { usdKrw } from './provider';

/**
 * 대표 10/24 ② 요금제별 회사 월 AI 예산(원). 회사가 이번 달 쓴 AI 원가(정가 환산 ai_usage.cost_krw) 합계를 예산과 비교한다.
 * - 예산 = 플랫폼 운영이 회사별로 정한 값(limit_overrides.aiBudgetKrw, null = 무제한)이 있으면 그 값,
 *   없으면 요금제 고정액(limits.aiBudgetKrw — 14일 체험 5,000원) 또는 1인 금액(limits.perUserAiBudgetKrw) × 결제 인원(최소 인원 이상)
 *   + 마케팅 요금제의 AI 몫(체험 중 제외) + AI 크레딧 팩. 대표가 AI 설정에서 회사 월 한도($)를 따로 정했으면 둘 중 낮은 값.
 * - 요금제에 원 예산이 없으면(우리 회사 internal·체험 조직 demo·예전 요금제) 예전 회사 월 한도($, 기본 AI_MONTHLY_BUDGET_USD)를 원으로 바꿔 쓴다(legacy).
 * - 영상 제작은 마케팅 크레딧으로 따로 센다: Higgsfield 비용은 ai_usage 에 없고, 영상 기획·검수 AI(purpose marketing_video*)도 뺀다.
 * - 80%·100% 알림(대표·관리자, 달마다 한 번). 100%면 AI 기능만 멈추고(업무·일정 그대로) 다음 달 1일(서울)에 다시 채워진다.
 */
const TZ = 'Asia/Seoul';
export const VIDEO_PURPOSE = 'marketing_video%';
export const defaultBudgetUsd = () => { const n = Number(process.env.AI_MONTHLY_BUDGET_USD); return Number.isFinite(n) && n > 0 ? n : 30; };
const monthOf = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()).slice(0, 7);
/** 다음 달 1일 — 'YYYY-MM-01'·'11월 1일' */
export function resetOf(ym = monthOf()) {
  const [y, m] = ym.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return { on: `${ny}-${String(nm).padStart(2, '0')}-01`, label: `${nm}월 1일` };
}
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;

export type BudgetSource = 'plan' | 'override' | 'unlimited' | 'legacy';
export type CompanyBudget = {
  month: string; source: BudgetSource; limitKrw: number | null; usedKrw: number; leftKrw: number | null; pct: number | null; over: boolean;
  /** 예산이 어떻게 정해졌는지(관리 화면 한 줄) — 요금제 몫(고정 또는 1인 × 인원)·마케팅 요금제 AI 몫·AI 팩·대표가 정한 달러 한도 */
  parts: { planKrw: number | null; perSeatKrw: number | null; seats: number | null; mktKrw: number; packKrw: number; ownerCapKrw: number | null };
  resetOn: string; resetLabel: string;
};

/** 이번 달 회사 AI 예산·사용(원) */
export async function companyAiBudget(tenant: string, sql: Sql = db()): Promise<CompanyBudget> {
  const rate = usdKrw(); const month = monthOf();
  const P = await import('../plans');
  const sub = await P.subscription(tenant, sql);
  const lim = (sub.limits ?? {}) as { aiBudgetKrw?: number | null; perUserAiBudgetKrw?: number | null };
  const ov = (sub.limit_overrides ?? {}) as { aiBudgetKrw?: number | null };
  const [[cap], [used], [plan], [people]] = await Promise.all([
    sql<{ usd: number }[]>`select monthly_usd::float8 usd from ai_limits where tenant = ${tenant}`,
    sql<{ krw: number }[]>`select coalesce(sum(coalesce(cost_krw, cost_usd * ${rate})), 0)::float8 krw from ai_usage
      where tenant = ${tenant} and created_at >= (${month + '-01'}::date::timestamp at time zone 'Asia/Seoul') and coalesce(purpose, '') not like ${VIDEO_PURPOSE}`,
    sql<{ min_users: number | null; per_user_krw: number | null }[]>`select min_users, per_user_krw from plans where code = ${sub.plan_code}`,
    sql<{ n: number }[]>`select count(*)::int n from users where tenant = ${tenant} and status = 'active'`,
  ]);
  const ownerCapKrw = cap ? Math.round(cap.usd * rate) : null;
  const parts: CompanyBudget['parts'] = { planKrw: null, perSeatKrw: null, seats: null, mktKrw: 0, packKrw: 0, ownerCapKrw };
  let source: BudgetSource; let limit: number | null;
  if ('aiBudgetKrw' in ov) {
    source = ov.aiBudgetKrw === null || ov.aiBudgetKrw === undefined ? 'unlimited' : 'override';
    limit = source === 'unlimited' ? null : Number(ov.aiBudgetKrw);
    parts.planKrw = limit;
  } else if (typeof lim.aiBudgetKrw === 'number' || typeof lim.perUserAiBudgetKrw === 'number') {
    source = 'plan';
    if (typeof lim.aiBudgetKrw === 'number') parts.planKrw = lim.aiBudgetKrw;
    else {
      // 결제 인원 = 1인 요금제면 max(최소 인원, 활성 인원) — 결제(billing.quote)와 같은 셈
      parts.seats = plan?.per_user_krw ? Math.max(plan.min_users ?? 1, people.n) : Math.max(1, people.n);
      parts.perSeatKrw = lim.perUserAiBudgetKrw!;
      parts.planKrw = parts.perSeatKrw * parts.seats;
      // 마케팅 요금제(크레딧과 별도로 'AI $' 몫이 있음)를 고른 회사는 그 몫을 더한다 — 체험 중에는 대표 결정 5,000원 그대로
      if (sub.status !== 'trial') {
        const M = await import('../mktAuto');
        const ms = await M.settingsOf(tenant).catch(() => null);
        const usd = ms?.plan_code ? M.limitsOf(ms).aiMonthlyUsd : null;
        if (usd) parts.mktKrw = Math.round(usd * rate);
      }
    }
    const counts = (sub.addons ?? {}) as Record<string, number>;
    const codes = Object.keys(counts).filter((k) => counts[k] > 0);
    if (codes.length) for (const a of await sql<{ code: string; adds: Record<string, number> }[]>`select code, adds from plan_addons where code = any(${codes})`) parts.packKrw += Number(a.adds?.aiBudgetKrw ?? 0) * counts[a.code];
    limit = (parts.planKrw ?? 0) + parts.mktKrw + parts.packKrw;
  } else {
    source = 'legacy';
    limit = Math.round((cap?.usd ?? defaultBudgetUsd()) * rate);
  }
  if (source !== 'legacy' && ownerCapKrw !== null) limit = limit === null ? ownerCapKrw : Math.min(limit, ownerCapKrw);
  const usedKrw = Math.round(used.krw);
  const r = resetOf(month);
  return { month, source, limitKrw: limit, usedKrw, leftKrw: limit === null ? null : Math.max(0, limit - usedKrw), pct: limit === null ? null : limit <= 0 ? 100 : Math.round((usedKrw / limit) * 100),
    over: limit !== null && usedKrw >= limit, parts, resetOn: r.on, resetLabel: r.label };
}

/** 다 썼을 때 안내 — 금액은 관리 화면에서만(직원에게는 '회사 AI 사용량'으로) */
export const budgetMessage = (b: Pick<CompanyBudget, 'source' | 'resetLabel'>) => b.source === 'legacy'
  ? `이번 달 회사 AI 한도에 도달해 AI 기능을 멈췄습니다 — ${b.resetLabel}에 다시 쓸 수 있어요. 업무·일정 등 다른 기능은 그대로입니다(대표가 AI 설정에서 한도를 올릴 수 있습니다).`
  : `이번 달 회사 AI 사용량을 모두 써서 AI 기능을 멈췄습니다 — ${b.resetLabel}에 다시 채워집니다. 업무·일정 등 다른 기능은 그대로 쓸 수 있어요(회사 관리자에게 문의하세요).`;

/**
 * AI 호출 전 확인: 회사 월 AI 예산을 다 썼으면 429 ai_budget(다음 달 1일 초기화 안내). 80% 넘으면 알림(달마다 한 번).
 * legacy:false = 요금제에 원 예산이 있을 때만 확인(예전 달러 한도는 원래 확인하던 곳에서만 — 범위를 넓히지 않음)
 */
export async function assertCompanyAi(tenant: string, o: { legacy?: boolean; sql?: Sql } = {}) {
  const b = await companyAiBudget(tenant, o.sql);
  if (b.source === 'legacy' && o.legacy === false) return b;
  if (b.pct !== null && b.pct >= 80) await budgetAlerts(tenant, b, o.sql).catch(() => {});
  if (b.over) throw new HttpError(429, 'ai_budget', budgetMessage(b));
  return b;
}

const fired = new Set<string>();
/** 80%·100% 알림 — 대표·관리자에게, 그 달 한 번(알림 dedupe + 프로세스 기억). 체험 조직(demo)은 알림 없음 */
export async function budgetAlerts(tenant: string, b?: CompanyBudget, sql: Sql = db()) {
  if (tenant === 'demo') return 0;
  b ??= await companyAiBudget(tenant, sql);
  if (b.pct === null || b.pct < 80 || b.limitKrw === null) return 0;
  const level = b.pct >= 100 ? 100 : 80;
  const key = `ai_budget:${tenant}:${b.month}:${level}`;
  if (fired.has(key)) return 0;
  const admins = (await sql<{ id: string }[]>`select id from users where tenant = ${tenant} and status = 'active' and role in ('owner', 'admin')`).map((x) => x.id);
  if (!admins.length) return 0;
  const legacy = b.source === 'legacy';
  const body = level === 100
    ? `이번 달 회사 AI ${legacy ? '한도' : '예산'} ${won(b.limitKrw)}을 모두 써서 AI 기능을 멈췄습니다 — ${b.resetLabel}에 다시 채워집니다. 업무·일정 등 다른 기능은 그대로입니다.`
    : `회사 AI ${legacy ? '한도' : '예산'} ${won(b.limitKrw)} 중 ${won(b.usedKrw)}(${b.pct}%)를 썼습니다 — 100%가 되면 ${b.resetLabel}까지 AI 기능만 멈춥니다(업무·일정은 그대로).`;
  const sent = await notify(sql, { userIds: admins, type: 'usage_alert', title: level === 100 ? '이번 달 AI 예산을 모두 썼습니다' : `AI 예산 ${level}% 사용`, body, link: '/admin/usage', dedupeKey: key });
  fired.add(key);
  return Array.isArray(sent) ? sent.length : 0;
}
