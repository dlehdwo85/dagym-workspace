-- 사이드바 "즐겨찾는 프로젝트" (사용자별)
create table if not exists project_favorites (
  user_id uuid not null references users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

