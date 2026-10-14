-- V14 15번 기밀 자료 보호: 자료실 파일·폴더 보안 등급 일반(public)·내부(internal)·기밀(confidential) (추가형)
alter table library_files add column if not exists security text not null default 'internal';
alter table library_files add column if not exists security_suggested text;          -- AI·규칙이 제안한 등급
alter table library_files add column if not exists security_confirmed boolean not null default false; -- 기밀 관리자가 확인함
do $$ begin
  alter table library_files add constraint library_files_security_chk check (security in ('public','internal','confidential'));
exception when duplicate_object then null; end $$;
-- 매출 근거는 처음부터 기밀
update library_files set security = 'confidential', security_confirmed = true
  where (source = 'revenue' or folder = '매출 근거' or folder like '매출 근거/%') and security <> 'confidential';

-- 폴더 등급: 하위 폴더·파일에 상속(파일은 더 높게만)
create table if not exists library_folder_security (
  tenant text not null,
  folder text not null,
  security text not null check (security in ('public','internal','confidential')),
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant, folder)
);
insert into library_folder_security (tenant, folder, security) values ('default', '매출 근거', 'confidential') on conflict do nothing;

-- 기밀 자료를 근거로 한 AI 대화·제안 표시(권한 없는 사람에게 내용이 넘어가지 않게)
alter table ai_threads add column if not exists confidential boolean not null default false;
alter table ai_proposals add column if not exists confidential boolean not null default false;

-- V14 18번 자료실 폴더 탐색기: 빈 폴더도 남도록 폴더 목록을 따로 둔다(파일이 있는 폴더는 파일에서도 알 수 있음)
create table if not exists library_folders (
  tenant text not null,
  path text not null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (tenant, path)
);
