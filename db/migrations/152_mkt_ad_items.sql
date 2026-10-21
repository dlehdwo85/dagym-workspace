-- 대표 10/20 14:10 ③ 잔여(#98): 광고 성과 키워드/소재 표 — 캠페인 아래 단위(네이버 키워드·소재, 구글 키워드·광고, Meta 광고)를 날짜별로 보관. 계정을 끊으면 같이 삭제.
create table if not exists mkt_ad_items (
  account_id uuid not null references mkt_ad_accounts(id) on delete cascade,
  day date not null,
  kind text not null check (kind in ('keyword', 'ad')),
  item_id text not null,
  item_name text not null default '',
  campaign_id text not null default '',
  campaign_name text not null default '',
  adgroup_name text not null default '',
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  cost_krw numeric(14, 2) not null default 0,
  conversions numeric(12, 2) not null default 0,
  currency text not null default 'KRW',
  updated_at timestamptz not null default now(),
  primary key (account_id, day, kind, item_id)
);
create index if not exists mkt_ad_items_day on mkt_ad_items (day);
