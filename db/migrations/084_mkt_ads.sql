-- V41 4-2 광고 성과 읽기(회사별 직접 연결 — Windsor 등 중개 없음). 읽기 전용: 광고 변경 기능 없음.
-- 비밀값(네이버 비밀키·OAuth 토큰)은 secret_enc 에 AES-256-GCM 암호문으로만, 화면·API 로 돌려주지 않음.
create table if not exists mkt_ad_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  provider text not null check (provider in ('naver', 'google', 'meta')),
  external_id text not null,            -- 네이버 CUSTOMER_ID · Google 고객 ID(숫자만) · Meta act_ 뒤 숫자
  label text not null,
  brand_id uuid references mkt_brands(id) on delete set null,
  secret_enc text,
  status text not null default 'active' check (status in ('active', 'error', 'disconnected')),
  last_sync_at timestamptz,
  last_error text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant, provider, external_id)
);
create table if not exists mkt_ad_stats (
  account_id uuid not null references mkt_ad_accounts(id) on delete cascade,
  day date not null,
  campaign_id text not null,
  campaign_name text not null default '',
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  cost_krw numeric(14, 2) not null default 0,
  conversions numeric(12, 2) not null default 0,
  currency text not null default 'KRW',
  updated_at timestamptz not null default now(),
  primary key (account_id, day, campaign_id)
);
create index if not exists mkt_ad_stats_day on mkt_ad_stats (day);
-- OAuth 연결 시작 상태(15분)
create table if not exists mkt_ad_oauth_states (
  state text primary key,
  user_id uuid not null references users(id) on delete cascade,
  tenant text not null,
  provider text not null,
  created_at timestamptz not null default now()
);
