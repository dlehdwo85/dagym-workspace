import { db, type Sql } from './db';

/**
 * 355차 #939 ①②(대표 11/04 승인): 구간 정액 요금 — 활성 인원 → 구간 → 월 금액 · 저장 · 회사 월 AI 예산(원).
 * 요금제 limits 에 bands 가 있으면 구간 요금제다(w_work 업무 · w_sales 업무+영업, migration 243).
 * - 구간 안에서는 인원이 늘어도 같은 금액. 마지막 구간(50인)을 넘으면 1인 금액 × 인원(+ 업무+영업은 영업 사용자 1인 추가 금액).
 * - 결제(billing.quote)·저장 한도(plans.effectiveLimits)·회사 AI 예산(ai/companyBudget)이 모두 이 함수 하나로 셈한다.
 * - 회사 AI 예산(원)은 내부 기준값 — 고객 화면에는 금액 없이 '포함 · 남은 양 %'만(351차 #939 ③).
 */
export type Band = { upTo: number; krw: number; storageGb: number; aiBudgetKrw: number };
export type BandPlan = {
  bands: Band[]; overPerUserKrw: number; overPerUserStorageGb: number; overPerUserAiBudgetKrw: number;
  salesPerUserKrw?: number | null; annualOffPct?: number | null;
};
export type BandPick = {
  /** '1~5인' · '51인~' */ label: string; from: number; upTo: number | null; people: number; salesPeople: number | null;
  krw: number; annualKrw: number; storageGb: number; aiBudgetKrw: number; over: boolean;
};
export const BAND_KEYS = ['bands', 'overPerUserKrw', 'overPerUserStorageGb', 'overPerUserAiBudgetKrw', 'salesPerUserKrw', 'annualOffPct'] as const;

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v));
/** 요금제 limits 가 구간 요금제인지 — 구간 1개 이상, 숫자 칸이 모두 있어야 */
export function isBanded(lim: unknown): lim is BandPlan {
  const l = lim as Partial<BandPlan> | null | undefined;
  return !!l && Array.isArray(l.bands) && l.bands.length > 0 && l.bands.every((b) => b && n(b.upTo) > 0 && n(b.krw) >= 0);
}
const sorted = (p: BandPlan) => [...p.bands].map((b) => ({ upTo: n(b.upTo), krw: n(b.krw), storageGb: n(b.storageGb) || 0, aiBudgetKrw: n(b.aiBudgetKrw) || 0 })).sort((a, b) => a.upTo - b.upTo);
const annualOf = (p: BandPlan, krw: number) => Math.round(krw * 12 * (1 - Math.min(90, Math.max(0, n(p.annualOffPct ?? 20) || 0)) / 100));

/** 구간 표(요금 안내용): 구간마다 이름·월 금액·연간·저장. AI 원 예산은 내부 값이라 화면용 표에는 비율(첫 구간 = 1배)만 */
export function bandRows(p: BandPlan) {
  const bs = sorted(p); const base = bs[0]?.aiBudgetKrw || 0;
  const rows = bs.map((b, i) => ({ label: `${i ? bs[i - 1].upTo + 1 : 1}~${b.upTo}인`, upTo: b.upTo as number | null, krw: b.krw, annualKrw: annualOf(p, b.krw), storageGb: b.storageGb,
    perUserKrw: null as number | null, perUserStorageGb: null as number | null, salesPerUserKrw: null as number | null, aiTimes: base ? Math.round((b.aiBudgetKrw / base) * 10) / 10 : null }));
  const last = bs.at(-1)!;
  rows.push({ label: `${last.upTo + 1}인~`, upTo: null, krw: n(p.overPerUserKrw), annualKrw: annualOf(p, n(p.overPerUserKrw)), storageGb: n(p.overPerUserStorageGb),
    perUserKrw: n(p.overPerUserKrw), perUserStorageGb: n(p.overPerUserStorageGb), salesPerUserKrw: p.salesPerUserKrw ? n(p.salesPerUserKrw) : null, aiTimes: null });
  return rows;
}

/** 인원(·영업 사용자 수) → 구간. 인원은 최소 1명 */
export function pickBand(p: BandPlan, people: number, salesPeople: number | null = null): BandPick {
  const bs = sorted(p); const k = Math.max(1, Math.floor(people || 0));
  const i = bs.findIndex((b) => k <= b.upTo);
  if (i >= 0) {
    const b = bs[i];
    return { label: `${i ? bs[i - 1].upTo + 1 : 1}~${b.upTo}인`, from: i ? bs[i - 1].upTo + 1 : 1, upTo: b.upTo, people: k, salesPeople, krw: b.krw, annualKrw: annualOf(p, b.krw), storageGb: b.storageGb, aiBudgetKrw: b.aiBudgetKrw, over: false };
  }
  const last = bs.at(-1)!; const sales = p.salesPerUserKrw ? Math.max(0, Math.min(k, salesPeople ?? k)) : 0;
  const krw = n(p.overPerUserKrw) * k + (p.salesPerUserKrw ? n(p.salesPerUserKrw) * sales : 0);
  return { label: `${last.upTo + 1}인~`, from: last.upTo + 1, upTo: null, people: k, salesPeople: p.salesPerUserKrw ? sales : salesPeople, krw, annualKrw: annualOf(p, krw),
    storageGb: n(p.overPerUserStorageGb) * k, aiBudgetKrw: n(p.overPerUserAiBudgetKrw) * k, over: true };
}

/** 회사 활성 인원(결제·한도와 같은 셈: status = 'active') */
export async function activePeople(tenant: string, sql: Sql = db()) {
  const [{ n: c }] = await sql<{ n: number }[]>`select count(*)::int n from users where tenant = ${tenant} and status = 'active'`;
  return c;
}
/** 영업 사용자 = 활성 대표·관리자(켠 공간 전부) + 영업 공간을 배정받은 직원 */
export async function salesPeople(tenant: string, sql: Sql = db()) {
  const [{ n: c }] = await sql<{ n: number }[]>`select count(*)::int n from users u left join space_members m on m.user_id = u.id and m.tenant = u.tenant
    where u.tenant = ${tenant} and u.status = 'active' and (u.role in ('owner', 'admin') or 'sales' = any(coalesce(m.spaces, '{}'::text[])))`;
  return c;
}
/** 회사의 지금 구간(구간 요금제가 아니면 null). 영업 사용자 수는 51인~ 이고 영업 추가 금액이 있을 때만 센다 */
export async function tenantBand(tenant: string, lim: unknown, sql: Sql = db(), people?: number): Promise<BandPick | null> {
  if (!isBanded(lim)) return null;
  const k = people ?? (await activePeople(tenant, sql));
  const last = Math.max(...lim.bands.map((b) => n(b.upTo)));
  const s = k > last && lim.salesPerUserKrw ? await salesPeople(tenant, sql) : null;
  return pickBand(lim, k, s);
}
