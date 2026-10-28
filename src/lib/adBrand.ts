import type { Sql } from './db';

/**
 * 221차 #531 광고 성과 캠페인 단위 브랜드 — 여러 브랜드가 같이 쓰는 광고 계정(계정에 브랜드 없음)도 캠페인마다 브랜드로 나눈다.
 * 순서: 관리자 직접 지정(mkt_ad_campaign_brands, '공통(브랜드 없음)'도 직접 정할 수 있음) > 계정 브랜드 > 캠페인 이름.
 * 캠페인 이름: 브랜드 이름·찾는 낱말(ad_aliases)이 들어 있으면 그 브랜드 — 띄어쓰기·괄호·밑줄은 빼고 대소문자 무시, 가장 긴 낱말이 이김,
 * 두 브랜드가 같은 길이로 걸리면 정하지 않음(표에서 직접). 시험 브랜드(test_mode)는 이름으로 찾지 않는다(직접 지정은 됨).
 */
export type BrandSource = 'manual' | 'account' | 'name';
export type CampBrand = { account_id: string; campaign_id: string; brand_id: string | null; source: BrandSource | null; auto_brand_id: string | null; auto_source: BrandSource | null };

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/[\s_\-·.,/|()[\]{}<>+&:;'"!?#]+/g, '');
/** 캠페인 이름 → 브랜드 id (못 찾거나 두 브랜드가 같은 길이로 걸리면 null) */
export function brandFromName(name: string, brands: { id: string; name: string; aliases?: string[] | null }[]): string | null {
  const n = norm(name); if (!n) return null;
  let best: string | null = null, len = 0, tie = false;
  for (const b of brands) {
    const l = Math.max(0, ...[b.name, ...(b.aliases ?? [])].map(norm).filter((k) => k.length >= 2 && n.includes(k)).map((k) => k.length));
    if (!l) continue;
    if (l > len) { best = b.id; len = l; tie = false; } else if (l === len && b.id !== best) tie = true;
  }
  return tie ? null : best;
}

/** 이 회사 광고 성과에 나온 캠페인마다 브랜드(직접 > 계정 > 이름) — auto_* 는 직접 지정이 없을 때 정해질 값(화면 '자동' 칸 안내) */
export async function adCampaignBrands(sql: Sql, tenant: string): Promise<CampBrand[]> {
  const brands = await sql<{ id: string; name: string; aliases: string[] }[]>`select id, name, ad_aliases as aliases from mkt_brands where tenant = ${tenant} and not test_mode`;
  const rows = await sql<{ account_id: string; campaign_id: string; campaign_name: string; account_brand: string | null; manual: boolean; manual_brand: string | null }[]>`
    select c.account_id, c.campaign_id, c.campaign_name, a.brand_id as account_brand, m.account_id is not null as manual, m.brand_id as manual_brand
    from (select distinct on (s.account_id, s.campaign_id) s.account_id, s.campaign_id, s.campaign_name from mkt_ad_stats s join mkt_ad_accounts x on x.id = s.account_id
          where x.tenant = ${tenant} order by s.account_id, s.campaign_id, s.day desc) c
    join mkt_ad_accounts a on a.id = c.account_id
    left join mkt_ad_campaign_brands m on m.account_id = c.account_id and m.campaign_id = c.campaign_id`;
  return rows.map((r) => {
    const byName = r.account_brand ? null : brandFromName(r.campaign_name, brands);
    const auto_brand_id = r.account_brand ?? byName; const auto_source: BrandSource | null = r.account_brand ? 'account' : byName ? 'name' : null;
    return { account_id: r.account_id, campaign_id: r.campaign_id, auto_brand_id, auto_source, ...(r.manual ? { brand_id: r.manual_brand, source: 'manual' as const } : { brand_id: auto_brand_id, source: auto_source }) };
  });
}

/** SQL 조각: 성과 줄(별칭 s: account_id·campaign_id)에 캠페인 브랜드 e 를 붙임 — 브랜드는 campBrandExpr(계정 a 가 같이 있어야 함) */
export const campBrandJoin = (sql: Sql, cb: CampBrand[]) => sql`left join (select * from unnest(${cb.map((x) => x.account_id)}::uuid[], ${cb.map((x) => x.campaign_id)}::text[], ${cb.map((x) => x.brand_id)}::uuid[])
    as e(account_id, campaign_id, brand_id)) e on e.account_id = s.account_id and e.campaign_id = s.campaign_id`;
/** 캠페인 브랜드(목록에 없는 캠페인 — 동기화 사이에 새로 들어온 줄·캠페인 id 없는 키워드 — 은 계정 브랜드) */
export const campBrandExpr = (sql: Sql) => sql`(case when e.account_id is null then a.brand_id else e.brand_id end)`;
