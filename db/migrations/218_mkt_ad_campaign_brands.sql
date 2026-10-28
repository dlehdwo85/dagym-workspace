-- 221차 #531 광고 성과 캠페인 단위 브랜드: 여러 브랜드가 같이 쓰는 광고 계정(계정에 브랜드 없음)의 성과를 캠페인마다 브랜드로 나눔
-- 캠페인 브랜드 순서: 관리자 직접 지정(mkt_ad_campaign_brands) > 계정 브랜드 > 캠페인 이름(브랜드 이름·찾는 낱말 ad_aliases)
alter table mkt_brands add column if not exists ad_aliases text[] not null default '{}'; -- 캠페인 이름에서 이 브랜드를 찾는 낱말(예: HILINK)
create table if not exists mkt_ad_campaign_brands (
  account_id uuid not null references mkt_ad_accounts(id) on delete cascade,
  campaign_id text not null,
  brand_id uuid references mkt_brands(id) on delete cascade, -- null = '공통(브랜드 없음)'으로 직접 정함 · 브랜드를 지우면 이 줄도 지워져 자동으로 돌아감
  set_by uuid references users(id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (account_id, campaign_id)
);
