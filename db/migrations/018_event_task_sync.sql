-- V5 일정 ↔ 업무 연동: "업무에도 추가"로 만든 연결은 날짜를 서로 맞춘다 (추가형)
alter table event_tasks add column if not exists sync boolean not null default false;
create index if not exists event_tasks_sync_idx on event_tasks(task_id) where sync;
