-- WORKIN_V2 7 (1단계): 현장별 월 매출·지출·회원 수. 본사만 열람·입력. 추가형.
create table if not exists revenue_entries (
  id uuid primary key default gen_random_uuid(),
  org_unit_id uuid not null references org_units(id),
  month date not null check (extract(day from month) = 1),
  revenue bigint not null default 0 check (revenue >= 0),
  expense bigint not null default 0 check (expense >= 0),
  members int check (members is null or members >= 0),
  target bigint check (target is null or target >= 0),
  note text,
  source text not null default 'manual' check (source in ('manual', 'csv', 'gpt')),
  source_file text,
  created_by uuid references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_unit_id, month)
);
create index if not exists revenue_entries_month on revenue_entries(month);
