-- 대표 10/23 11:30 #475 업무 공동 배정: 한 업무에 담당자 여러 명.
-- tasks.assignee_id 는 그대로 '주 담당'(기존 화면·알림·통계 호환), 함께 맡은 사람(공동 담당)은 이 표 — 주 담당은 넣지 않는다.
-- 담당자별 확인(acked_at)·내 몫 완료(done_at). 완료 규칙 tasks.complete_rule: primary = 주 담당이 완료하면 끝, all = 공동 담당이 모두 '내 몫 완료'해야 주 담당이 완료할 수 있음.
create table if not exists task_assignees (
  task_id uuid not null references tasks(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  added_by uuid references users(id) on delete set null,
  added_at timestamptz not null default now(),
  acked_at timestamptz,
  done_at timestamptz,
  primary key (task_id, user_id)
);
create index if not exists task_assignees_user on task_assignees (user_id);

alter table tasks add column if not exists complete_rule text not null default 'primary' check (complete_rule in ('primary', 'all'));

-- 공동 담당이던 사람이 주 담당이 되면(재배정·넘기기·퇴사 인수인계 등 어느 경로든) 공동 담당 줄은 지운다 — 한 사람이 두 번 들어가지 않게
create or replace function task_assignees_dedupe() returns trigger language plpgsql as $$
begin
  if new.assignee_id is not null then
    delete from task_assignees where task_id = new.id and user_id = new.assignee_id;
  end if;
  return null;
end $$;
drop trigger if exists task_assignees_dedupe on tasks;
create trigger task_assignees_dedupe after update of assignee_id on tasks for each row execute function task_assignees_dedupe();
