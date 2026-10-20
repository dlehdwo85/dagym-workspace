-- 대표 10/20 오후 4): 메뉴 권한 '팀 업무 보기' = 전체(team_tasks_all) / 자기 팀만 / 지정 팀 — 지정 팀은 사람별로 볼 수 있는 팀 목록(조회). 격리 팀원은 자기 팀만(이 표가 있어도 넓어지지 않음)
create table if not exists team_view_grants (
  user_id uuid not null references users(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (user_id, team_id)
);
