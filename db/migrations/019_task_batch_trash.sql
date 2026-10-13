-- V6 13번: 담당자 여러 명에게 같은 업무를 각자 1건씩 — 같은 묶음(batch_id)으로 연결 (추가형)
alter table tasks add column if not exists batch_id uuid;
create index if not exists tasks_batch_idx on tasks(batch_id) where batch_id is not null;
-- V6 11번: 휴지통(삭제 후 30일 복원) 조회용
create index if not exists tasks_deleted_idx on tasks(deleted_at) where deleted_at is not null;
