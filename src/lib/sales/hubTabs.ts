// #611(대표 10/25 17:30 ⑦, 로컬 SALES_HUB_REQUESTS): 영업기회 허브 탭 = 회사가 켠 수집 DB 종류 — 데이터 설정에서 그 종류의 수집기(공공데이터는 원천)를 모두 끈 회사는 그 탭이 안 보임.
// 기본값은 켜짐(수집기 설정 행이 없으면 켜진 것) — 신규 현장·협력사 등록·지역별은 수집기가 아닌 자료(영업관리 이관·리드)라 늘 보임.
import { db } from '../db';

export const HUB_TABS = ['bids', 'buildings', 'facilities', 'vendors', 'contracts', 'prospects', 'regions'] as const;
export type HubTab = (typeof HUB_TABS)[number];
/** 준공·입주 시설 표(operating_facility_prospects)를 채우는 수집기 */
const FACILITY_COLLECTORS = ['kicox_industrial_complexes', 'public_sports_facilities', 'tourist_hotels_localdata', 'kapt_weekly_complexes', 'reb_recent_complexes', 'kapt_new_complexes', 'operating_from_kapt', 'kapt_sa_sun'];

/** 회사가 볼 허브 탭(순서는 화면 그대로). bidsOn = 입찰·공고 선택 기능(tenants.sales_bids) */
export async function hubTabsOn(tenant: string, bidsOn: boolean): Promise<HubTab[]> {
  const sql = db();
  const { BID_COLLECTORS } = await import('./collectors');
  const [mine, ds] = await Promise.all([
    sql<{ slug: string; enabled: boolean }[]>`select slug, enabled from sales_collector_settings where tenant = ${tenant}`,
    sql<{ n: number; on: number }[]>`select count(*)::int as n, count(*) filter (where enabled)::int as "on" from tenant_data_sources where tenant = ${tenant}`,
  ]);
  const m = new Map(mine.map((r) => [r.slug, r.enabled]));
  const on = (slug: string) => m.get(slug) ?? true;
  const bids = bidsOn && [...BID_COLLECTORS].some(on);
  const facilities = FACILITY_COLLECTORS.some(on);
  const prospects = (ds[0]?.n ?? 0) === 0 || (ds[0]?.on ?? 0) > 0; // 원천을 하나도 안 고른 회사는 안내가 있는 빈 탭을 봄
  return HUB_TABS.filter((t) => (t === 'bids' || t === 'contracts' ? bids : t === 'facilities' ? facilities : t === 'prospects' ? prospects : true));
}
