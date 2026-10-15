-- V22 부록 2 문서 원가 절감: 쓴 모델·캐시 토큰 기록, "새로 디자인" 표시, 양식 채우기(fill) 작업 — 추가형(검사 조건은 넓히기만)
alter table ai_doc_jobs add column if not exists model text;
alter table ai_doc_jobs add column if not exists design boolean not null default false;
alter table ai_doc_jobs add column if not exists cache_read_tokens int not null default 0;
alter table ai_doc_jobs add column if not exists cache_write_tokens int not null default 0;
alter table ai_doc_jobs add column if not exists source_file_id uuid references library_files(id) on delete set null; -- 양식 채우기 원본
alter table ai_doc_jobs drop constraint if exists ai_doc_jobs_mode_check;
alter table ai_doc_jobs add constraint ai_doc_jobs_mode_check check (mode in ('create','edit','analyze','fill'));
