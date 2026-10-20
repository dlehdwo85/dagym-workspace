-- 대표 10/20 18:00 ①②: 콘텐츠 근거(목적·목표 지표·핵심 메시지·왜) + 월 운영 목표(AI 25일 초안 → 대표 승인 → 주간 주제 달력 → 월요일 주간 리뷰 → 월말 결산)
alter table mkt_contents add column if not exists rationale jsonb;
create table if not exists mkt_goals (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  brand_id uuid references mkt_brands(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  status text not null default 'pending' check (status in ('draft', 'pending', 'approved', 'closed')),
  goals jsonb not null default '{}'::jsonb,     -- {objectives[], message, targets{posts, inquiries, adBudget}, channels[]}
  weekly jsonb not null default '[]'::jsonb,    -- [{week, from, to, topic, channels[], kinds[], note}]
  reviews jsonb not null default '[]'::jsonb,   -- [{week, at, numbers, summary}]
  closing jsonb,
  source text not null default 'ai' check (source in ('ai', 'template', 'user')),
  created_by uuid references users(id) on delete set null,
  approved_by uuid references users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists mkt_goals_uq on mkt_goals (tenant, coalesce(brand_id::text, ''), month);
