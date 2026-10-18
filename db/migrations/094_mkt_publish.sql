-- 상용화 ⑤-1 게시 공통 구조(docs/research/MKT_PUBLISHING_DESIGN.md). 승인된 버전만 게시, 같은 콘텐츠·버전·계정은 한 번만.
-- 연결 계정: 서버 게시 연동(Meta·YouTube 또는 통합 게시 API)용 — 5-2 부터 씀. 토큰은 암호화(crypto.ts)해서만 저장
create table if not exists mkt_publish_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  provider text not null,                 -- meta_ig · meta_fb · youtube · relay(통합 게시 API) …
  external_id text not null,
  label text not null default '',
  brand_id uuid references mkt_brands(id) on delete set null,
  token_enc text,
  scopes text[] not null default '{}',
  expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'error', 'disconnected')),
  last_error text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant, provider, external_id)
);
-- 게시 작업(기록): 수동 게시(네이버 블로그 도우미·직접 올림)도 같은 표에 남김. verify = 결과가 모호해 이미 올라갔는지 확인 중(확인 전 재시도 금지)
create table if not exists mkt_publish_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  content_id uuid not null references mkt_contents(id) on delete cascade,
  version int not null,
  account_id uuid references mkt_publish_accounts(id) on delete set null,
  provider text not null,                 -- manual · naver_blog(도우미) · meta_ig …
  status text not null default 'queued' check (status in ('queued', 'running', 'verify', 'done', 'failed', 'canceled')),
  idempotency_key text not null unique,   -- content_id:version:(account_id|provider)
  external_post_id text,
  permalink text,
  attempts int not null default 0,
  last_error text,
  requested_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mkt_publish_jobs_content on mkt_publish_jobs (content_id);
