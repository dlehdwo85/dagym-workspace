-- V13 3·4번: 자료실 AI 자동 정리 + 자료실 폴더 권한 (추가형)
alter table library_files add column if not exists content_hash text;          -- 중복 감지(SHA-256, 올리는 기기에서 계산)
alter table library_files add column if not exists organized_by text;          -- 'ai' | 'rule' | null(사람이 정함)
alter table library_files add column if not exists ai_confidence real;
alter table library_files add column if not exists needs_review boolean not null default false; -- "정리 필요" 보기
alter table library_files add column if not exists ai_prev jsonb;              -- AI 정리 전 값(되돌리기)
create index if not exists library_files_hash_idx on library_files(tenant, content_hash) where deleted_at is null and content_hash is not null;

-- 사람이 고친 정리 = 회사별 학습 예시 (다음 정리에 반영)
create table if not exists library_rules (
  id bigserial primary key,
  tenant text not null default 'default',
  file_name text not null,
  mime_type text,
  folder text not null default '',
  tags text[] not null default '{}',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists library_rules_tenant_idx on library_rules(tenant, created_at desc);

-- 폴더 단위 권한(하위 폴더 상속). 행이 없으면 상위 폴더 → 메뉴 권한을 따른다. 메뉴 권한보다 넓힐 수는 없다
create table if not exists library_folder_perms (
  tenant text not null default 'default',
  folder text not null,
  role text not null,
  level text not null,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant, folder, role)
);
-- 기본: "매출 근거" 폴더는 대표·본사 관리자만 (매출 메뉴 기본이 대표만이므로)
insert into library_folder_perms (tenant, folder, role, level)
  select 'default', '매출 근거', r, 'none' from unnest(array['dept_lead','site_manager','staff']) r
  on conflict do nothing;

-- V13 1번: 매출 "자료로 입력(AI)" — 근거 파일(자료실 "매출 근거")을 숫자에 연결
alter table revenue_entries add column if not exists source_file_ids uuid[];
alter table revenue_entries drop constraint if exists revenue_entries_source_check;
alter table revenue_entries add constraint revenue_entries_source_check check (source in ('manual', 'csv', 'gpt', 'ai'));
