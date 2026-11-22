-- #1115(대표 11/22) 하이링크 회원목록: 이용권명별 이용권/수강권 분류 — 회사 전체에서 기억
-- name_key = 띄어쓰기를 뺀 이용권명('여자독서실' = '여자 독서실'). 처음 보는 이름은 기본 규칙으로 넣고 confirmed = false('새 이름 — 분류 확인')
create table if not exists branch_pass_kinds (
  tenant text not null,
  name_key text not null,
  name text not null,
  kind text not null check (kind in ('use', 'class')),
  confirmed boolean not null default false,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant, name_key)
);
