-- V14 8번: 팀(업무 묶음). 조직 구성(org_units: 본사·지점·현장 — 데이터 접근 범위)과 별개. 한 사람이 여러 팀 가능 (추가형)
create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  tenant text not null default 'default',
  name text not null,
  color text not null default '#0F766E',
  archived boolean not null default false,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists teams_name_idx on teams(tenant, name) where not archived;
create table if not exists team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  is_lead boolean not null default false,
  added_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index if not exists team_members_user_idx on team_members(user_id);
alter table tasks add column if not exists team_id uuid references teams(id) on delete set null;
create index if not exists tasks_team_idx on tasks(team_id) where team_id is not null and deleted_at is null;
-- 팀 대화방
alter table chat_rooms add column if not exists team_id uuid references teams(id) on delete cascade;
alter table chat_rooms drop constraint if exists chat_rooms_kind_check;
alter table chat_rooms add constraint chat_rooms_kind_check check (kind in ('dm','group','company','task','team'));
create unique index if not exists chat_rooms_team_idx on chat_rooms(team_id) where team_id is not null;
