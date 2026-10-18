-- 대표 지시(10/18): 업무·영업·마케팅 자료실을 공간별로 보되 저장소는 하나(같은 S3·같은 표). 공간 칸 + 이관 원본 연결.
alter table library_files add column if not exists space text not null default 'work';
do $$ begin
  alter table library_files add constraint library_files_space_chk check (space in ('work', 'sales', 'marketing'));
exception when duplicate_object then null; end $$;
create index if not exists library_files_space_idx on library_files (tenant, space) where deleted_at is null;
-- 운영실 자료실 이관: 원본 id(같은 파일 두 번 복사 방지)·원본 부가 정보(브랜드·메모·usedIn 등)
alter table library_files add column if not exists ext_ref text;
alter table library_files add column if not exists meta jsonb;
create unique index if not exists library_files_ext_ref on library_files (tenant, ext_ref) where ext_ref is not null;
