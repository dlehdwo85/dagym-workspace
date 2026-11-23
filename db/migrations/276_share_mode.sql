-- #1129(대표 11/23): 자료실·업무 공개 방식 — 회사 설정 하나로 '부서·팀별'(지금 동작, 기본) 또는 '회사 전체 공유'. 추가형.
-- 회사 전체 공유: 같은 회사 사람이 다른 부서·팀의 업무와 '우리 팀' 자료도 봄(격리 팀·기밀 등급·내 파일은 그대로 막힘).
-- 항목마다 바꾸기: tasks.share / library_files.share — null = 회사 설정 따름, 'team' = 늘 부서·팀만, 'company' = 늘 회사 전체.
alter table tenants add column if not exists share_mode text not null default 'team';
alter table tenants drop constraint if exists tenants_share_mode_chk;
alter table tenants add constraint tenants_share_mode_chk check (share_mode in ('team', 'company'));
alter table tasks add column if not exists share text;
alter table tasks drop constraint if exists tasks_share_chk;
alter table tasks add constraint tasks_share_chk check (share is null or share in ('team', 'company'));
alter table library_files add column if not exists share text;
alter table library_files drop constraint if exists library_files_share_chk;
alter table library_files add constraint library_files_share_chk check (share is null or share in ('team', 'company'));
