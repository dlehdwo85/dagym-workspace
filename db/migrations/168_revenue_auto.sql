-- #161 V25 매출 자료 자동 분석 (2026-10-15 대표 지시, 2026-10-22). 추가형.
-- 자료실에 매출 자료가 올라오면 숫자를 읽어 '확인 대기'로 두고, 매출 권한자가 [확정]하면 같은 달 자료를 10분 모아 1번 분석한다.

-- 올라온 매출 자료 1건 = 1행. 확정 전에는 revenue_entries 에 반영하지 않는다(잘못 읽은 숫자가 실적이 되지 않게)
create table if not exists revenue_imports (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  file_id uuid references library_files(id) on delete set null,   -- 근거 파일(자료실)
  file_name text not null default '',
  detected_by text not null default 'name' check (detected_by in ('folder', 'name', 'content')),
  status text not null default 'queued' check (status in ('queued', 'extracting', 'pending', 'confirmed', 'dismissed', 'failed', 'empty')),
  rows jsonb not null default '[]'::jsonb,                        -- AI 가 읽은 항목 [{site, month, item, amount}]
  notes text,                                                     -- AI 메모(애매한 칸)
  error text,
  attempts int not null default 0,
  locked_until timestamptz,
  applied jsonb,                                                  -- 확정 때 반영한 내용 {count, months, edited}
  created_by uuid references users(id) on delete set null,        -- 올린 사람
  decided_by uuid references users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists revenue_imports_file on revenue_imports(file_id) where file_id is not null;
create index if not exists revenue_imports_tenant on revenue_imports(tenant, status, created_at desc);

-- 같은 달 분석 대기열: 첫 확정 뒤 10분 모아 1번 (tenant, period) 하나
create table if not exists revenue_analysis_queue (
  tenant text not null references tenants(id) on delete cascade,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  run_after timestamptz not null,
  import_ids uuid[] not null default '{}',
  file_ids uuid[] not null default '{}',
  attempts int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  primary key (tenant, period)
);

-- 분석 보고서: 회사 구분·종류(자동/직접/종합)·서버 계산값·근거 파일
alter table revenue_ai_reports add column if not exists tenant text references tenants(id) on delete cascade;
update revenue_ai_reports set tenant = 'default' where tenant is null and exists (select 1 from tenants where id = 'default');
alter table revenue_ai_reports add column if not exists kind text not null default 'manual';
alter table revenue_ai_reports add column if not exists stats jsonb;
alter table revenue_ai_reports add column if not exists file_ids uuid[] not null default '{}';
create index if not exists revenue_ai_reports_tenant on revenue_ai_reports(tenant, created_at desc);
