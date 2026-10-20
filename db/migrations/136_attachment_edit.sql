-- 대표 10/20 23:05: 업무 첨부 파일을 업무 안에서 열어 고치고 저장 — 버전(원본 보관·되돌리기) + docx 는 워크인 문서로 공동 편집(doc_id)
alter table attachments add column if not exists version int not null default 1;
alter table attachments add column if not exists doc_id uuid references library_files(id) on delete set null;   -- 워크인 문서(공동 편집)로 바꾼 사본
alter table attachments add column if not exists updated_at timestamptz;
alter table attachments add column if not exists updated_by uuid references users(id) on delete set null;
create table if not exists attachment_versions (
  id uuid primary key default gen_random_uuid(),
  attachment_id uuid not null references attachments(id) on delete cascade,
  version int not null,
  storage_key text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  note text,
  kind text not null default 'upload' check (kind in ('original', 'upload', 'doc', 'sheet', 'restore')),  -- 원본·새 파일 올림·문서 편집 저장·표 편집 저장·되돌리기
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (attachment_id, version)
);
create index if not exists attachment_versions_att on attachment_versions (attachment_id, version desc);
