-- 361차(대표 #977): 업무를 지울 때 함께 지운 연결 일정 — 업무를 되살리면(되돌리기·휴지통) 이 기록대로 일정도 되살린다.
-- occurrence_start 가 있으면 반복 일정의 그 회차만 지운 것(되살리면 제외 날짜에서 뺌). 일정 휴지통에서 따로 되살려도 된다(restored_at 은 업무 쪽 복원 표시).
create table if not exists task_event_deletions (
  id bigserial primary key,
  task_id uuid not null references tasks(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  occurrence_start timestamptz,
  deleted_by uuid references users(id) on delete set null,
  deleted_at timestamptz not null default now(),
  restored_at timestamptz
);
create index if not exists task_event_deletions_task_idx on task_event_deletions (task_id) where restored_at is null;
