-- V41 단계 2 전환 T-1(docs/research/SALES_CUTOVER_PLAN.md): 쓰기용 정식 표(추가형) + 전환 기록. 쓰기는 sales_cutover.writes_open = true 일 때만(T-5).
create table if not exists sales_cutover (
  tenant text primary key references tenants(id) on delete cascade,
  frozen_at timestamptz,            -- 동결 시점 원본 건수를 읽은 때
  src_counts jsonb,                 -- {표: 건수} + related(관련 공고) — 대조 기준(V39 E 숫자는 참고만)
  converted_at timestamptz,
  dst_counts jsonb,
  ok boolean not null default false,
  mismatches jsonb,
  writes_open boolean not null default false,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
-- 리드(회사별): 쓰기에 쓰는 칸은 정식 칸, 원본 행 전체는 src 로 보관
create table if not exists sales_leads (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  src_id text,
  name text not null,
  status text,
  priority text,
  facility_type text,
  region text,
  owner_id uuid references users(id) on delete set null,
  next_contact_date date,
  contact_name text,
  phone text,
  expected_revenue numeric(16, 2),
  memo text,
  src jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant, src_id)
);
create index if not exists sales_leads_tenant on sales_leads (tenant, status);
-- 리드에 딸린 기록(상담·제안·계약·시점·관심 사업·비용) — kind = 원본 표 이름
create table if not exists sales_lead_records (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  kind text not null,
  src_id text,
  lead_id uuid references sales_leads(id) on delete cascade,
  occurred_at timestamptz,
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (tenant, kind, src_id)
);
-- 공용 수집 데이터에 대한 회사별 진행(입찰 진행 opportunity_work · 공고/시설/협력사 진행 칸) — src_tbl = 원본 표(또는 <표>__progress)
create table if not exists sales_work_records (
  tenant text not null references tenants(id) on delete cascade,
  src_tbl text not null,
  src_id text not null,
  ref_id text,                      -- 공고·시설·협력사 원본 id
  status text,
  lead_id uuid references sales_leads(id) on delete set null,
  data jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (tenant, src_tbl, src_id)
);
-- 상태 변경 기록(보류·실패는 사유 필수 — V39 D)
create table if not exists sales_status_log (
  id bigserial primary key,
  tenant text not null references tenants(id) on delete cascade,
  lead_id uuid not null references sales_leads(id) on delete cascade,
  from_status text, to_status text not null, reason text,
  changed_by uuid references users(id) on delete set null,
  changed_at timestamptz not null default now()
);
