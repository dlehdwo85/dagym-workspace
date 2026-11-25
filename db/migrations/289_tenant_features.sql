-- #1181 상업화 마감 4번 · #1175 회사별 기능 켜기(설계 docs/research/COMMERCIAL_DESIGN_2026-11-26.md B): 기능 기본값은 코드(src/lib/features.ts)에,
-- 이 표에는 운영자·회사 관리자가 바꾼 값만 둔다(없으면 기본값 = 지금 동작). 추가형.
create table if not exists tenant_features (
  tenant text not null references tenants(id) on delete cascade,
  key text not null,              -- 'check' 같은 기능 이름 · 'beta:이름' = 회사별 베타 기능
  enabled boolean not null,
  note text,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant, key)
);
