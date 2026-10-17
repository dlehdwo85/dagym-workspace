-- V41 단계 4-2 마케팅 공간 핵심(대조표 B·F): 브랜드(회사별) · 콘텐츠·버전(수정본 = 새 버전 행) · 승인 결정(승인·수정 요청·보류, 버전 단위) · 전화 문의. 추가형.
create table if not exists mkt_brands (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  name text not null, color text not null default '#7C3AED',
  created_at timestamptz not null default now(),
  unique (tenant, name)
);
create table if not exists mkt_contents (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  brand_id uuid references mkt_brands(id) on delete set null,
  title text not null,
  channel text not null default 'instagram',   -- instagram·facebook·blog·youtube·naver_place·other
  scheduled_at timestamptz,                      -- 게시 예정
  status text not null default 'pending' check (status in ('draft', 'pending', 'approved', 'changes', 'hold', 'published', 'canceled')),
  current_version int not null default 0,
  approved_version int,
  published_url text, published_at timestamptz, published_by uuid references users(id) on delete set null,
  task_id uuid references tasks(id) on delete set null,   -- 요청 = 업무 카드
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists mkt_contents_tenant_idx on mkt_contents(tenant, scheduled_at);
create table if not exists mkt_versions (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references mkt_contents(id) on delete cascade,
  version int not null,
  body text not null default '',
  media_ids uuid[] not null default '{}',        -- 자료실 파일(시안 이미지·영상)
  note text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (content_id, version)
);
create table if not exists mkt_decisions (
  id bigserial primary key,
  content_id uuid not null references mkt_contents(id) on delete cascade,
  version int not null,
  decision text not null check (decision in ('approve', 'changes', 'hold')),
  comment text,
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz not null default now()
);
create table if not exists mkt_calls (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  brand_id uuid references mkt_brands(id) on delete set null,
  phone text not null,
  called_at timestamptz not null default now(),
  source text,                                   -- 어느 광고·페이지에서
  status text not null default 'new' check (status in ('new', 'lead', 'excluded')),
  memo text,
  task_id uuid references tasks(id) on delete set null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists mkt_calls_tenant_idx on mkt_calls(tenant, called_at desc);
