import { db, type Sql } from '../db';
import { HttpError } from '../errors';
import { notify } from '../notifications';
import { usdKrw } from './provider';

/**
 * 382차 #1004(대표 11/07 "지원사업·공고 긁어오는 AI 가 싸면 AI 크레딧에 넣지 말고 매일 기본으로. 안 들어오면 치명적"):
 * 영업 수집용 AI(지원사업 자동 판단·참가자격 항목 정리·사진 공고문 읽기)는 회사 AI 한도·마케팅 한도 밖 '시스템 몫'으로 따로 센다.
 * - 회사 월 AI 예산·요청 수·사람별 한도에 안 셈(companyBudget·currentUsage·사람별 비중에서 뺌)
 * - 안전 상한만 둠(기본 월 20,000원, 플랫폼 운영 › AI·제작 도구에서 바꿈) — 닿으면 그 달은 멈추고 슈퍼관리자에게 알림(달마다 한 번)
 * - 사용량 화면에는 '자동 수집(회사 한도 밖)' 줄로 보임
 */
export const SYSTEM_PURPOSES = ['sales_support_auto', 'sales_eligibility_items', 'sales_eligibility_vision'] as const;
export const SYSTEM_LABEL = '자동 수집(회사 한도 밖)';
const KEY = 'ai_system_cap';
const DEFAULT_CAP_KRW = 20_000;
const TZ = 'Asia/Seoul';
const monthOf = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d).slice(0, 7);

export async function systemCapKrw(sql: Sql = db()): Promise<number> {
  const [r] = await sql<{ value: { krw?: number } }[]>`select value from app_settings where key = ${KEY}`;
  const v = Number(r?.value?.krw);
  return Number.isFinite(v) && v >= 0 ? Math.round(v) : DEFAULT_CAP_KRW;
}

/** 이번 달(서울) 시스템 몫 사용 — 전체 또는 한 회사 */
export async function systemSpend(sql: Sql = db(), tenant?: string) {
  const month = monthOf(); const rate = usdKrw();
  const [r] = await sql<{ krw: number; calls: number }[]>`select coalesce(sum(coalesce(cost_krw, cost_usd * ${rate})), 0)::float8 krw, count(*)::int calls from ai_usage
    where purpose = any(${SYSTEM_PURPOSES as unknown as string[]}) and created_at >= (${month + '-01'}::date::timestamp at time zone 'Asia/Seoul')
      ${tenant ? sql`and tenant = ${tenant}` : sql``}`;
  const byPurpose = await sql<{ purpose: string; krw: number; calls: number }[]>`select purpose, coalesce(sum(coalesce(cost_krw, cost_usd * ${rate})), 0)::float8 krw, count(*)::int calls from ai_usage
    where purpose = any(${SYSTEM_PURPOSES as unknown as string[]}) and created_at >= (${month + '-01'}::date::timestamp at time zone 'Asia/Seoul')
      ${tenant ? sql`and tenant = ${tenant}` : sql``} group by purpose order by purpose`;
  return { month, krw: Math.round(r.krw), calls: r.calls, byPurpose: byPurpose.map((b) => ({ purpose: b.purpose, krw: Math.round(b.krw), calls: b.calls })) };
}

/** AI 를 부르기 전에: 이번 달 시스템 몫이 안전 상한에 닿았으면 402 ai_system_cap(그 달은 멈춤 — 다음 달 1일 다시) + 슈퍼관리자 알림(달마다 한 번) */
export async function assertSystemAi(sql: Sql = db()) {
  const [cap, s] = await Promise.all([systemCapKrw(sql), systemSpend(sql)]);
  if (cap > 0 && s.krw < cap) return { cap, ...s };
  const admins = await (await import('../superAdmin')).platformAdminIds(sql);
  await notify(sql, { userIds: admins, type: 'usage_alert', title: `자동 수집 AI 월 상한 ${cap.toLocaleString('ko-KR')}원에 닿음`,
    body: `이번 달 지원사업 자동 판단·참가자격 읽기·사진 공고문 읽기 ${s.calls}번 · ${s.krw.toLocaleString('ko-KR')}원 — 다음 달 1일까지 멈춥니다. 플랫폼 운영 › AI·제작 도구에서 상한을 바꿀 수 있습니다.`,
    link: '/platform?tab=ai#ai-system', dedupeKey: `ai_system_cap:${s.month}` }).catch(() => {});
  throw new HttpError(402, 'ai_system_cap', `자동 수집 AI 월 상한(${cap.toLocaleString('ko-KR')}원)에 닿아 이번 달은 멈췄습니다 — 다음 달 1일에 다시 돕니다`);
}

export async function setSystemCap(krw: number, by: string, sql: Sql = db()) {
  const v = Math.max(0, Math.min(10_000_000, Math.round(krw)));
  await sql`insert into app_settings (key, value) values (${KEY}, ${sql.json({ krw: v, by, at: new Date().toISOString() } as never)})
    on conflict (key) do update set value = excluded.value`;
  return { krw: v };
}
