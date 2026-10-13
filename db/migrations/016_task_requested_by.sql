-- WORKIN_V3: 지시자(업무를 부여한 사람). 기본값 = 만든 사람. 추가형.
alter table tasks add column if not exists requested_by uuid references users(id);
update tasks set requested_by = created_by where requested_by is null;
create index if not exists tasks_requested_by on tasks(requested_by) where deleted_at is null;
