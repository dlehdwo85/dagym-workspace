-- #1139(대표 11/24 '업무관리는 상담 없이, 영업·마케팅은 문의 → 상담 후 사용(잠금 표기)'): 영업·마케팅 상담 신청 (추가형)
-- 회사 관리자가 잠긴 공간의 [상담 신청]을 보내면 플랫폼 운영자에게 알림 → 운영자가 회사 상세에서 [영업 열기]·[마케팅 열기](감사 기록)
create table if not exists space_consults (
  id uuid primary key default gen_random_uuid(),
  tenant text not null references tenants(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  spaces text[] not null,
  name text,
  phone text,
  email text,
  memo text,
  status text not null default 'requested' check (status in ('requested', 'opened', 'closed')),
  handled_by uuid references users(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists space_consults_tenant_idx on space_consults (tenant, created_at desc);
create index if not exists space_consults_open_idx on space_consults (created_at desc) where status = 'requested';
