-- #1181 상업화 마감 3번(설계 docs/research/COMMERCIAL_DESIGN_2026-11-26.md A): 회사가 직접 넣는 수집 원천(게시판·RSS 주소) — 회사 전용 표.
-- 공용 공고 줄(sales_src_rows)에는 넣지 않는다(다짐·다른 회사 목록과 섞이지 않고, 영업 쓰기 전환 규칙도 그대로). 추가형.
create table if not exists sales_watch_sources (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  label text not null,
  url text not null,
  words text[] not null default '{}',      -- 찾을 낱말(비우면 게시일 있는 글 모두)
  status text not null default 'new',      -- new · ok · failed(3번 연속 실패) · blocked(사이트가 수집 금지)
  fail_count int not null default 0,
  last_error text,                          -- 운영자용(고객 화면에는 상태만)
  last_checked_at timestamptz,
  last_ok_at timestamptz,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists sales_watch_sources_tenant_idx on sales_watch_sources (tenant) where deleted_at is null;

create table if not exists sales_watch_items (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  source_id uuid not null references sales_watch_sources(id) on delete cascade,
  title text not null,
  url text not null,
  posted_date date,
  first_seen_at timestamptz not null default now(),
  task_id uuid references tasks(id) on delete set null,
  unique (source_id, url, title)
);
create index if not exists sales_watch_items_tenant_idx on sales_watch_items (tenant, first_seen_at desc);
