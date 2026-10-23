-- #450 영업실 '지원사업'(2026-10-23). 추가형.
-- 지원사업 공고 — 수집한 것은 공용 1벌(tenant null), 회사가 직접 넣은 것(지난 신청 이력 등)은 그 회사만(tenant 값)
create table if not exists support_programs (
  id uuid primary key default gen_random_uuid(),
  tenant text references tenants(id) on delete cascade,
  source text not null check (source in ('bizinfo', 'kstartup', 'watch', 'manual')),
  source_id text not null,
  title text not null,
  agency text,                 -- 소관 기관
  executor text,               -- 수행 기관
  category text,               -- 지원 분야(기술·금융·인력·수출·내수·창업·경영 …)
  target text,                 -- 지원 대상(원문)
  regions text[] not null default '{}',  -- 시·도(전국이면 빈 배열 + nationwide)
  nationwide boolean not null default false,
  summary text,                -- 사업 개요(태그 뺀 글)
  apply_start date,
  apply_end date,
  apply_text text,             -- 신청 기간 원문(상시·예산 소진 시 등)
  amount text,                 -- 지원 규모(원문)
  biz_years text,              -- 업력 조건 원문(예: 3년미만,5년미만)
  url text,
  apply_url text,
  attachments jsonb not null default '[]',
  hashtags text[] not null default '{}',
  raw jsonb,
  hash text,                   -- 바뀜 확인용(주요 칸)
  posted_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references users(id) on delete set null,
  unique (source, source_id)
);
create index if not exists support_programs_end on support_programs (apply_end);
create index if not exists support_programs_seen on support_programs (first_seen_at desc);
create index if not exists support_programs_tenant on support_programs (tenant) where tenant is not null;

-- 회사 지원사업 프로필 — 맞춤(지역·업력·규모·관심 분야)과 AI 판단의 근거. 회사마다 1행
create table if not exists support_profiles (
  tenant text primary key references tenants(id) on delete cascade,
  region_sido text,            -- 본점 시·도(예: 경기)
  region_sigungu text,         -- 본점 시·군·구(예: 용인시)
  founded date,                -- 설립일(업력)
  size text,                   -- 예비창업·소상공인·소기업·중기업·중견기업
  employees int,               -- 상시 근로자 수
  revenue_krw bigint,          -- 최근 연 매출(선택)
  industries text[] not null default '{}',
  keywords text[] not null default '{}',
  certs text[] not null default '{}',     -- 벤처·이노비즈·메인비즈·기업부설연구소·여성기업 …
  brands text[] not null default '{}',    -- 브랜드·사업부
  interests text[] not null default '{}', -- IP·R&D·수출·고용·SaaS·마케팅 …
  excludes text[] not null default '{}',  -- 빼는 낱말
  memo text,                   -- AI 에 함께 주는 회사 소개(짧게)
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- 회사별 AI 판단(✅/⚠/❌ + 이유·맞는 브랜드·준비 서류)·숨김
create table if not exists support_matches (
  tenant text not null references tenants(id) on delete cascade,
  program_id uuid not null references support_programs(id) on delete cascade,
  ai_verdict text check (ai_verdict in ('fit', 'maybe', 'no')),
  ai_reasons jsonb not null default '[]',
  ai_brands text[] not null default '{}',
  ai_docs jsonb not null default '[]',
  ai_summary text,
  ai_amount text,
  ai_model text,
  ai_cost_usd numeric,
  ai_by uuid references users(id) on delete set null,
  ai_at timestamptz,
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (tenant, program_id)
);

-- 회사별 진행 — 관심 → 신청 준비 → 신청 → 선정/탈락(또는 포기). 담당 업무(체크리스트)·마감 7일·3일 전 알림
create table if not exists support_work (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  program_id uuid not null references support_programs(id) on delete cascade,
  status text not null default 'interest' check (status in ('interest', 'preparing', 'applied', 'selected', 'rejected', 'dropped')),
  owner_id uuid references users(id) on delete set null,
  task_id uuid references tasks(id) on delete set null,
  brands text[] not null default '{}',
  applied_at date,
  result_at date,
  amount_awarded text,
  result_memo text,
  memo text,
  remind7_at timestamptz,
  remind3_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (tenant, program_id)
);
create index if not exists support_work_state on support_work (status);
create table if not exists support_work_log (
  id bigserial primary key,
  work_id uuid not null references support_work(id) on delete cascade,
  from_status text,
  to_status text not null,
  note text,
  changed_by uuid references users(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists support_work_log_work on support_work_log (work_id, changed_at desc);
