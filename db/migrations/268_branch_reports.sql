-- #1096 지점 주간보고(다짐 전용 — 대표 #1097, 스위치 BRANCH_REPORT_TENANTS 기본 다짐만) 1단계. 새 표만 만든다(기존 표는 건드리지 않음). 다른 회사는 비어 있음.
-- 설계 docs/branch-report-design.md · 대표 결정(11/21): 원본 파일은 저장하지 않고 가린 메시지만, 제출 30일 뒤 삭제 · 앱 안 강제 고지 없음(처리방침만)
-- 되돌릴 때: drop table branch_reports, branch_chat_messages, branch_chat_uploads, branch_sites;

-- 보고 지점 목록(기능 안의 별도 목록 — 로컬 확인 11/21: 다짐 조직 단위에는 지점이 없고, 다짐 세팅은 바꾸지 않음)
-- 이름 · 숨김(시험·대표 확인 중 지점) · 작성 담당(지점 관리자, 자기 지점만) · 검토 담당(전체 지점을 봄)
create table if not exists branch_sites (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  name text not null,
  hidden boolean not null default false,
  sort int not null default 0,
  writer_user_id uuid references users(id) on delete set null,
  reviewer_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant, name)
);

-- 올린 대화 파일 묶음(파일 자체는 저장 안 함 — 몇 건·기간만)
create table if not exists branch_chat_uploads (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  site_id uuid not null references branch_sites(id) on delete cascade,
  uploaded_by uuid references users(id) on delete set null,
  from_day date, to_day date,
  added int not null default 0, duplicates int not null default 0, skipped int not null default 0,
  created_at timestamptz not null default now()
);

-- 가린 메시지(전화·동호수·주민번호·계좌·카드·차량·이메일 → 표시). 같은 지점 안에서 같은 메시지(시각·보낸 사람·내용)는 한 번
create table if not exists branch_chat_messages (
  id bigserial primary key,
  tenant text not null,
  site_id uuid not null references branch_sites(id) on delete cascade,
  upload_id uuid references branch_chat_uploads(id) on delete set null,
  at timestamp not null,            -- 대화의 서울 시각(시간대 없이 그대로)
  sender text not null,
  text text not null,
  key text not null,
  created_at timestamptz not null default now(),
  unique (site_id, key)
);
create index if not exists branch_chat_messages_unit_at on branch_chat_messages (site_id, at);

-- 주간보고(1단계) — 기간 = 지난 금요일 ~ 목요일, 보고일 = 금요일(11:00 기준). 본문은 양식 구조(jsonb), 붙여 넣은 글은 가린 뒤 보관(제출 30일 뒤 지움)
create table if not exists branch_reports (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  site_id uuid not null references branch_sites(id) on delete cascade,
  kind text not null default 'weekly' check (kind in ('weekly', 'monthly')),
  period_start date not null,
  period_end date not null,
  report_day date not null,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  source_text text,
  body jsonb not null default '{}',
  ai_model text,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  submitted_by uuid references users(id) on delete set null,
  submitted_at timestamptz,
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, kind, report_day)
);
create index if not exists branch_reports_tenant on branch_reports (tenant, report_day desc);
