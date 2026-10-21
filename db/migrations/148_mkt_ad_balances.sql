-- 대표 10/21 14:30 #411 광고비 충전 흐름: 매체 잔액(구글 선불·네이버 비즈머니·Meta 상한 잔여·Higgsfield) 보관.
-- API 로 읽을 수 있는 매체는 동기화 때 갱신(source=api), 못 읽는 매체는 관리자가 직접 입력(source=manual). 결제(충전) 자체는 대표가 매체 화면에서.
create table if not exists mkt_ad_balances (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  provider text not null,
  label text not null default '',
  account_id uuid references mkt_ad_accounts(id) on delete set null,
  balance_krw numeric(14, 2) not null default 0,
  currency text not null default 'KRW',
  source text not null default 'manual' check (source in ('manual', 'api')),
  checked_at timestamptz not null default now(),
  updated_by uuid references users(id) on delete set null,
  note text,
  unique (tenant, provider, label)
);
create index if not exists mkt_ad_balances_tenant_idx on mkt_ad_balances(tenant);
