-- 대표 결정 10/19: 자료실 '워크인 문서' 공동 편집 1단계 — Yjs 조각을 추가형으로 저장, 외부 유료 실시간 서비스 없음
-- (docs/research/LIBRARY_DOC_COEDIT_DESIGN.md). 업무 설명·체크리스트는 대상이 아님.
create table if not exists lib_docs (
  library_file_id uuid primary key references library_files(id) on delete cascade,
  tenant text not null,
  snapshot bytea not null,                       -- 조각을 합친 상태(처음 여는 사람은 snapshot + 그 뒤 조각만 받음)
  snapshot_seq bigint not null default 0,        -- snapshot 에 포함된 마지막 조각
  version_seq bigint not null default 0,         -- 마지막 변경 기록에 포함된 조각
  version_at timestamptz not null default now(),
  pending_users uuid[] not null default '{}',    -- 마지막 변경 기록 뒤 고친 사람
  updated_at timestamptz not null default now()
);
create table if not exists lib_doc_updates (
  seq bigserial primary key,
  doc_id uuid not null references lib_docs(library_file_id) on delete cascade,
  client_id bigint not null default 0,
  update bytea not null,
  user_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists lib_doc_updates_doc_seq on lib_doc_updates (doc_id, seq);
create table if not exists lib_doc_versions (
  id bigserial primary key,
  doc_id uuid not null references lib_docs(library_file_id) on delete cascade,
  seq bigint not null,
  snapshot bytea not null,
  by_users uuid[] not null default '{}',
  reason text,                                    -- auto(10분)·idle(모두 나감)·restore(되돌리기)·manual
  text text,
  created_at timestamptz not null default now()
);
create index if not exists lib_doc_versions_doc on lib_doc_versions (doc_id, id desc);
create table if not exists lib_doc_shares (
  doc_id uuid not null references lib_docs(library_file_id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('view', 'edit')),
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (doc_id, user_id)
);
create table if not exists lib_doc_presence (
  doc_id uuid not null references lib_docs(library_file_id) on delete cascade,
  client_id bigint not null,
  user_id uuid not null,
  state bytea not null,                           -- Yjs awareness 조각(커서·이름), 15초 지나면 안 보임
  updated_at timestamptz not null default now(),
  primary key (doc_id, client_id)
);
