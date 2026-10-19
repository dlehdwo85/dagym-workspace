-- 로컬 10/19(대표): 영업 출처는 회사·업종마다 다름 — 추천 목록 밖 출처(사이트·키워드·엑셀)를 회사가 직접 추가. 자동 수집 대상은 아니고 영업 출처 목록·메모용
create table if not exists sales_custom_sources (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('site', 'keyword', 'excel')),
  label text not null,
  value text,
  note text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists sales_custom_sources_tenant on sales_custom_sources (tenant, created_at);
