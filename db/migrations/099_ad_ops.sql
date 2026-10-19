-- V44 ① AI 광고 운영실 — 광고 '쓰기'(docs/research/AI_ADS_OPERATIONS_DESIGN.md). 첫 매체: 네이버 검색광고(파워링크 → 플레이스).
-- 원칙: 돈이 나가는 변경(켜기·예산·입찰 상향)은 관리자 승인 + 회사 월 광고비 상한 필수 + 모든 변경 기록(전후 값)·되돌리기. 새로 만드는 광고는 꺼진 상태.
create table if not exists mkt_ad_caps (
  tenant text primary key references tenants(id) on delete cascade,
  monthly_cap bigint not null check (monthly_cap > 0),   -- 원(KRW), 이번 달 모든 매체 광고비 합계 기준
  stopped_month text,                                    -- 상한 초과로 자동 중지한 달(YYYY-MM) — 같은 달 알림 한 번
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create table if not exists mkt_ad_plans (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  account_id uuid not null references mkt_ad_accounts(id) on delete cascade,
  provider text not null,                                -- naver
  kind text not null default 'powerlink',                -- powerlink · place
  name text not null,
  plan jsonb not null,                                   -- 세팅안(캠페인·그룹·키워드·소재)
  status text not null default 'draft' check (status in ('draft', 'created', 'active', 'paused', 'failed', 'archived')),
  external jsonb not null default '{}',                  -- 매체 쪽 id(campaignId·adgroupId·keywordIds·adIds)
  error text,
  created_by uuid references users(id) on delete set null,
  approved_by uuid references users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mkt_ad_plans_tenant on mkt_ad_plans (tenant, created_at desc);
create table if not exists mkt_ad_changes (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  plan_id uuid references mkt_ad_plans(id) on delete cascade,
  kind text not null,                                    -- create · enable · pause · budget · auto_pause
  before jsonb,
  after jsonb,
  money_up boolean not null default false,
  status text not null default 'applied' check (status in ('proposed', 'applied', 'failed', 'rejected')),
  error text,
  actor_id uuid references users(id) on delete set null, -- 승인·실행한 사람(자동 중지는 null)
  revert_of uuid references mkt_ad_changes(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists mkt_ad_changes_plan on mkt_ad_changes (plan_id, created_at desc);
