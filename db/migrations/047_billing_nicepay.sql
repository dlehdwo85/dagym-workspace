-- 18차: 나이스페이 결제 — 정기구독(빌키), 연간·팩 단건(인증결제), 결제통보(웹훅), 실패 재시도·유예, 환불. 추가형.
-- 카드번호는 저장하지 않는다(빌키 발급 요청에만 암호화해 쓰고 버림). 빌키는 앱 비밀키로 다시 암호화해 보관.
create table if not exists billing_cards (
  tenant text primary key references tenants(id),
  bid_enc text not null,
  card_name text,
  card_last4 text,
  card_code text,
  registered_by uuid references users(id),
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
alter table tenant_subscriptions add column if not exists billing_cycle text check (billing_cycle in ('monthly', 'annual'));
alter table tenant_subscriptions add column if not exists next_billing_on date;
alter table tenant_subscriptions add column if not exists billing_amount int;
alter table tenant_subscriptions add column if not exists cancel_at_period_end boolean not null default false;
alter table tenant_subscriptions add column if not exists past_due_since timestamptz;
alter table tenant_subscriptions add column if not exists retry_count int not null default 0;
alter table tenant_subscriptions add column if not exists next_retry_on date;

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id),
  kind text not null check (kind in ('subscription', 'annual', 'addon')),
  plan_code text,
  addon_code text,
  moid text not null unique,              -- 우리 주문번호(멱등 기준)
  tid text,
  amount int not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'canceled', 'partial_canceled')),
  canceled_amount int not null default 0,
  result_code text,
  result_msg text,
  card_name text,
  card_no text,                           -- 마스킹된 번호만(예: 12345678****1234)
  auth_code text,
  paid_at timestamptz,
  meta jsonb not null default '{}',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists payments_tenant_idx on payments (tenant, created_at desc);
create table if not exists payment_notifications (
  id bigserial primary key,
  tid text,
  moid text,
  state text,
  result_code text,
  amount int,
  matched boolean not null default false,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  unique (tid, state)
);
