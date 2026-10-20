-- 대표 10/20 20:00 ①②③: AI 마케터 운영실 승인 카드(제안/분석/계획) · 채널별 월 광고 예산 계획 · 월 매출 목표
create table if not exists mkt_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('direction', 'collab', 'influencer', 'analysis', 'plan')),
  title text not null,
  summary text not null default '',
  body jsonb not null default '{}'::jsonb,        -- {items[{title, detail, expected?, cost?}], rationale, numbers}
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'done')),
  source text not null default 'ai' check (source in ('ai', 'template', 'user')),
  month text,
  decision_note text,
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  executed jsonb,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mkt_proposals_tenant on mkt_proposals (tenant, status, created_at desc);
create table if not exists mkt_ad_budgets (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  plan jsonb not null default '[]'::jsonb,        -- [{provider, label, monthly, daily, note, connected}]
  total bigint not null default 0,
  rationale text,
  source text not null default 'ai' check (source in ('ai', 'template', 'user')),
  executed jsonb,                                 -- 승인 뒤 집행 결과 [{provider, planId, dailyBudget, ok, error}]
  alerted jsonb not null default '{}'::jsonb,     -- 충전 알림 보낸 채널 {provider: ISO}
  approved_by uuid references users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant, month)
);
create table if not exists mkt_revenue_goals (
  tenant text not null references tenants(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  target bigint not null default 0,
  note text,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant, month)
);
