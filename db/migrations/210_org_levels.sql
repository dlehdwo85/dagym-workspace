-- P2 조직 개편(대표 확정 10/26, #679~#681): 본사 › 사업부 › 부서 › 팀 4단 + 업무 '함께하는 부서'(부서 간 협업)
-- 종류: hq(본사, 회사에 1곳·맨 위) · division(사업부, 본사 아래) · dept(부서) · team(팀, 아래 조직 없음). 기존 dept·team 은 그대로.
-- 종류 검사 제약은 108 에서 이름 없이 만들어 자동 이름(teams_kind_check) — 이름이 달라도 kind 검사 제약은 모두 지우고 새로 만든다
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'teams'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%' loop
    execute format('alter table teams drop constraint %I', c);
  end loop;
end $$;
alter table teams add constraint teams_kind_check check (kind in ('hq', 'division', 'dept', 'team'));
create unique index if not exists teams_one_hq_uq on teams(tenant) where kind = 'hq' and not archived;

-- 함께하는 부서: 업무에 붙이면 그 부서(팀) 구성원과 그 위 단위가 같이 본다(주관 부서 = tasks.team_id 그대로)
create table if not exists task_teams (
  task_id uuid not null references tasks(id) on delete cascade,
  team_id uuid not null references teams(id) on delete cascade,
  added_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (task_id, team_id)
);
create index if not exists task_teams_team_idx on task_teams(team_id);
