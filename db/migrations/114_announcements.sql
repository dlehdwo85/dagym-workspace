-- V30 ② 공지(게시판) + 읽음 확인: 작성(대상 전체/팀/사람, 상단 고정, 중요, 예약 게시, 자료실 첨부) → 알림·푸시 → 읽은 사람/안 읽은 사람, 안 읽은 사람에게 다시 알림
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  title text not null,
  body text not null default '',
  pinned boolean not null default false,
  important boolean not null default false,
  audience jsonb not null default '{"type":"all","ids":[]}',   -- {type: all|teams|users, ids: []}
  file_ids uuid[] not null default '{}',                         -- 자료실 파일(library_files)
  publish_at timestamptz not null default now(),
  published boolean not null default true,                      -- 예약 게시는 false → 정기 실행이 시각에 게시·알림
  reminded_at timestamptz,
  remind_count int not null default 0,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists announcements_tenant on announcements (tenant, publish_at desc) where deleted_at is null;
create table if not exists announcement_reads (
  announcement_id uuid not null references announcements(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);
