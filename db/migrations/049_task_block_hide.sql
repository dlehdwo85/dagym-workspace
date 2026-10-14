-- 대표 지시(2026-10-15): 삭제된 업무의 "업무 시간" 블록은 캘린더에서 사라지게. 추가형.
-- hidden_by_task: 업무를 지울 때 함께 숨긴 블록(그 업무를 되살리면 함께 복원)
alter table events add column if not exists hidden_by_task uuid;
create index if not exists events_hidden_by_task_idx on events (hidden_by_task) where hidden_by_task is not null;
-- 기존 데이터 정리: 이미 삭제된 업무에 딸린 업무 시간 블록 숨김
update events e set deleted_at = now(), hidden_by_task = t.id
  from tasks t
  where e.kind = 'task_block' and e.deleted_at is null and t.deleted_at is not null
    and (e.task_id = t.id or exists (select 1 from event_tasks et where et.event_id = e.id and et.task_id = t.id and et.role = 'block'));
