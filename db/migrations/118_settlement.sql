-- V32 2 정산(플랫폼 운영): 결제 건별 정산 상태(입금 대사), 대사 파일 올린 기록, 세금계산서 요청 목록. 추가형만.
create table if not exists payment_settlements (
  payment_id uuid primary key references payments(id) on delete cascade,
  expected_on date,                         -- 정산 예정일(결제일 + 영업일, 추정)
  status text not null default 'pending' check (status in ('pending', 'settled', 'mismatch')),
  settled_on date,
  settled_amount int,                       -- PG 가 실제 입금한 금액
  pg_fee int,                               -- PG 가 알려준 수수료(없으면 추정치 사용)
  source text check (source is null or source in ('upload', 'manual')),
  note text,
  upload_id uuid,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists payment_settlements_status_idx on payment_settlements(status, expected_on);

create table if not exists settlement_uploads (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  rows int not null default 0,
  matched int not null default 0,
  mismatched int not null default 0,
  unmatched int not null default 0,         -- 파일에는 있는데 장부에 없는 줄
  unmatched_rows jsonb not null default '[]',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists tax_invoice_requests (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  payment_id uuid references payments(id) on delete set null,
  company_name text not null,
  biz_no text not null,
  ceo text,
  address text,
  email text not null,
  amount int,
  status text not null default 'requested' check (status in ('requested', 'issued', 'canceled')),
  issued_at timestamptz,
  note text,
  requested_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tax_invoice_requests_status_idx on tax_invoice_requests(status, created_at desc);
create unique index if not exists tax_invoice_requests_payment_uq on tax_invoice_requests(payment_id) where payment_id is not null and status <> 'canceled';
