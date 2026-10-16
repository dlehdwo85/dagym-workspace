-- V41 단계 1 공간 틀(업무·영업·마케팅): 회사가 켠 공간 + 사람별 공간 배정(멤버십 — 기존 memberships 는 현장·부서 소속이라 이름을 space_members 로). 추가형.
-- 업무 공간은 늘 켜짐·전원. 영업·마케팅은 관리자가 켜고(가격은 대표 결정 전 — 켜기/끄기만), 직원은 배정된 공간만. 관리자는 켠 공간 전부.
alter table tenants add column if not exists spaces text[] not null default '{work}';
create table if not exists space_members (
  user_id uuid not null references users(id) on delete cascade,
  tenant text not null references tenants(id) on delete cascade,
  spaces text[] not null default '{work}',
  role text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, tenant)
);
create index if not exists space_members_tenant_idx on space_members(tenant);
-- 기존 사람은 업무 공간만(기본값)
insert into space_members (user_id, tenant, spaces, role) select id, tenant, '{work}', role from users on conflict do nothing;
