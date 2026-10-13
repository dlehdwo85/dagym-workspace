-- V9: 회사 자료실 + AI 비서 (추가형)
-- tenant: 상용화 대비 고객 회사 구분 키. 지금은 'default'(우리 회사) 하나. 저장 키 경로에도 들어간다.
create table if not exists library_files (
  id uuid primary key default gen_random_uuid(),
  tenant text not null default 'default',
  folder text not null default '',
  title text not null,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  storage_key text,
  upload_status text not null default 'pending' check (upload_status in ('pending','ready')),
  tags text[] not null default '{}',
  description text,
  text_content text,
  source text not null default 'upload',
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists library_files_tenant_idx on library_files(tenant, folder) where deleted_at is null;

-- AI 사용량 (요청 1회 = 1행). 비용은 모델 단가표로 계산한 추정 달러
create table if not exists ai_usage (
  id bigserial primary key,
  tenant text not null default 'default',
  user_id uuid references users(id) on delete set null,
  provider text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  cost_usd numeric(12,6) not null default 0,
  purpose text not null default 'assistant',
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_month_idx on ai_usage(tenant, created_at);

-- 고객 회사별 월 한도 (없으면 AI_MONTHLY_BUDGET_USD, 기본 30달러)
create table if not exists ai_limits (
  tenant text primary key,
  monthly_usd numeric(10,2) not null,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);

-- AI 제안(쓰기 작업): 사람이 확인해야 실행. 감사 기록 겸용
create table if not exists ai_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant text not null default 'default',
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  summary text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','done','cancelled','failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists ai_proposals_user_idx on ai_proposals(user_id, created_at desc);
