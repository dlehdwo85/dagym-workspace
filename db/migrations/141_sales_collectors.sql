-- 대표 10/21 08:45(S1 맨 앞): 영업 수집기 12개 이식 + 당일 입찰 다이제스트 + 맞춤 설정 + 낙찰 결과.
-- 수집 결과는 기존 공용 복사 표(sales_src_rows, scope='global')에 같은 모양(JSON)으로 쌓아 화면·허브가 그대로 읽는다.
-- origin='workin' 행은 매일 복사(migrate.ts)가 '원본에서 사라짐'으로 표시하지 않는다.
alter table sales_src_rows add column if not exists origin text not null default 'src';
create index if not exists sales_src_rows_ext_key on sales_src_rows (tbl, (row->>'source_type'), (row->>'source_external_id'));
create index if not exists sales_src_rows_first_seen on sales_src_rows (tbl, (row->>'first_seen_at'));
create index if not exists sales_src_rows_dedupe on sales_src_rows ((row->>'dedupe_key')) where tbl = 'operating_facility_prospects';

-- 수집기 실행 이력(원본 data_source_run 역할)
create table if not exists sales_collector_runs (
  id bigserial primary key,
  slug text not null,
  trigger text not null default 'cron',          -- cron | manual
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'failed', 'skipped')),
  inserted int not null default 0, updated int not null default 0, unchanged int not null default 0, errors int not null default 0,
  error_log text, summary text, provider_mode text
);
create index if not exists sales_collector_runs_slug on sales_collector_runs (slug, started_at desc);
-- 회사별 수집기 켜기/끄기(수집 자체는 공용 — 끄면 그 회사의 다이제스트·오늘 새 공고에서 제외)
create table if not exists sales_collector_settings (
  tenant text not null references tenants(id) on delete cascade,
  slug text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (tenant, slug)
);
-- 플랫폼 공용: 수집기 전체 켜기/끄기·마지막 실행
create table if not exists sales_collector_state (
  slug text primary key,
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_status text,
  updated_at timestamptz not null default now()
);
-- 회사별 맞춤 설정(21라인 관심검색어·제외어·지역·발주처·물품(업종) 코드) + 당일 다이제스트 설정
create table if not exists sales_bid_prefs (
  tenant text primary key references tenants(id) on delete cascade,
  keywords text[] not null default '{}',
  excludes text[] not null default '{}',
  regions text[] not null default '{}',
  issuers text[] not null default '{}',
  item_codes text[] not null default '{}',
  amount_min numeric(16,0), amount_max numeric(16,0),
  digest_enabled boolean not null default true,
  digest_hour int not null default 8 check (digest_hour between 0 and 23),
  digest_mail boolean not null default true,
  digest_to uuid[] not null default '{}',        -- 비면 영업 공간의 대표·관리자
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
-- 보낸 다이제스트(하루 1건, 영업 홈 '오늘 새 공고' 카드·기록)
create table if not exists sales_digests (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  day date not null,
  items jsonb not null default '[]'::jsonb,      -- [{id,title,issuer,region,deadline,url,fit,kind:new|amend|cancel,estimated,attachments}]
  counts jsonb not null default '{}'::jsonb,
  mailed int not null default 0, notified int not null default 0,
  created_at timestamptz not null default now(),
  unique (tenant, day)
);
