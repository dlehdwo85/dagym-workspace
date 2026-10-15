-- V30 P1 ① 엑셀·CSV 업무 가져오기: 한 번에 가져온 묶음(되돌리기용)
alter table tasks add column if not exists import_id uuid;
create index if not exists tasks_import_idx on tasks (import_id) where import_id is not null;
