-- V38 4 업무 첨부 → 자료실 자동 등록 (추가형): 같은 파일 하나(storage_key 공유)를 자료실에서도 보이게, 업무를 볼 수 있는 사람만
alter table library_files add column if not exists task_id uuid references tasks(id) on delete set null;
create index if not exists library_files_task_idx on library_files(task_id) where task_id is not null;
-- 회사 설정: 업무 첨부를 자료실에 자동 등록(기본 켬)
alter table tenants add column if not exists attach_to_library boolean not null default true;
-- 기밀 이름 규칙 단어(회사별, 쉼표 구분). null = 기본 목록(고객 발송용 견적·제안서·소개서 등은 기밀 아님)
alter table tenants add column if not exists conf_words text;
