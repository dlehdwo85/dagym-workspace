-- V41 4-2 마케팅 운영실(KV) → 워크인 이관: 원본 그대로 회사별로 보관(멱등), 실행 기록(건수·해시 대조).
-- 표 매핑(게시물 → mkt_contents 등)은 실제 칸 이름을 미리보기로 확인한 뒤 다음 단계.
-- mkt:call-records:v1 은 전화번호(개인정보) → 마케팅 공간 관리자만 조회, 보관 기간 지나면 tick 이 삭제.
create table if not exists ops_import_runs (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  mode text not null check (mode in ('preview', 'apply')),
  status text not null default 'running' check (status in ('running', 'ok', 'mismatch', 'error')),
  frozen boolean,
  generated_at timestamptz,
  results jsonb not null default '[]',
  error text,
  started_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create table if not exists ops_import_items (
  tenant text not null,
  key text not null,
  idx int not null,
  item jsonb not null,
  run_id uuid references ops_import_runs(id) on delete set null,
  imported_at timestamptz not null default now(),
  primary key (tenant, key, idx)
);
