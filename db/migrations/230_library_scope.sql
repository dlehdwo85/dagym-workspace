-- 292차 #804·#814(대표 10/29 결정): 자료실 '회사 전체 · 우리 팀 · 내 파일'
-- 업무 공간 자료실에 사람이 직접 올리는 파일에만 씀. 기존 파일은 모두 회사 전체(company)로 남고, 사람이 옮길 때만 바뀜
alter table library_files add column if not exists scope text not null default 'company';
alter table library_files add column if not exists team_id uuid references teams(id) on delete set null;
do $$ begin
  alter table library_files add constraint library_files_scope_check check (scope in ('company', 'team', 'mine'));
exception when duplicate_object then null; end $$;
create index if not exists library_files_scope_idx on library_files (tenant, scope, team_id) where deleted_at is null and scope <> 'company';

-- 팀·내 파일의 빈 폴더(회사 폴더 library_folders 와 따로 — 같은 이름이어도 섞이지 않게)
create table if not exists library_scope_folders (
  tenant text not null,
  scope text not null check (scope in ('team', 'mine')),
  team_id uuid references teams(id) on delete cascade,
  owner_id uuid references users(id) on delete cascade,
  path text not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists library_scope_folders_uq on library_scope_folders
  (tenant, scope, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), path);
