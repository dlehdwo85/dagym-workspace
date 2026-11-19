-- 계약서 보관 · 만료일 관리 1단계 (대표 11/19 요청 · docs/contract-docs-design.md)
-- 지금 있는 '전자계약'(contracts — 서명 받는 도구)과는 따로: 맺은 계약을 보관하고 만료일로 챙긴다. 새 표만 만든다(기존 표는 건드리지 않음).
-- 대표 11/19 20시 방향: 종류별 전용 칸 없이 모든 회사 같은 칸 + 꼬리표 · 알림 받는 사람은 계약마다 · 알림 날짜 90·60·30·7(회사·계약별로 바꿈)
-- 되돌릴 때: drop table agreement_files, agreement_terms, agreements; alter table tenants drop column agreement_alert_days;

create table if not exists agreements (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  title text not null,
  counterparty text not null default '',            -- 상대방(글자)
  amount numeric(16, 0),                            -- 금액(원, 선택)
  owner_id uuid references users(id) on delete set null,        -- 담당자
  org_unit_id uuid references org_units(id) on delete set null, -- 소속(선택)
  tags text[] not null default '{}',                -- 꼬리표(종류 구분은 이것으로)
  memo text,
  start_date date,
  end_date date,                                    -- 만료일(비우면 기한 없는 계약 — 알림 없음)
  auto_renew boolean not null default false,        -- 자동 연장 계약
  notice_days int,                                  -- 해지 통보 기한(만료 n일 전) — 자동 연장 계약의 알림 기준일을 이 날로 당김
  alert_days int[],                                 -- 이 계약의 알림 날짜(비우면 회사 기본값)
  notify_user_ids uuid[] not null default '{}',     -- 알림 받는 사람(기본: 담당자 + 등록한 사람)
  review_task boolean not null default true,        -- 첫 알림 때 '[계약 갱신 검토]' 업무를 담당자에게 만들지
  review_task_id uuid references tasks(id) on delete set null,
  review_task_basis date,                           -- 그 업무를 만든 기준일(기간을 고치면 다시 만듦)
  notified jsonb not null default '{}'::jsonb,      -- 보낸 알림 { "<기준일>:<단계>": 보낸 때 }
  term_no int not null default 1,                   -- 지금 몇 번째 기간인지(갱신할 때마다 +1)
  status text not null default 'active' check (status in ('active', 'ended')),
  ended_at timestamptz,
  ended_reason text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists agreements_tenant on agreements(tenant, status, end_date) where deleted_at is null;

-- 기간 이력: 갱신할 때마다 지난 기간이 한 줄
create table if not exists agreement_terms (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  agreement_id uuid not null references agreements(id) on delete cascade,
  term_no int not null,
  start_date date,
  end_date date,
  amount numeric(16, 0),
  memo text,
  by_user uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (agreement_id, term_no)
);

-- 계약서 파일: 계약 관리 권한이 있는 사람만 연다(자료실과 따로 보관 — 자료실의 기밀 권한과 섞이지 않게). 회사 저장공간 한도에 함께 센다
create table if not exists agreement_files (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  agreement_id uuid not null references agreements(id) on delete cascade,
  term_no int not null default 1,
  storage_key text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint not null default 0,
  upload_status text not null default 'pending' check (upload_status in ('pending', 'ready')),
  by_user uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists agreement_files_agreement on agreement_files(tenant, agreement_id);

-- 회사 기본 알림 날짜(비우면 90·60·30·7)
alter table tenants add column if not exists agreement_alert_days int[];
