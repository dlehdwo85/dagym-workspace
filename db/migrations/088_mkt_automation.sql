-- V41 4-3 + V43: 마케팅 자동 제작(주간 규칙 → 제작 → 품질 검사 → 승인함 → 알림)과 상업화 준비(요금제·주/월 한도·재생성 횟수·크레딧 원장).
-- 금액은 대표 결정 전이라 저장하지 않음(요금제 표의 가격 칸은 코드에서 null).
create table if not exists mkt_settings (
  tenant text primary key references tenants(id) on delete cascade,
  plan_code text check (plan_code in ('basic', 'standard', 'pro')),
  monthly_credits numeric(10, 2),          -- null = 요금제 기본값
  weekly_credits numeric(10, 2),           -- null = 월 ÷ 4.3
  video_monthly int, regen_monthly int,    -- null = 요금제 기본값
  approval_hour int not null default 9 check (approval_hour between 0 and 23),       -- 승인 마감 = 게시 당일 HH:00
  lead_days int not null default 3 check (lead_days between 0 and 14),              -- 제작 = 게시 D-n
  lead_hour int not null default 13 check (lead_hour between 0 and 23),
  remind_hours int not null default 6 check (remind_hours between 0 and 72),        -- 마감 N시간 전 알림
  quiet_start int not null default 22 check (quiet_start between 0 and 23),
  quiet_end int not null default 8 check (quiet_end between 0 and 23),
  allow_generated_people boolean not null default false,
  allow_slideshow boolean not null default false,
  ai_label text not null default 'AI 도움을 받아 제작했습니다',
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
-- 브랜드 키트(V43 4): 톤·금지어·색
alter table mkt_brands add column if not exists tone text;
alter table mkt_brands add column if not exists banned_words text[] not null default '{}';
alter table mkt_brands add column if not exists colors text[] not null default '{}';
create table if not exists mkt_rules (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  brand_id uuid references mkt_brands(id) on delete cascade,
  channel text not null,
  kind text not null check (kind in ('feed', 'blog', 'reels', 'video')),
  weekdays int[] not null,                  -- 0=일 … 6=토
  post_time text not null default '10:00',  -- HH:MM(서울)
  topic_hint text,
  active boolean not null default true,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table mkt_contents add column if not exists rule_id uuid references mkt_rules(id) on delete set null;
alter table mkt_contents add column if not exists kind text;
alter table mkt_contents add column if not exists auto boolean not null default false;
alter table mkt_contents add column if not exists produce_at timestamptz;
alter table mkt_contents add column if not exists produced_at timestamptz;
alter table mkt_contents add column if not exists reminded_at timestamptz;
alter table mkt_contents add column if not exists quality jsonb;
create unique index if not exists mkt_contents_rule_slot on mkt_contents (rule_id, scheduled_at) where rule_id is not null;
-- 크레딧 원장(V43 5-4): 고객·게시물·버전별 모든 생성 기록
create table if not exists mkt_credit_ledger (
  id bigserial primary key,
  tenant text not null references tenants(id) on delete cascade,
  content_id uuid references mkt_contents(id) on delete set null,
  version int,
  kind text not null check (kind in ('generate_image', 'generate_video', 'regen_image', 'regen_video', 'text', 'adjust')),
  credits numeric(10, 2) not null default 0,
  note text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists mkt_credit_ledger_tenant on mkt_credit_ledger (tenant, created_at);
-- 제작 요청 카드: 이미지·영상(Higgsfield 계약 전까지 사람이 제작해 붙임)·재생성. 한도 넘으면 needs_approval
create table if not exists mkt_production_requests (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  content_id uuid not null references mkt_contents(id) on delete cascade,
  version int,
  kind text not null check (kind in ('image', 'video', 'regen_image', 'regen_video')),
  brief text not null default '',
  est_credits numeric(10, 2) not null default 0,
  status text not null default 'open' check (status in ('open', 'needs_approval', 'done', 'canceled')),
  reason text,
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mkt_production_requests_tenant on mkt_production_requests (tenant, status);
